import asyncio
import logging

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import Tool

from ..config import Settings

logger = logging.getLogger(__name__)

_RETRY_ATTEMPTS = 3
_RETRY_BASE_DELAY = 1.0  # seconds


class MCPBridge:
    """
    Owns the Tableau MCP subprocess lifecycle.
    Exposes all available tools to the agent dynamically —
    no hardcoded wrappers, no assumptions about which tools exist.
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._session: ClientSession | None = None
        self._cm = None
        self._tools: list[Tool] = []

    async def connect(self) -> None:
        """Spawn the MCP subprocess and open a session. Called once at startup."""
        server_params = StdioServerParameters(
            command="npx",
            args=["-y", "@tableau/mcp-server@latest"],
            env={
                "SERVER": self._settings.tableau_server_url,
                "SITE_NAME": self._settings.tableau_site_name,
                "PAT_NAME": self._settings.tableau_pat_name,
                "PAT_VALUE": self._settings.tableau_pat_secret,
            },
        )
        self._cm = stdio_client(server_params)
        read, write = await self._cm.__aenter__()
        self._session = ClientSession(read, write)
        await self._session.__aenter__()
        await self._session.initialize()
        result = await self._session.list_tools()
        self._tools = result.tools
        logger.info("MCP bridge connected — %d tools available", len(self._tools))

    async def disconnect(self) -> None:
        """Shut down the MCP session and subprocess cleanly."""
        if self._session:
            await self._session.__aexit__(None, None, None)
        if self._cm:
            await self._cm.__aexit__(None, None, None)
        logger.info("MCP bridge disconnected")

    @property
    def tools(self) -> list[Tool]:
        """All tools advertised by the Tableau MCP server."""
        return self._tools

    async def call_tool(self, tool_name: str, tool_input: dict) -> str:
        """
        Execute a single MCP tool call and return the result as a string.
        Retries up to 3 times with exponential backoff on transient errors.
        """
        if not self._session:
            raise RuntimeError("MCP session not connected")

        last_error: Exception | None = None
        for attempt in range(_RETRY_ATTEMPTS):
            try:
                result = await asyncio.wait_for(
                    self._session.call_tool(tool_name, tool_input),
                    timeout=30.0,
                )
                return "\n".join(
                    block.text
                    for block in result.content
                    if hasattr(block, "text")
                )
            except Exception as e:
                last_error = e
                if attempt < _RETRY_ATTEMPTS - 1:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    logger.warning(
                        "Tool call '%s' failed (attempt %d/%d): %s — retrying in %.1fs",
                        tool_name, attempt + 1, _RETRY_ATTEMPTS, e, delay,
                    )
                    await asyncio.sleep(delay)

        raise RuntimeError(
            f"Tool '{tool_name}' failed after {_RETRY_ATTEMPTS} attempts"
        ) from last_error

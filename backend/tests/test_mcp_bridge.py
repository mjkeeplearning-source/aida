from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.mcp_bridge import MCPBridge


def _make_settings():
    s = MagicMock()
    s.tableau_server_url = "https://test.tableau.com"
    s.tableau_site_name = "testsite"
    s.tableau_pat_name = "testpat"
    s.tableau_pat_secret = "testsecret"
    return s


def _make_tool(name="list-datasources"):
    tool = MagicMock()
    tool.name = name
    return tool


def _make_session(tools=None):
    """Return a mock ClientSession async context manager."""
    tools = tools or [_make_tool()]
    list_tools_result = MagicMock()
    list_tools_result.tools = tools

    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=None)
    session.initialize = AsyncMock()
    session.list_tools = AsyncMock(return_value=list_tools_result)
    return session


def _make_stdio_cm(session):
    """Return a mock stdio_client context manager that yields (read, write)."""
    read, write = AsyncMock(), AsyncMock()
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=(read, write))
    cm.__aexit__ = AsyncMock(return_value=None)
    return cm


@pytest.mark.asyncio
async def test_connect_populates_tools():
    tool = _make_tool("list-datasources")
    session = _make_session([tool])
    cm = _make_stdio_cm(session)

    with patch("app.services.mcp_bridge.stdio_client", return_value=cm), \
         patch("app.services.mcp_bridge.ClientSession", return_value=session):
        bridge = MCPBridge(_make_settings())
        await bridge.connect()

    assert len(bridge.tools) == 1
    assert bridge.tools[0].name == "list-datasources"


@pytest.mark.asyncio
async def test_call_tool_returns_text():
    session = _make_session()
    cm = _make_stdio_cm(session)

    text_block = MagicMock()
    text_block.text = "result data"
    call_result = MagicMock()
    call_result.content = [text_block]
    session.call_tool = AsyncMock(return_value=call_result)

    with patch("app.services.mcp_bridge.stdio_client", return_value=cm), \
         patch("app.services.mcp_bridge.ClientSession", return_value=session):
        bridge = MCPBridge(_make_settings())
        await bridge.connect()
        result = await bridge.call_tool("list-datasources", {})

    assert result == "result data"
    session.call_tool.assert_called_once_with("list-datasources", {})


@pytest.mark.asyncio
async def test_call_tool_retries_on_failure():
    session = _make_session()
    cm = _make_stdio_cm(session)
    session.call_tool = AsyncMock(side_effect=RuntimeError("transient"))

    with patch("app.services.mcp_bridge.stdio_client", return_value=cm), \
         patch("app.services.mcp_bridge.ClientSession", return_value=session), \
         patch("app.services.mcp_bridge._RETRY_BASE_DELAY", 0):
        bridge = MCPBridge(_make_settings())
        await bridge.connect()

        with pytest.raises(RuntimeError, match="failed after 3 attempts"):
            await bridge.call_tool("list-datasources", {})

    assert session.call_tool.call_count == 3


@pytest.mark.asyncio
async def test_call_tool_raises_when_not_connected():
    bridge = MCPBridge(_make_settings())
    with pytest.raises(RuntimeError, match="not connected"):
        await bridge.call_tool("list-datasources", {})

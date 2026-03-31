import json
import logging
from typing import AsyncIterator

import anthropic

from .mcp_bridge import MCPBridge

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 10

SYSTEM_PROMPT = """
You are a helpful data analyst assistant with access to a user's Tableau Cloud environment.
You have tools available to explore data sources, workbooks, views, metrics, and run queries.

When a user asks a question:
- Use whatever tools are needed to find the answer — do not guess or make up data
- Call tools in whatever order makes sense; you may call multiple tools
- When you have enough data to answer confidently, respond in clear natural language
- Cite specific values and figures from the tool results in your answer
- If a question cannot be answered from the available Tableau content, say so clearly
"""


async def run_agent(
    question: str,
    bridge: MCPBridge,
    client: anthropic.AsyncAnthropic,
) -> AsyncIterator[str]:
    """
    Agentic loop: streams SSE-formatted strings to the caller.

    Yields:
        event: token      — one streamed text token from the LLM
        event: tool_call  — name of the MCP tool being called
        event: done       — agent finished successfully
        event: error      — unrecoverable error (stream closes after this)
    """
    tools = [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": t.inputSchema,
        }
        for t in bridge.tools
    ]

    messages: list[dict] = [{"role": "user", "content": question}]

    for iteration in range(MAX_ITERATIONS):
        async with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=tools,
            messages=messages,
        ) as stream:
            async for event in stream:
                if event.type == "content_block_delta" and hasattr(event.delta, "text"):
                    yield f"event: token\ndata: {event.delta.text}\n\n"

            final_message = await stream.get_final_message()

        if final_message.stop_reason == "end_turn":
            yield "event: done\ndata: {}\n\n"
            return

        if final_message.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": final_message.content})

            tool_results = []
            for block in final_message.content:
                if block.type == "tool_use":
                    logger.info("Calling MCP tool: %s", block.name)
                    yield f"event: tool_call\ndata: {block.name}\n\n"

                    result_text = await bridge.call_tool(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_text,
                    })

            messages.append({"role": "user", "content": tool_results})
        else:
            # Unexpected stop reason — treat as done
            yield "event: done\ndata: {}\n\n"
            return

    # Exceeded max iterations
    yield f"event: error\ndata: {json.dumps({'message': 'Max iterations reached without a final answer'})}\n\n"

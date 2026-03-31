from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.agent import run_agent


class _MockStream:
    """Minimal async stream mirroring the anthropic streaming API."""

    def __init__(self, events, final_message):
        self._events = events
        self._final = final_message

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for event in self._events:
            yield event

    async def get_final_message(self):
        return self._final


def _text_event(text):
    e = MagicMock()
    e.type = "content_block_delta"
    e.delta = MagicMock()
    e.delta.text = text
    return e


def _final(stop_reason, content=None):
    m = MagicMock()
    m.stop_reason = stop_reason
    m.content = content or []
    return m


def _tool_use_block(name="list-datasources", tool_id="tool_1", input=None):
    block = MagicMock()
    block.type = "tool_use"
    block.name = name
    block.id = tool_id
    block.input = input or {}
    return block


@pytest.mark.asyncio
async def test_end_turn_emits_done():
    client = MagicMock()
    client.messages.stream.return_value = _MockStream(
        [_text_event("Hello")],
        _final("end_turn"),
    )

    bridge = MagicMock()
    bridge.tools = []

    events = [e async for e in run_agent("hi", bridge, client)]

    assert any("event: token" in e and "Hello" in e for e in events)
    assert any("event: done" in e for e in events)
    assert not any("event: error" in e for e in events)


@pytest.mark.asyncio
async def test_tool_use_calls_bridge_and_continues():
    tool_block = _tool_use_block("list-datasources")

    call_count = 0

    def stream_factory(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return _MockStream([], _final("tool_use", [tool_block]))
        return _MockStream([_text_event("Done")], _final("end_turn"))

    client = MagicMock()
    client.messages.stream.side_effect = lambda **kw: stream_factory(**kw)

    bridge = MagicMock()
    bridge.tools = []
    bridge.call_tool = AsyncMock(return_value="datasource list result")

    events = [e async for e in run_agent("list datasources", bridge, client)]

    bridge.call_tool.assert_called_once_with("list-datasources", {})
    assert any("event: tool_call" in e and "list-datasources" in e for e in events)
    assert any("event: done" in e for e in events)


@pytest.mark.asyncio
async def test_max_iterations_emits_error():
    tool_block = _tool_use_block()

    client = MagicMock()
    client.messages.stream.return_value = _MockStream([], _final("tool_use", [tool_block]))

    bridge = MagicMock()
    bridge.tools = []
    bridge.call_tool = AsyncMock(return_value="result")

    events = [e async for e in run_agent("loop forever", bridge, client)]

    assert any("event: error" in e and "Max iterations" in e for e in events)


@pytest.mark.asyncio
async def test_max_tokens_emits_truncation_note():
    client = MagicMock()
    client.messages.stream.return_value = _MockStream(
        [_text_event("Partial answer")],
        _final("max_tokens"),
    )

    bridge = MagicMock()
    bridge.tools = []

    events = [e async for e in run_agent("hi", bridge, client)]

    assert any("truncated" in e for e in events)
    assert any("event: done" in e for e in events)


@pytest.mark.asyncio
async def test_bridge_tool_error_propagates():
    tool_block = _tool_use_block()

    client = MagicMock()
    client.messages.stream.return_value = _MockStream([], _final("tool_use", [tool_block]))

    bridge = MagicMock()
    bridge.tools = []
    bridge.call_tool = AsyncMock(side_effect=RuntimeError("MCP failed"))

    with pytest.raises(RuntimeError, match="MCP failed"):
        async for _ in run_agent("hi", bridge, client):
            pass

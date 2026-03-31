from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app, bridge


@pytest.fixture
async def http_client():
    with patch.object(bridge, "connect", new=AsyncMock()), \
         patch.object(bridge, "disconnect", new=AsyncMock()):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            yield client


@pytest.mark.asyncio
async def test_chat_streams_token_and_done(http_client):
    async def mock_run_agent(*args, **kwargs):
        yield "event: token\ndata: Hello\n\n"
        yield "event: done\ndata: {}\n\n"

    with patch("app.routers.chat.run_agent", mock_run_agent):
        response = await http_client.post("/api/chat", json={"message": "hi"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: token" in response.text
    assert "event: done" in response.text


@pytest.mark.asyncio
async def test_chat_rejects_whitespace_message(http_client):
    response = await http_client.post("/api/chat", json={"message": "   "})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_chat_rejects_empty_message(http_client):
    response = await http_client.post("/api/chat", json={"message": ""})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_chat_rejects_message_too_long(http_client):
    response = await http_client.post("/api/chat", json={"message": "a" * 2001})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_chat_emits_error_event_on_agent_failure(http_client):
    async def failing_agent(*args, **kwargs):
        raise RuntimeError("agent exploded")
        yield  # make it a generator

    with patch("app.routers.chat.run_agent", failing_agent):
        response = await http_client.post("/api/chat", json={"message": "hi"})

    assert response.status_code == 200
    assert "event: error" in response.text
    assert "agent exploded" in response.text


@pytest.mark.asyncio
async def test_health_endpoint(http_client):
    response = await http_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "mcp_tools" in data

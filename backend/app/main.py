import pathlib
from contextlib import asynccontextmanager

import anthropic
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .config import settings
from .services.mcp_bridge import MCPBridge

# Docker path takes precedence; fall back to local dev path
_DOCKER_STATIC = pathlib.Path("/app/frontend/out")
_LOCAL_STATIC = pathlib.Path(__file__).parents[2] / "frontend" / "out"
STATIC_DIR = _DOCKER_STATIC if _DOCKER_STATIC.exists() else _LOCAL_STATIC

bridge = MCPBridge(settings)
anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await bridge.connect()
    yield
    await bridge.disconnect()


app = FastAPI(title="Tableau RAG MVP", lifespan=lifespan)

from .routers import chat  # noqa: E402 — imported after app to avoid circular import
app.include_router(chat.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "mcp_tools": len(bridge.tools)}


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")

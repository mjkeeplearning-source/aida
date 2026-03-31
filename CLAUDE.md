# CLAUDE.md — RAG MVP: Tableau Cloud Data Source Q&A

## Project Overview

Build an MVP solution that lets users interact with **Tableau Cloud** using natural language. The system is packaged as a **single Docker container** running a FastAPI backend that also serves the statically-built Next.js frontend.

**Tech stack:**
- **Tableau MCP** (`tableau/tableau-mcp`) — official MCP server, spawned as a subprocess inside the container
- **FastAPI** (Python, `uv` project) — backend API, agentic loop orchestration, static file serving
- **Next.js** (static export) — frontend, built at Docker image build time and served by FastAPI via `StaticFiles`
- **Claude (Anthropic API)** — LLM that autonomously decides which Tableau MCP tools to call and synthesises the final answer

> **No authentication in this MVP.** All endpoints are open. Auth can be added in v2.

---

## How It Works — Agentic Approach

Rather than hardcoding which Tableau MCP tools to call, **the LLM decides at runtime**. The backend opens the Tableau MCP subprocess, reads the full list of available tools and their descriptions, and passes them directly to the Anthropic API. The LLM then reasons about the user's question, calls whichever tools are needed (in whatever order makes sense), inspects the results, and may call further tools before producing a final streamed answer.

This means:
- No hardcoded tool wrappers
- No VizQL field validation logic
- No predetermined pipeline steps
- New tools added to Tableau MCP are automatically available to the LLM without any backend changes

**Agentic loop flow:**
```
User Question
    │
    ▼
FastAPI: open MCP session → read all available tools
    │
    ▼
Anthropic API call: question + full tool list injected into context
    │
    ▼
The LLM reasons and calls MCP tools as needed:
  - list-datasources, get-datasource-metadata, query-datasource
  - list-workbooks, list-views, get-view-data, get-view-image
  - search-content, list-all-pulse-metric-definitions,
    generate-pulse-insight-brief, ... (whatever is relevant)
    │
    ▼ (loop until the LLM signals it is done)
The LLM synthesises an answer from accumulated tool results
    │
    ▼
Stream final answer tokens back to the user
```

---

## Architecture Diagram

```
Docker Container (port 8000)
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   Browser Request                                        │
│        │                                                 │
│        ▼                                                 │
│   FastAPI (uvicorn :8000)                                │
│   ├── /api/chat      → agentic loop (SSE stream)         │
│   └── /              → Next.js static export             │
│        │                                                 │
│        ├──── Tableau MCP subprocess (stdio)              │
│        │     ├── all tools exposed to the LLM dynamically │
│        │     └──── Tableau Cloud (external HTTPS)        │
│        │                                                 │
│        └──── Anthropic API (external HTTPS)              │
│              └── LLM drives tool calls autonomously   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Repository Layout (Final Target)

```
/
├── backend/                   # uv Python project (FastAPI)
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── .python-version
│   └── app/
│       ├── main.py            # FastAPI app, lifespan, static mount
│       ├── config.py          # pydantic-settings
│       ├── routers/
│       │   └── chat.py        # POST /api/chat (SSE)
│       ├── services/
│       │   ├── mcp_bridge.py  # opens MCP subprocess; exposes tool list + executor
│       │   └── agent.py       # agentic loop: Anthropic ↔ MCP tool calls
│       ├── models/
│       │   └── schemas.py
│       └── utils/
│           └── logging.py
│
├── frontend/                  # Next.js app (static export)
│   ├── package.json
│   ├── next.config.ts         # output: 'export'
│   ├── app/
│   ├── components/
│   ├── hooks/
│   └── lib/
│
├── scripts/
│   ├── start-mac.sh
│   ├── stop-mac.sh
│   ├── start-linux.sh
│   ├── stop-linux.sh
│   ├── start-windows.ps1
│   └── stop-windows.ps1
│
├── Dockerfile                 # Single multi-stage build
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Task Breakdown

---

### TASK 1 — Project Scaffolding

**Goal:** Create the full repository structure and verify tooling.

**Steps:**
1. Create root directory and initialise git (`git init`); add `.gitignore` covering Python, Node, `.env`
2. Scaffold **backend** as a `uv` project:
   ```bash
   uv init backend
   cd backend
   uv python pin 3.12
   uv add fastapi "uvicorn[standard]" pydantic-settings python-dotenv anthropic mcp
   uv add --dev pytest pytest-asyncio httpx
   ```
3. Scaffold **frontend** with Next.js static export:
   ```bash
   npx create-next-app@latest frontend \
     --typescript --tailwind --app --no-src-dir --import-alias "@/*"
   ```
4. Create `scripts/` directory with placeholder files for all six scripts (see Task 7)
5. Create root `.env.example` (see Task 2)
6. Create root `Dockerfile` and `docker-compose.yml` (see Task 6)

**Notes:**
- Do not commit `backend/.venv` or `frontend/node_modules` or `frontend/out`
- Backend Python: `3.12`; frontend Node: `>=20`

---

### TASK 2 — Environment Configuration

**Goal:** Define all required env vars; validate them in the backend at startup.

**Root `.env.example`:**
```dotenv
# ── Anthropic ──────────────────────────────────────────
ANTHROPIC_API_KEY=

# ── Tableau Cloud ──────────────────────────────────────
TABLEAU_SERVER_URL=https://<pod>.online.tableau.com
TABLEAU_SITE_NAME=
TABLEAU_PAT_NAME=
TABLEAU_PAT_SECRET=

# ── App ────────────────────────────────────────────────
LOG_LEVEL=INFO
```

> Note: `TABLEAU_DATASOURCE_LUID` is no longer a required env var. The LLM will call
> `list-datasources` itself when needed, so users can ask about any available data source.

**`backend/app/config.py`:**
```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    anthropic_api_key: str
    tableau_server_url: str
    tableau_site_name: str
    tableau_pat_name: str
    tableau_pat_secret: str

    log_level: str = "INFO"

settings = Settings()
```

**Steps:**
1. Create `backend/app/config.py` as above
2. In the FastAPI lifespan, instantiate `Settings()` — Pydantic will raise a clear `ValidationError` at startup if any required field is missing, listing exactly which vars are absent
3. The frontend needs no `.env` file — it calls the backend at the same origin (`/api/...`)

---

### TASK 3 — MCP Bridge Service

**Goal:** Open and manage the Tableau MCP subprocess; expose the tool list and a generic tool executor to the agent — with no hardcoded tool wrappers.

**How the MCP subprocess is launched**

The package is `@tableau/mcp-server` on npm (not `@tableau/mcp`). The bridge spawns it via:
```
npx -y @tableau/mcp-server@latest
```
The `-y` flag ensures npx installs without prompting. The env vars passed to the subprocess use the package's own naming:
- `SERVER` (not `TABLEAU_SERVER_URL`)
- `SITE_NAME` (not `TABLEAU_SITE_NAME`)
- `PAT_NAME` (not `TABLEAU_PAT_NAME`)
- `PAT_VALUE` (not `TABLEAU_PAT_SECRET`)

Tested locally — connects successfully and exposes **16 tools**.

**`backend/app/services/mcp_bridge.py`:**

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import Tool
import asyncio

# Exact path to the Tableau MCP entry point, installed locally in the Docker image.
# Confirm by checking: cat /app/mcp/node_modules/@tableau/mcp/package.json | grep '"main"'
MCP_ENTRY_POINT = "/app/mcp/node_modules/@tableau/mcp/dist/index.js"

class MCPBridge:
    """
    Owns the Tableau MCP subprocess lifecycle.
    Exposes all available tools to the agent dynamically —
    no hardcoded wrappers, no assumptions about which tools exist.
    """

    def __init__(self, settings):
        self._settings = settings
        self._session: ClientSession | None = None
        self._cm = None
        self._tools: list[Tool] = []

    async def connect(self):
        """Spawn the MCP subprocess and open a session. Called once at startup."""
        server_params = StdioServerParameters(
            command="node",
            args=[MCP_ENTRY_POINT],
            env={
                "TABLEAU_SERVER_URL": self._settings.tableau_server_url,
                "TABLEAU_SITE_NAME":  self._settings.tableau_site_name,
                "TABLEAU_PAT_NAME":   self._settings.tableau_pat_name,
                "TABLEAU_PAT_SECRET": self._settings.tableau_pat_secret,
            }
        )
        self._cm = stdio_client(server_params)
        read, write = await self._cm.__aenter__()
        self._session = ClientSession(read, write)
        await self._session.__aenter__()
        await self._session.initialize()
        # Fetch the full tool list once on connect; cache for the session lifetime
        result = await self._session.list_tools()
        self._tools = result.tools

    async def disconnect(self):
        """Shut down the MCP session and subprocess cleanly."""
        if self._session:
            await self._session.__aexit__(None, None, None)
        if self._cm:
            await self._cm.__aexit__(None, None, None)

    @property
    def tools(self) -> list[Tool]:
        """All tools advertised by the Tableau MCP server."""
        return self._tools

    async def call_tool(self, tool_name: str, tool_input: dict) -> str:
        """
        Execute a single MCP tool call and return the result as a string.
        This is the only method the agent needs — no per-tool wrappers.
        """
        if not self._session:
            raise RuntimeError("MCP session not connected")
        result = await asyncio.wait_for(
            self._session.call_tool(tool_name, tool_input),
            timeout=30.0
        )
        # Flatten content blocks into a single string for the LLM
        return "\n".join(
            block.text for block in result.content
            if hasattr(block, "text")
        )
```

**Key points:**
- `MCP_ENTRY_POINT` must be verified during implementation — inspect the installed package's `package.json` to confirm the `main` field path
- `tools` property returns the live list from the MCP server — no hardcoding of tool names anywhere
- `call_tool` is the single generic executor the agent calls for any tool by name
- The bridge is instantiated once in the FastAPI lifespan and shared across requests via dependency injection
- Add retry with exponential backoff (max 3 attempts) inside `call_tool` for transient errors

---

### TASK 4 — Agent Service

**Goal:** Implement the agentic loop that gives the LLM the full MCP tool list and lets it autonomously decide what to call, handling multi-turn tool use until a final answer is ready.

**`backend/app/services/agent.py`:**

```python
import anthropic
from .mcp_bridge import MCPBridge

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
):
    """
    Agentic loop: stream tokens and tool-call events back to the caller.
    Yields SSE-formatted strings.
    """
    # Convert MCP tool schemas to the format Anthropic expects
    tools = [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": t.inputSchema,
        }
        for t in bridge.tools
    ]

    messages = [{"role": "user", "content": question}]

    while True:
        # Stream the next response from Claude
        async with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=tools,
            messages=messages,
        ) as stream:
            tool_uses = []
            text_buffer = ""

            async for event in stream:
                if event.type == "content_block_delta":
                    if hasattr(event.delta, "text"):
                        # Stream text tokens directly to the client
                        yield f"event: token\ndata: {event.delta.text}\n\n"
                        text_buffer += event.delta.text

                elif event.type == "content_block_start":
                    if hasattr(event.content_block, "type") and \
                       event.content_block.type == "tool_use":
                        tool_uses.append({
                            "id":    event.content_block.id,
                            "name":  event.content_block.name,
                            "input": {},
                        })

                elif event.type == "content_block_delta":
                    if hasattr(event.delta, "partial_json") and tool_uses:
                        # Accumulate streamed JSON for the current tool input
                        tool_uses[-1]["input_raw"] = \
                            tool_uses[-1].get("input_raw", "") + event.delta.partial_json

            final_message = await stream.get_final_message()

        # If Claude finished with no tool calls, we are done
        if final_message.stop_reason == "end_turn":
            yield "event: done\ndata: {}\n\n"
            return

        # Claude wants to call tools — execute them all, then continue the loop
        if final_message.stop_reason == "tool_use":
            # Append Claude's response (including tool_use blocks) to the conversation
            messages.append({
                "role": "assistant",
                "content": final_message.content,
            })

            # Execute each tool call via the MCP bridge
            tool_results = []
            for block in final_message.content:
                if block.type == "tool_use":
                    # Inform the frontend which tool is being called
                    yield f"event: tool_call\ndata: {block.name}\n\n"

                    result_text = await bridge.call_tool(block.name, block.input)
                    tool_results.append({
                        "type":        "tool_result",
                        "tool_use_id": block.id,
                        "content":     result_text,
                    })

            # Feed all tool results back to Claude and loop
            messages.append({"role": "user", "content": tool_results})
```

**Key points:**
- The loop continues until `stop_reason == "end_turn"` — the LLM decides when it has enough information
- `event: tool_call` SSE events let the frontend show the user which tools are being called in real time (e.g. "Querying datasource…", "Fetching workbooks…")
- The tool list passed to Anthropic is built directly from `bridge.tools` — zero hardcoding
- Adding `max_iterations` guard (e.g. 10) is recommended to prevent runaway loops on edge cases

---

### TASK 5 — FastAPI Backend: Core & Chat Endpoint

**Goal:** Wire the MCP bridge and agent into FastAPI; expose a single streaming chat endpoint.

**`backend/app/main.py`:**
```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import pathlib, anthropic

from .config import settings
from .services.mcp_bridge import MCPBridge
from .routers import chat

STATIC_DIR = pathlib.Path("/app/frontend/out")

bridge = MCPBridge(settings)
anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await bridge.connect()
    yield
    await bridge.disconnect()

app = FastAPI(title="Tableau RAG MVP", lifespan=lifespan)
app.include_router(chat.router, prefix="/api")

@app.get("/health")
async def health():
    return {"status": "ok", "mcp_tools": len(bridge.tools)}

if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
```

**`backend/app/routers/chat.py`:**
```python
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from ..services.agent import run_agent
from ..main import bridge, anthropic_client

router = APIRouter()

class ChatRequest(BaseModel):
    message: str = Field(max_length=2000)

@router.post("/chat")
async def chat(req: ChatRequest):
    async def stream():
        try:
            async for chunk in run_agent(req.message, bridge, anthropic_client):
                yield chunk
        except Exception as e:
            import json
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
```

**SSE event types the frontend receives:**

| Event | Data | Description |
|-------|------|-------------|
| `token` | string | One streamed text token from the LLM |
| `tool_call` | tool name string | LLM is calling this MCP tool right now |
| `error` | `{"message": "..."}` | Something went wrong; stream closes |
| `done` | `{}` | Agent has finished; stream closes cleanly |

**Key points:**
- Only one endpoint needed: `POST /api/chat`
- No separate datasource endpoint — The LLM calls `list-datasources` itself when the user asks
- `GET /health` returns the count of available MCP tools, useful for debugging connectivity

---

### TASK 6 — Single Docker Container Build

**Goal:** Package the Next.js static build, FastAPI, and Node.js (for the Tableau MCP subprocess) into one image on port 8000.

**`Dockerfile` (multi-stage):**
```dockerfile
# ── Stage 1: Build Next.js static export ──────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Output: /build/frontend/out/

# ── Stage 2: Runtime image (Python + Node for MCP subprocess) ─────
FROM python:3.12-slim

# Install Node.js 20 (required to run the Tableau MCP subprocess)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install @tableau/mcp into a known local directory.
# Using a local install with an explicit node entry point is more reliable
# than npx, which has ambiguous resolution order and may hit the network.
RUN mkdir -p /app/mcp && cd /app/mcp && npm install @tableau/mcp

# Confirm the entry point exists — fails the build early if the path is wrong.
# Check this build-step output to verify MCP_ENTRY_POINT in mcp_bridge.py is correct.
RUN node -e "const p = require('/app/mcp/node_modules/@tableau/mcp/package.json');              console.log('Tableau MCP entry point:', p.main || p.exports)"  

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install Python dependencies from the lockfile (reproducible, no internet needed)
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev

# Copy backend source
COPY backend/app/ ./app/

# Copy built frontend static files
COPY --from=frontend-build /build/frontend/out/ ./frontend/out/

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**`docker-compose.yml`:**
```yaml
services:
  app:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
```

---

### TASK 7 — Platform Scripts

**Goal:** One-command start/stop for Mac, Linux, and Windows.

Each start script must: check `.env` exists, check Docker is running, run `docker compose up --build -d`, and print `http://localhost:8000` on success.

**`scripts/start-mac.sh`** (identical content to `scripts/start-linux.sh`):
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo "🔍 Checking prerequisites..."

if [ ! -f ".env" ]; then
  echo ""
  echo "❌  .env file not found."
  echo "    Run: cp .env.example .env  then fill in your credentials."
  echo ""
  exit 1
fi

if ! docker info > /dev/null 2>&1; then
  echo ""
  echo "❌  Docker is not running. Please start Docker and try again."
  echo ""
  exit 1
fi

echo "🐳  Building image and starting container..."
docker compose up --build -d

echo ""
echo "✅  Application is starting up."
echo "    Open http://localhost:8000 in your browser."
echo "    (Allow ~15 seconds for first startup.)"
echo ""
echo "    To stop: bash scripts/stop-mac.sh"
```

**`scripts/stop-mac.sh`** (identical content to `scripts/stop-linux.sh`):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
echo "🛑  Stopping container..."
docker compose down
echo "✅  Stopped."
```

**`scripts/start-windows.ps1`:**
```powershell
$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

Write-Host "🔍 Checking prerequisites..."

if (-not (Test-Path ".env")) {
    Write-Host ""
    Write-Host "❌  .env file not found."
    Write-Host "    Run: Copy-Item .env.example .env  then fill in your credentials."
    Write-Host ""
    exit 1
}

try { docker info 2>&1 | Out-Null }
catch {
    Write-Host ""
    Write-Host "❌  Docker is not running. Please start Docker Desktop and try again."
    Write-Host ""
    exit 1
}

Write-Host "🐳  Building image and starting container..."
docker compose up --build -d

Write-Host ""
Write-Host "✅  Application is starting up."
Write-Host "    Open http://localhost:8000 in your browser."
Write-Host "    (Allow ~15 seconds for first startup.)"
Write-Host ""
Write-Host "    To stop: .\scripts\stop-windows.ps1"
```

**`scripts/stop-windows.ps1`:**
```powershell
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host "🛑  Stopping container..."
docker compose down
Write-Host "✅  Stopped."
```

**Make bash scripts executable after creation:**
```bash
chmod +x scripts/start-mac.sh scripts/stop-mac.sh \
         scripts/start-linux.sh scripts/stop-linux.sh
```

---

### TASK 8 — Next.js Frontend (Static Export)

**Goal:** Build the chat UI as a Next.js static export served by FastAPI.

**`frontend/next.config.ts`:**
```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
}

export default config
```

**Pages:**

| Route | Description |
|-------|-------------|
| `/` | Landing page with a "Start chatting" button → `/chat` |
| `/chat` | Main chat interface |

**Components to implement:**

`components/chat/`
- `ChatWindow.tsx` — scrollable message list; auto-scrolls to bottom on new messages
- `MessageBubble.tsx` — user (right-aligned) / assistant (left-aligned); renders markdown via `react-markdown` + `remark-gfm`; blinking cursor while streaming
- `ToolCallIndicator.tsx` — displays `event: tool_call` events inline as subtle status pills (e.g. "Calling list-datasources…"); dismisses when the next token arrives
- `MessageInput.tsx` — auto-resize textarea; Enter submits; Shift+Enter newline; disabled while streaming; live 2000-char counter

`components/layout/`
- `Header.tsx` — app name and Tableau Cloud connection status (green/red dot based on `/health`)

`hooks/`
- `useChat.ts` — manages SSE stream; parses `token`, `tool_call`, `error`, `done` events; maintains message array; exposes `send(message)`, `messages`, `isStreaming`

**API client (`frontend/lib/api.ts`):**
```ts
// Same origin as FastAPI — no base URL needed
export async function postChat(message: string): Promise<Response> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  })
}
```

**Install required packages:**
```bash
cd frontend
npm install react-markdown remark-gfm lucide-react
```

---

### TASK 9 — Error Handling

**Goal:** Consistent, user-friendly error handling across backend and frontend.

**Backend:**
1. All exceptions inside the SSE generator must be caught; emit `event: error` then return cleanly — never let an exception propagate out of a `StreamingResponse` generator
2. Add a max iteration guard in the agent loop (e.g. 10 tool-call rounds) to prevent runaway loops; emit `event: error` if exceeded
3. MCP subprocess crash → caught by `call_tool`; emit `event: error` with a clear message
4. Anthropic API errors → caught at the stream level; emit `event: error`

**Frontend:**
1. `event: error` → display inline red error bubble in the chat with a "Try again" button (re-sends the last message)
2. SSE stream drops unexpectedly → show "Connection lost. Try again." bubble
3. `tool_call` event with no subsequent tokens after 30s → show timeout message

---

### TASK 10 — Testing

**Goal:** Automated tests covering the critical path.

**Backend (`pytest` + `pytest-asyncio`):**

| File | Coverage |
|------|----------|
| `test_mcp_bridge.py` | Mock MCP subprocess; assert `tools` list populated on connect; assert `call_tool` passes name + input correctly |
| `test_agent.py` | Mock Anthropic stream + MCP bridge; assert tool-call loop runs correctly; assert `done` event emitted; assert max iteration guard fires |
| `test_chat.py` | Integration via `httpx.AsyncClient`; assert SSE stream contains `token` and `done` events |

Run: `cd backend && uv run pytest`

**Frontend (`jest` + `@testing-library/react`):**

| File | Coverage |
|------|----------|
| `useChat.test.ts` | `token` events accumulate into message text; `tool_call` sets indicator state; `error` event sets error state; `done` clears streaming flag |
| `MessageInput.test.tsx` | 2000-char limit enforced; Enter submits; Shift+Enter inserts newline; disabled while `isStreaming` |
| `ToolCallIndicator.test.tsx` | Renders tool name; disappears on next token |

---

### TASK 11 — README & Documentation

**Goal:** Complete `README.md` enabling any developer to run the project in under 10 minutes.

**Sections:**

1. **Overview** — what it does; architecture ASCII diagram; note on the agentic approach
2. **Prerequisites** — Docker Desktop, Tableau Cloud account + PAT, Anthropic API key
3. **Quick Start**
   ```bash
   cp .env.example .env
   # Fill in credentials

   # Mac
   bash scripts/start-mac.sh

   # Linux
   bash scripts/start-linux.sh

   # Windows (PowerShell)
   .\scripts\start-windows.ps1

   # Open http://localhost:8000
   ```
4. **Stopping**
   ```bash
   bash scripts/stop-mac.sh        # Mac
   bash scripts/stop-linux.sh      # Linux
   .\scripts\stop-windows.ps1      # Windows
   ```
5. **Project Structure** — annotated directory tree
6. **Environment Variables** — full table: variable / description / required
7. **How It Works** — plain-English explanation of the agentic loop; list all 16 Tableau MCP tools the LLM can choose from
8. **Tableau MCP Setup** — PAT creation steps; required Explorer role; link to `tableau/tableau-mcp`
9. **Troubleshooting**

   | Symptom | Fix |
   |---------|-----|
   | Port 8000 in use | Change `8000:8000` to `8001:8000` in `docker-compose.yml` |
   | `/health` shows `mcp_tools: 0` | Check Tableau credentials in `.env`; verify PAT hasn't expired |
   | Agent loops without answering | Check `ANTHROPIC_API_KEY`; look at container logs for tool errors |
   | Docker build fails on `uv sync` | Delete `backend/uv.lock`, re-run `uv lock`, rebuild |

---

## Implementation Order

| Phase | Tasks | Goal |
|-------|-------|------|
| **Phase 1** | 1, 2 | Scaffolding + env config |
| **Phase 2** | 3 | MCP bridge — subprocess + dynamic tool list |
| **Phase 3** | 4, 5 | Agentic loop + FastAPI chat endpoint |
| **Phase 4** | 8 | Next.js frontend (static export) |
| **Phase 5** | 6, 7 | Single Docker build + platform scripts |
| **Phase 6** | 9, 10, 11 | Error handling + tests + README |

---

## Progress

| Task | Status | Notes |
|------|--------|-------|
| TASK 1 — Project Scaffolding | ✅ Done | `git init` done; `backend/` scaffolded with `uv` (pyproject.toml, uv.lock, app/); `frontend/` scaffolded with Next.js (TypeScript, Tailwind, App Router); `scripts/` created; `.gitignore` added covering Python/uv, Next.js/Node, env files, OS, IDE, Docker |
| TASK 2 — Environment Configuration | ✅ Done | `.env.example` at root; `backend/app/__init__.py` + `backend/app/config.py` (pydantic-settings); validated all 5 required vars load correctly |
| TASK 3 — MCP Bridge Service | ✅ Done | `backend/app/services/__init__.py` + `mcp_bridge.py`; `MCPBridge` class with `connect`/`disconnect`, `tools` property, `call_tool` with 3-attempt exponential backoff retry; launches `@tableau/mcp-server@latest` via `npx -y`; tested locally — 16 tools returned |
| TASK 4 — Agent Service | ✅ Done | `backend/app/services/agent.py`; `run_agent` async generator; streams `token`/`tool_call`/`done`/`error` SSE events; max 10 iterations guard; model `claude-sonnet-4-6` |
| TASK 5 — FastAPI Backend: Core & Chat Endpoint | ✅ Done | `backend/app/main.py` (lifespan, health, static mount); `backend/app/routers/chat.py` (`POST /api/chat` SSE); `STATIC_DIR` auto-detects Docker path vs local `frontend/out/`; tested — health returns `mcp_tools: 16`, chat streams `tool_call` + `token` events correctly |
| TASK 6 — Single Docker Container Build | ✅ Done | Multi-stage Dockerfile: node:20-slim frontend build + python:3.12-slim runtime with Node.js 20; `@tableau/mcp-server` pre-installed globally; docker-compose.yml with healthcheck |
| TASK 7 — Platform Scripts | ✅ Done | All 6 scripts (start/stop × mac/linux/windows) fully implemented with .env check, Docker check, docker compose up --build -d |
| TASK 8 — Next.js Frontend | ✅ Done | `lib/api.ts`, `hooks/useChat.ts`, `components/chat/` (ChatWindow, MessageBubble, ToolCallIndicator, MessageInput), `components/layout/Header.tsx`, `app/page.tsx` (landing), `app/chat/page.tsx`; static build clean; e2e tested — `/` and `/chat/` serve correctly, SSE stream flows `tool_call`→`token`→`done`, 2000-char validation enforced |
| TASK 9 — Error Handling | ⬜ Pending | |
| TASK 10 — Testing | ⬜ Pending | |
| TASK 11 — README & Documentation | ⬜ Pending | |

---

## Key Decisions & Constraints

| Decision | Rationale |
|----------|-----------|
| Agentic MCP tool use — no hardcoded wrappers | LLM decides which tools to call at runtime; works with all 16 current Tableau MCP tools and any future additions automatically |
| Single Docker container | Simplest MVP deployment; no orchestration overhead |
| Next.js `output: 'export'` served by FastAPI `StaticFiles` | Eliminates a separate Node server; one port, one process |
| No authentication | MVP only; add JWT + users table in v2 |
| `uv` for Python dependency management | Reproducible lockfile builds; fast Docker layer caching |
| Tableau MCP as stdio subprocess | Matches the official MCP transport; no extra port; lifecycle tied to the FastAPI process |
| No CORS config | Frontend and backend share origin `localhost:8000` |
| `event: tool_call` SSE event | Lets the frontend show users which tools the LLM is calling in real time — improves perceived responsiveness during multi-step queries |
| Max iteration guard in agent loop | Prevents runaway tool-call loops on malformed questions or unexpected MCP responses |
| Anthropic model: `claude-sonnet-4-20250514` | Strong tool-use reasoning at good speed; handles multi-step tool calls reliably |s
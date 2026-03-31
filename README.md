# Aida — Tableau Cloud AI Assistant

Ask questions about your Tableau Cloud data in plain English. Get answers backed by real data.

## Overview

Aida is packaged as a **single Docker container** (port 8000) running a FastAPI backend that serves a statically-built Next.js frontend. An agentic loop powered by Claude autonomously decides which Tableau MCP tools to call, runs them, and streams a synthesised answer back to the user.

```
Docker Container (port 8000)
┌──────────────────────────────────────────────┐
│  Browser → FastAPI (:8000)                   │
│            ├── /api/chat  → agentic loop     │
│            └── /          → Next.js static   │
│                │                             │
│                ├── Tableau MCP subprocess    │
│                │   └── Tableau Cloud (HTTPS) │
│                └── Anthropic API (HTTPS)     │
└──────────────────────────────────────────────┘
```

The LLM decides at runtime which tools to call — no hardcoded pipelines. New tools added to the Tableau MCP server are automatically available without any backend changes.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Tableau Cloud account with a Personal Access Token (PAT) and Explorer role or higher
- [Anthropic API key](https://console.anthropic.com/)

## Quick Start

```bash
cp .env.example .env
# Fill in your credentials in .env

# Mac
bash scripts/start-mac.sh

# Linux
bash scripts/start-linux.sh

# Windows (PowerShell)
.\scripts\start-windows.ps1

# Open http://localhost:8000
```

## Stopping

```bash
bash scripts/stop-mac.sh        # Mac
bash scripts/stop-linux.sh      # Linux
.\scripts\stop-windows.ps1      # Windows
```

## Project Structure

```
/
├── backend/                   # FastAPI (uv Python project)
│   └── app/
│       ├── main.py            # FastAPI app, lifespan, static mount
│       ├── config.py          # pydantic-settings
│       ├── routers/chat.py    # POST /api/chat (SSE)
│       └── services/
│           ├── mcp_bridge.py  # Tableau MCP subprocess lifecycle
│           └── agent.py       # Agentic loop: Anthropic ↔ MCP
│
├── frontend/                  # Next.js static export
│   ├── app/                   # App Router pages
│   ├── components/            # Chat UI components
│   ├── hooks/useChat.ts       # SSE stream state management
│   └── lib/api.ts             # fetch wrapper
│
├── scripts/                   # start/stop for Mac, Linux, Windows
├── Dockerfile                 # Multi-stage build
├── docker-compose.yml
└── .env.example
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Yes |
| `TABLEAU_SERVER_URL` | Tableau Cloud URL (e.g. `https://prod-in-a.online.tableau.com`) | Yes |
| `TABLEAU_SITE_NAME` | Tableau site name | Yes |
| `TABLEAU_PAT_NAME` | Personal Access Token name | Yes |
| `TABLEAU_PAT_SECRET` | Personal Access Token secret | Yes |
| `LOG_LEVEL` | Logging level (default: `INFO`) | No |

## How It Works

1. User sends a question via the chat UI
2. FastAPI passes the question + all available Tableau MCP tool definitions to Claude
3. Claude reasons about the question and calls whichever tools it needs (e.g. `list-datasources`, `query-datasource`, `get-view-data`)
4. Tool results are fed back to Claude; it may call further tools
5. Once Claude has enough data, it streams a final answer back token by token
6. The frontend renders the answer with markdown support and shows which tools were called in real time

Available Tableau MCP tools (16 total): `list-datasources`, `get-datasource-metadata`, `query-datasource`, `list-workbooks`, `list-views`, `get-view-data`, `get-view-image`, `search-content`, `list-all-pulse-metric-definitions`, `generate-pulse-insight-brief`, and more.

## Tableau MCP Setup

1. Log in to Tableau Cloud → **My Account Settings** → **Personal Access Tokens** → create a token
2. The account must have **Explorer** role or higher
3. Note the token name and secret — these go into `.env` as `TABLEAU_PAT_NAME` and `TABLEAU_PAT_SECRET`
4. More info: [tableau/tableau-mcp](https://github.com/tableau/tableau-mcp)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Port 8000 already in use | Change `8000:8000` to `8001:8000` in `docker-compose.yml` |
| `/health` shows `mcp_tools: 0` | Check Tableau credentials in `.env`; verify PAT hasn't expired |
| Agent loops without answering | Check `ANTHROPIC_API_KEY`; inspect container logs for tool errors |
| Docker build fails on `uv sync` | Delete `backend/uv.lock`, run `uv lock` inside `backend/`, rebuild |

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..main import anthropic_client, bridge
from ..services.agent import run_agent

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
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")

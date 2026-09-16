"""Authenticated local routes; preserve Desktop's original event transport."""

import threading
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()
_send_lock = threading.Lock()


class Prompt(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=200000)


class NewSession(BaseModel):
    cwd: str = Field(min_length=1, max_length=4096)
    profile: str = Field(default="default", pattern=r"^[a-zA-Z0-9_-]+$")


def invoke(method, params, transport):
    from tui_gateway import server
    token = server.bind_transport(transport)
    try:
        response = server.handle_request({"jsonrpc": "2.0", "id": "pokite",
            "method": method, "params": params})
    finally:
        server.reset_transport(token)
    if response is None:
        raise HTTPException(502, "Hermes did not confirm submission")
    if response.get("error"):
        raise HTTPException(422, response["error"].get("message", "Hermes rejected submission"))
    return response["result"]


@router.get("/sessions")
def sessions():
    from tui_gateway import server
    with server._sessions_lock:
        items = list(server._sessions.items())
    return {"version": 1, "sessions": [
        {**server._session_live_item(sid, session),
         "inflight": server._inflight_snapshot(session)}
        for sid, session in items if not session.get("_finalized")
    ]}


@router.post("/send")
def send(prompt: Prompt):
    from tui_gateway import server
    # Never resume/activate or supply our own transport: these steal Desktop's
    # event stream. The original session and original connection own execution.
    with _send_lock:
        session = server._sessions.get(prompt.session_id)
        if session is None or session.get("_finalized"):
            raise HTTPException(409, "Open this session in Hermes Desktop first")
        transport = session.get("transport")
        if transport is None or transport is server._detached_ws_transport:
            raise HTTPException(409, "Hermes Desktop session is disconnected")
        if server._session_live_status(prompt.session_id, session) != "idle":
            raise HTTPException(409, "Hermes Desktop session is busy")
        return invoke("prompt.submit", {"session_id": prompt.session_id,
            "text": prompt.text, "queued": True}, transport)


@router.post("/create")
def create(request: NewSession):
    from tui_gateway import server
    with server._sessions_lock:
        owners = [s.get("transport") for s in server._sessions.values()
            if not s.get("_finalized") and s.get("transport") is not server._detached_ws_transport]
    owner = next((t for t in owners if t is not None), None)
    if owner is None:
        raise HTTPException(409, "Open a session in Hermes Desktop first")
    return invoke("session.create", {"cwd": request.cwd,
        "profile": request.profile, "source": "desktop"}, owner)

"""Phone as an interface: call summaries and voicemail transcripts become conversations.

There is no outbound voice. A reply on a phone conversation is recorded in the
thread as a note for the colleague who calls back.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from bokito.channels import base
from bokito.channels.inbound import InboundMessage, ingest, new_external_id
from bokito.deps import DbSession
from bokito.domain.connection import ConnectionKind
from bokito.domain.conversation import Channel
from bokito.errors import NotFound, Unauthorized
from bokito.services import connections as conn_svc

router = APIRouter(prefix="/inbound", tags=["inbound"])


class PhoneEvent(BaseModel):
    from_number: str = Field(alias="from", min_length=3)
    caller_name: str = ""
    transcript: str = ""
    summary: str = ""
    recording_url: str = ""
    call_id: str | None = None
    duration_seconds: int | None = None

    model_config = {"populate_by_name": True}


@router.post(
    "/phone/{public_key}",
    summary="Call summary or voicemail (phone interface stub)",
    response_model=dict,
)
async def phone_inbound(
    public_key: str,
    body: PhoneEvent,
    session: DbSession,
    x_bokito_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    conn = await conn_svc.get_by_public_key(session, public_key)
    if not conn or conn.kind != ConnectionKind.phone:
        raise NotFound("phone connection not found", code="phone_not_found")
    creds = conn_svc.credentials_of(conn)
    secret = str(creds.get("secret") or "")
    if secret and x_bokito_secret != secret:
        raise Unauthorized("invalid secret", code="invalid_secret")
    text = body.summary or body.transcript or "[call]"
    if body.summary and body.transcript:
        text = f"{body.summary}\n\nTranscript:\n{body.transcript}"
    conv, msg, dup = await ingest(
        session,
        conn,
        InboundMessage(
            channel=Channel.phone,
            external_thread_id=f"phone:{conn.id}:{body.from_number}",
            external_message_id=body.call_id or new_external_id("call"),
            body=text,
            subject=f"Call from {body.caller_name or body.from_number}",
            sender_name=body.caller_name,
            sender_phone=body.from_number,
            attachments=[{"name": "recording", "url": body.recording_url}]
            if body.recording_url
            else [],
            meta={"duration_seconds": body.duration_seconds},
        ),
        queue_agent=False,
    )
    return {"conversation_id": str(conv.id), "message_id": str(msg.id), "duplicate": dup}


async def deliver_phone(session, connection, conv, msg) -> dict[str, Any]:
    return {"transport": "phone", "note": "callback by a colleague"}


base.register(Channel.phone, deliver_phone)

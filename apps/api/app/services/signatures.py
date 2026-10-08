"""Sender identity + signature resolution for outbound replies.

One coherent model:
- A reply is sent "as" an identity: a user (human approved / manual reply) or
  an agent (auto mode, or explicitly chosen at approval time).
- Exactly one signature is appended server-side, resolved by identity:
  user signature -> agent signature -> dynamic default from identity +
  workspace language -> mailbox ``signature_html`` fallback
  (the mailbox fallback lives in ``app.channels.email._append_signature``).
- Custom HTML may include ``{{name}}``, ``{{company}}``, ``{{function}}``,
  ``{{email}}``, ``{{phone}}``, ``{{website}}``, ``{{address}}`` placeholders.
  These are substituted at send/preview time from the active identity.
- The visible From *display name* follows the same identity; the From
  *address* stays the connected mailbox (OAuth deliverability).
- Agent signatures are plain text (converted to HTML at send time). Legacy
  ``email_signature_html`` still resolves.
- Every agent-identity send appends a small Bokito AI powered-by line with a
  link to https://bokito.ai (disclaimer + light branding).
- The model never writes its own sign-off (stripped by
  ``services/suggestion_format.py``), so signatures can never stack.
- Defaults are composed at send/preview time — not persisted — so they stay
  in sync with name, role, company, avatar, and language.
"""

from __future__ import annotations

import base64
import html
import json
import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.services.language import normalize_platform_language, resolve_workspace_language

SEND_AS_CHOICES = ("user", "agent")
DEFAULT_SEND_AS = "user"
# Per-agent default when unset: mail as the agent (not impersonate a human).
DEFAULT_AGENT_SEND_AS = "agent"

# Signatures are small fragments, not documents.
MAX_SIGNATURE_LENGTH = 5000

SIGNATURE_KEY = "email_signature_html"
SIGNATURE_TEXT_KEY = "email_signature_text"
REPLY_SEND_AS_KEY = "reply_send_as"
SIGNATURE_PHONE_KEY = "signature_phone"
SIGNATURE_WEBSITE_KEY = "signature_website"
SIGNATURE_ADDRESS_KEY = "signature_address"

_CLOSINGS = {
    "nl": "Met vriendelijke groet",
    "en": "Kind regards",
    "de": "Mit freundlichen Grüßen",
    "fr": "Cordialement",
    "es": "Un saludo",
}

_BOKITO_SITE = "https://bokito.ai"
_AVATAR_COLOR = "#4652f2"

# ``{{key}}`` placeholders. Aliases normalize editor tokens onto identity fields.
_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
_PLACEHOLDER_ALIASES = {
    "function": "job_title",
    "title": "job_title",
    "role": "job_title",
    "job": "job_title",
    "org": "company",
    "organisation": "company",
    "organization": "company",
    "tel": "phone",
    "telephone": "phone",
    "mobile": "phone",
    "web": "website",
    "url": "website",
    "addr": "address",
}

# Contact lines that become empty after substitution (e.g. "T: " / "E: ").
_EMPTY_LABEL_LINE_RE = re.compile(
    r"(?:^|<br\s*/?>|</p>\s*<p[^>]*>)\s*"
    r"(?:T|E|W|M|Tel\.?|Phone|Email|Web|Mobile|Fax)"
    r"\s*[:：]\s*(?:&nbsp;|\s)*"
    r"(?=(?:<br\s*/?>|</p>|</div>|</td>|$))",
    re.IGNORECASE,
)


def _settings(raw: str | None) -> dict:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def user_signature_html(user: User) -> str:
    """Raw stored template (may still contain ``{{placeholders}}``)."""
    return str(_settings(user.settings_json).get(SIGNATURE_KEY) or "").strip()


def user_signature_extras(user: User | None) -> dict[str, str]:
    """Optional contact fields stored in user settings for signature templates."""
    if user is None:
        return {}
    stored = _settings(user.settings_json)
    out: dict[str, str] = {}
    for key, settings_key in (
        ("phone", SIGNATURE_PHONE_KEY),
        ("website", SIGNATURE_WEBSITE_KEY),
        ("address", SIGNATURE_ADDRESS_KEY),
    ):
        value = str(stored.get(settings_key) or "").strip()
        if value:
            out[key] = value
    return out


def plain_text_to_signature_html(text: str) -> str:
    """Escape plain signature text and preserve line breaks."""
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    escaped = html.escape(cleaned)
    body = "<br>".join(line if line else "<br>" for line in escaped.splitlines())
    # Collapse accidental double blank markers from empty lines.
    body = re.sub(r"(?:<br>){3,}", "<br><br>", body)
    return f"<p>{body}</p>"


def html_signature_to_plain_text(value: str) -> str:
    """Best-effort plain text from a legacy HTML signature for the editor."""
    raw = (value or "").strip()
    if not raw:
        return ""
    text = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    text = re.sub(r"(?i)</p\s*>", "\n", text)
    text = re.sub(r"(?i)<[^>]+>", "", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    lines = [line.rstrip() for line in text.splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines).strip()


def agent_signature_text(agent: Agent) -> str:
    """Plain-text signature for an agent (preferred over legacy HTML)."""
    stored = _settings(agent.settings_json)
    text = str(stored.get(SIGNATURE_TEXT_KEY) or "").strip()
    if text:
        return text
    legacy = str(stored.get(SIGNATURE_KEY) or "").strip()
    if legacy:
        return html_signature_to_plain_text(legacy)
    return ""


def agent_signature_html(agent: Agent) -> str:
    """HTML body for the agent signature without the Bokito powered-by line."""
    text = agent_signature_text(agent)
    if text:
        return plain_text_to_signature_html(text)
    legacy = str(_settings(agent.settings_json).get(SIGNATURE_KEY) or "").strip()
    return legacy


def agent_reply_send_as(agent: Agent | None) -> str:
    """Per-agent default for Send as on approvals. Falls back to agent identity."""
    if agent is None:
        return DEFAULT_AGENT_SEND_AS
    value = str(_settings(agent.settings_json).get(REPLY_SEND_AS_KEY) or "").strip()
    return value if value in SEND_AS_CHOICES else DEFAULT_AGENT_SEND_AS


def tenant_reply_send_as(tenant: Tenant) -> str:
    """Tenant default for the send-as choice on approved suggestions."""
    value = str(_settings(tenant.settings_json).get("reply_send_as") or "").strip()
    return value if value in SEND_AS_CHOICES else DEFAULT_SEND_AS


def bokito_agent_disclaimer_html(language: str | None = None) -> str:
    """Subtle AI-agent disclaimer + Bokito branding under agent signatures."""
    lang = normalize_platform_language(language)
    if language and language in _CLOSINGS:
        lang = language
    if lang == "nl":
        lead = "Beantwoord door een AI-agent"
    else:
        lead = "Replied by an AI agent"
    return (
        f'<p style="margin:14px 0 0;padding-top:10px;border-top:1px solid #e8eaed;'
        f'font-size:11px;line-height:1.45;color:#9aa0a6">'
        f"{html.escape(lead)}"
        f" · Powered by "
        f'<a href="{_BOKITO_SITE}" style="color:#6b7280;text-decoration:underline" '
        f'target="_blank" rel="noopener noreferrer">Bokito AI</a></p>'
    )


def with_agent_disclaimer(signature_html: str, *, language: str | None = None) -> str:
    body = (signature_html or "").strip()
    disclaimer = bokito_agent_disclaimer_html(language)
    return f"{body}{disclaimer}" if body else disclaimer


def tenant_company_name(tenant: Tenant | None) -> str:
    if tenant is None:
        return ""
    return str(tenant.name or "").strip()


def _initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", (name or "").strip()) if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def initials_avatar_data_uri(name: str, *, color: str = _AVATAR_COLOR) -> str:
    """Tiny SVG avatar for email clients when no photo is set."""
    initials = html.escape(_initials(name), quote=True)
    fill = html.escape(color if re.fullmatch(r"#[0-9a-fA-F]{6}", color or "") else _AVATAR_COLOR)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
        f'<circle cx="48" cy="48" r="48" fill="{fill}"/>'
        f'<text x="48" y="52" text-anchor="middle" dominant-baseline="middle" '
        f'fill="#ffffff" font-family="system-ui,-apple-system,Segoe UI,sans-serif" '
        f'font-size="36" font-weight="600">{initials}</text></svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


def resolve_avatar_url_for_email(url: str | None, *, name: str) -> str:
    """Absolute / data URL suitable for an ``<img>`` in outbound mail."""
    raw = (url or "").strip()
    if raw.startswith("data:image/"):
        # Keep small data URIs; skip huge uploads that blow message size.
        if len(raw) <= 120_000:
            return raw
        return initials_avatar_data_uri(name)
    if raw:
        from app.services.agent_avatar import absolutize_avatar_url

        absolute = absolutize_avatar_url(raw)
        if absolute:
            return absolute
    return initials_avatar_data_uri(name)


def round_avatar_img_html(*, url: str, name: str, size: int = 48) -> str:
    safe_url = html.escape(url, quote=True)
    alt = html.escape((name or "Avatar").strip() or "Avatar", quote=True)
    return (
        f'<img src="{safe_url}" alt="{alt}" width="{size}" height="{size}" '
        f'style="border-radius:50%;display:block;width:{size}px;height:{size}px;'
        f'object-fit:cover;border:0" />'
    )


def signature_closing(language: str | None = None) -> str:
    lang = normalize_platform_language(language)
    if language and language in _CLOSINGS:
        lang = language
    return _CLOSINGS.get(lang, _CLOSINGS["en"])


def signature_identity_vars(
    *,
    name: str = "",
    email: str | None = None,
    job_title: str | None = None,
    company: str | None = None,
    phone: str | None = None,
    website: str | None = None,
    address: str | None = None,
    language: str | None = None,
) -> dict[str, str]:
    """Canonical placeholder map for templates and the default layout."""
    display = (name or "").strip() or (email or "").strip() or "Team"
    return {
        "name": display,
        "email": (email or "").strip(),
        "job_title": (job_title or "").strip(),
        "company": (company or "").strip(),
        "phone": (phone or "").strip(),
        "website": (website or "").strip(),
        "address": (address or "").strip(),
        "closing": signature_closing(language),
    }


def _cleanup_after_render(html_body: str) -> str:
    """Drop empty contact label lines and collapse excess breaks."""
    out = _EMPTY_LABEL_LINE_RE.sub("", html_body)
    out = re.sub(
        r"(?:<br\s*/?>\s*)+(?:T|E|W|M|Tel\.?|Phone|Email|Web|Mobile)\s*[:：]\s*(?=(?:<br\s*/?>|</p>|</div>|</td>|$))",
        "",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(r"(?:<br\s*/?>\s*){3,}", "<br><br>", out, flags=re.IGNORECASE)
    out = re.sub(r"(<p[^>]*>)\s*(?:<br\s*/?>\s*)+", r"\1", out, flags=re.IGNORECASE)
    out = re.sub(r"(?:<br\s*/?>\s*)+(</p>)", r"\1", out, flags=re.IGNORECASE)
    return out.strip()


def render_signature_template(template_html: str, variables: dict[str, str]) -> str:
    """Substitute ``{{placeholders}}`` and tidy empty contact lines.

    Unknown keys resolve to empty string so templates never leak raw tokens
    into customer mail. Values are HTML-escaped.
    """
    raw = (template_html or "").strip()
    if not raw:
        return ""

    def repl(match: re.Match[str]) -> str:
        key = match.group(1).strip().lower()
        canonical = _PLACEHOLDER_ALIASES.get(key, key)
        value = variables.get(canonical, variables.get(key, ""))
        return html.escape(str(value or ""))

    rendered = _PLACEHOLDER_RE.sub(repl, raw)
    return _cleanup_after_render(rendered)


def compose_default_signature_html(
    *,
    name: str,
    email: str | None = None,
    job_title: str | None = None,
    company: str | None = None,
    phone: str | None = None,
    website: str | None = None,
    address: str | None = None,
    language: str | None = None,
    avatar_url: str | None = None,
) -> str:
    """Modern default: closing + round avatar left, identity/contact right.

    Not persisted — callers treat this as the effective signature when the
    user/agent has not configured a custom one.
    """
    vars_ = signature_identity_vars(
        name=name,
        email=email,
        job_title=job_title,
        company=company,
        phone=phone,
        website=website,
        address=address,
        language=language,
    )
    display = vars_["name"]
    closing = vars_["closing"]

    avatar_src = resolve_avatar_url_for_email(avatar_url, name=display)
    avatar = round_avatar_img_html(url=avatar_src, name=display, size=48)

    detail_bits: list[str] = [
        f'<div style="font-weight:600;color:#111827;font-size:14px;line-height:1.35">'
        f"{html.escape(display)}</div>"
    ]
    if vars_["job_title"]:
        detail_bits.append(
            f'<div style="color:#6b7280;font-size:13px;line-height:1.35;margin-top:2px">'
            f"{html.escape(vars_['job_title'])}</div>"
        )
    if vars_["company"]:
        detail_bits.append(
            f'<div style="color:#6b7280;font-size:13px;line-height:1.35;margin-top:1px">'
            f"{html.escape(vars_['company'])}</div>"
        )

    contact_parts: list[str] = []
    if vars_["email"] and vars_["email"].lower() != display.lower():
        addr = html.escape(vars_["email"])
        contact_parts.append(
            f'<a href="mailto:{addr}" style="color:#4b5563;text-decoration:none">{addr}</a>'
        )
    if vars_["phone"]:
        phone_esc = html.escape(vars_["phone"])
        contact_parts.append(
            f'<a href="tel:{phone_esc}" style="color:#4b5563;text-decoration:none">{phone_esc}</a>'
        )
    if vars_["website"]:
        site = vars_["website"]
        href = site if re.match(r"^https?://", site, re.I) else f"https://{site}"
        contact_parts.append(
            f'<a href="{html.escape(href, quote=True)}" style="color:#4b5563;text-decoration:none" '
            f'target="_blank" rel="noopener noreferrer">{html.escape(site)}</a>'
        )
    if vars_["address"]:
        contact_parts.append(html.escape(vars_["address"]))
    if contact_parts:
        detail_bits.append(
            '<div style="margin-top:8px;font-size:12px;line-height:1.5;color:#4b5563">'
            + '<span style="color:#d1d5db"> · </span>'.join(contact_parts)
            + "</div>"
        )

    details = "".join(detail_bits)
    return (
        f'<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'
        f'font-size:14px;line-height:1.45;color:#1f2937">'
        f'<p style="margin:0 0 14px 0">{html.escape(closing)},</p>'
        f'<table cellpadding="0" cellspacing="0" border="0" role="presentation" '
        f'style="border-collapse:collapse">'
        f'<tr>'
        f'<td style="vertical-align:top;padding:0 14px 0 0">{avatar}</td>'
        f'<td style="vertical-align:top;padding:0 0 0 14px;border-left:2px solid #e5e7eb">'
        f"{details}</td>"
        f"</tr></table></div>"
    )


async def resolve_from_display_name(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    send_as: str,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
) -> str | None:
    """Visible From display name for the chosen send-as identity.

    The mailbox *address* always stays the connected ChannelAccount address
    (OAuth deliverability). Only the display name follows user vs agent so
    customers see who is speaking in the From line, matching the signature.
    """
    if send_as == "user" and user_id:
        user = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if user:
            return (user.display_name or user.email or "").strip() or None
        return None

    if agent_id:
        agent = (
            await session.execute(
                select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if agent:
            return (agent.name or "Assistant").strip() or None
    return None


def _agent_avatar_url(agent: Agent | None) -> str | None:
    if agent is None:
        return None
    from app.services.agent_avatar import absolutize_avatar_url, avatar_payload

    payload = avatar_payload(agent)
    url = absolutize_avatar_url(str(payload.get("avatar_image_url") or "") or None)
    return url or None


async def resolve_signature_html(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    send_as: str,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
) -> str | None:
    """Resolve the one signature for this send.

    Chain: identity custom HTML (placeholders rendered) → other-identity custom
    → dynamic modern default from the active identity → ``None`` so the email
    adapter can use the mailbox ``signature_html``.

    Agent-identity sends always include the Bokito powered-by disclaimer.
    """
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    language = resolve_workspace_language(tenant)
    company = tenant_company_name(tenant)

    user: User | None = None
    if user_id:
        user = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()

    agent: Agent | None = None
    if agent_id:
        agent = (
            await session.execute(
                select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()

    user_extras = user_signature_extras(user)
    user_vars = signature_identity_vars(
        name=(user.display_name or user.email) if user else "",
        email=user.email if user else None,
        job_title=user.job_title if user else None,
        company=company,
        phone=user_extras.get("phone"),
        website=user_extras.get("website"),
        address=user_extras.get("address"),
        language=language,
    )
    agent_vars = signature_identity_vars(
        name=(agent.name or "Assistant") if agent else "Assistant",
        company=company,
        language=language,
    )

    if send_as == "user" and user:
        signature = user_signature_html(user)
        if signature:
            return render_signature_template(signature, user_vars)

    if agent:
        signature = agent_signature_html(agent)
        if signature:
            rendered = render_signature_template(signature, agent_vars if send_as == "agent" else user_vars)
            if send_as == "agent":
                return with_agent_disclaimer(rendered, language=language)
            return rendered

    if send_as == "user" and user:
        return compose_default_signature_html(
            name=user.display_name or user.email,
            email=user.email,
            job_title=user.job_title,
            company=company,
            phone=user_extras.get("phone"),
            website=user_extras.get("website"),
            address=user_extras.get("address"),
            language=language,
            avatar_url=user.avatar_url,
        )

    if agent:
        body = compose_default_signature_html(
            name=agent.name or "Assistant",
            company=company,
            language=language,
            avatar_url=_agent_avatar_url(agent),
        )
        if send_as == "agent":
            return with_agent_disclaimer(body, language=language)
        return body

    return None

"""Sender identity + signature resolution for outbound replies.

One coherent model:
- A reply is sent "as" an identity: a user (human approved / manual reply) or
  an agent (auto mode, or explicitly chosen at approval time).
- Exactly one signature is appended server-side:
  - **Agent send:** agent custom → dynamic default (+ Bokito disclaimer).
  - **User send:** per-mailbox ``signature_source`` on the ChannelAccount:
    - ``mailbox`` — mailbox ``signature_html`` template (placeholders from
      the sender); if empty → personal user template → dynamic default.
    - ``sender`` — personal user template → dynamic default (ignore mailbox).
  Default source is ``mailbox``. Personal templates live on the user profile;
  mailbox templates are edited under Settings → Channels.
- Custom HTML may include ``{{name}}``, ``{{first_name}}``, ``{{last_name}}``,
  ``{{company}}``, ``{{function}}``, ``{{email}}``, ``{{phone}}``,
  ``{{website}}``, ``{{address}}`` placeholders. These are substituted at
  send/preview time from the active identity.
- The visible From *display name* follows the same identity; the From
  *address* stays the connected mailbox (OAuth deliverability).
- Agent signatures are plain text (converted to HTML at send time). Legacy
  ``email_signature_html`` still resolves.
- Every agent-identity send appends a small Bokito AI powered-by line with a
  link to https://bokito.ai (disclaimer + light branding).
- The model never writes its own sign-off (stripped by
  ``services/suggestion_format.py``), so signatures can never stack.
- Defaults are text-only (no avatar image) and composed at send/preview time —
  not persisted — so they stay in sync with name, role, company, and language.
  Photo layout is opt-in via ``{{avatar}}`` (https photo, otherwise an initials circle).
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.channel import ChannelAccount
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

# ChannelAccount.settings_json: who supplies the signature for human sends.
MAILBOX_SIGNATURE_HTML_KEY = "signature_html"
SIGNATURE_SOURCE_KEY = "signature_source"
SIGNATURE_SOURCE_MAILBOX = "mailbox"
SIGNATURE_SOURCE_SENDER = "sender"
SIGNATURE_SOURCES = frozenset({SIGNATURE_SOURCE_MAILBOX, SIGNATURE_SOURCE_SENDER})
DEFAULT_SIGNATURE_SOURCE = SIGNATURE_SOURCE_MAILBOX

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
    "firstname": "first_name",
    "first": "first_name",
    "voornaam": "first_name",
    "lastname": "last_name",
    "last": "last_name",
    "surname": "last_name",
    "achternaam": "last_name",
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


def mailbox_signature_html(account: ChannelAccount | None) -> str:
    """Raw mailbox template from ChannelAccount settings."""
    if account is None:
        return ""
    return str(_settings(account.settings_json).get(MAILBOX_SIGNATURE_HTML_KEY) or "").strip()


def mailbox_signature_source(account: ChannelAccount | None) -> str:
    """``mailbox`` (shared template) or ``sender`` (personal). Default mailbox."""
    if account is None:
        return SIGNATURE_SOURCE_SENDER
    raw = str(_settings(account.settings_json).get(SIGNATURE_SOURCE_KEY) or "").strip().lower()
    return raw if raw in SIGNATURE_SOURCES else DEFAULT_SIGNATURE_SOURCE


def set_mailbox_signature(
    account: ChannelAccount,
    *,
    signature_html: str | None = None,
    signature_source: str | None = None,
) -> None:
    """Persist mailbox template and/or source policy on the channel account."""
    settings = _settings(account.settings_json)
    if signature_html is not None:
        cleaned = (signature_html or "").strip()
        if cleaned:
            settings[MAILBOX_SIGNATURE_HTML_KEY] = cleaned[:MAX_SIGNATURE_LENGTH]
        else:
            settings.pop(MAILBOX_SIGNATURE_HTML_KEY, None)
    if signature_source is not None:
        source = (signature_source or "").strip().lower()
        if source in SIGNATURE_SOURCES:
            settings[SIGNATURE_SOURCE_KEY] = source
        else:
            settings.pop(SIGNATURE_SOURCE_KEY, None)
    account.settings_json = json.dumps(settings)


def tenant_signature_html(tenant: Tenant | None) -> str:
    """Legacy workspace template (no longer used in resolve; kept for reads)."""
    if tenant is None:
        return ""
    return str(_settings(tenant.settings_json).get(SIGNATURE_KEY) or "").strip()


def set_tenant_signature_html(tenant: Tenant, signature: str) -> None:
    """Legacy persist for workspace template (prefer mailbox signatures)."""
    settings = _settings(tenant.settings_json)
    cleaned = (signature or "").strip()
    if cleaned:
        settings[SIGNATURE_KEY] = cleaned[:MAX_SIGNATURE_LENGTH]
    else:
        settings.pop(SIGNATURE_KEY, None)
    tenant.settings_json = json.dumps(settings)


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
    first_name: str | None = None,
    last_name: str | None = None,
    email: str | None = None,
    job_title: str | None = None,
    company: str | None = None,
    phone: str | None = None,
    website: str | None = None,
    address: str | None = None,
    language: str | None = None,
) -> dict[str, str]:
    """Canonical placeholder map for templates and the default layout."""
    from app.services.user_names import compose_display_name, split_display_name

    first = (first_name or "").strip()
    last = (last_name or "").strip()
    display = (
        (name or "").strip()
        or compose_display_name(first, last)
        or (email or "").strip()
        or "Team"
    )
    if not first and not last and display:
        first, last = split_display_name(display)
    return {
        "name": display,
        "first_name": first,
        "last_name": last,
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


def render_signature_template(
    template_html: str,
    variables: dict[str, str],
    *,
    avatar_url: str | None = None,
) -> str:
    """Substitute ``{{placeholders}}`` and tidy empty contact lines.

    Unknown keys resolve to empty string so templates never leak raw tokens
    into customer mail. Values are HTML-escaped. ``{{avatar}}`` injects a safe
    photo ``<img>`` when ``avatar_url`` is a usable http(s) URL; otherwise an initials circle.
    """
    raw = (template_html or "").strip()
    if not raw:
        return ""

    def repl(match: re.Match[str]) -> str:
        key = match.group(1).strip().lower()
        canonical = _PLACEHOLDER_ALIASES.get(key, key)
        if canonical == "avatar":
            return avatar_placeholder_html(
                avatar_url=avatar_url,
                name=str(variables.get("name") or ""),
            )
        value = variables.get(canonical, variables.get(key, ""))
        return html.escape(str(value or ""))

    rendered = _PLACEHOLDER_RE.sub(repl, raw)
    return _cleanup_after_render(rendered)


_RASTER_DATA_RE = re.compile(
    r"^data:image/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$",
    re.IGNORECASE,
)


def raster_avatar_bytes(url: str | None) -> tuple[str, bytes] | None:
    """Decode a profile photo stored as a raster data URI. SVG is refused."""
    match = _RASTER_DATA_RE.match((url or "").strip())
    if not match:
        return None
    mime = match.group(1).lower()
    if mime == "jpg":
        mime = "jpeg"
    try:
        data = base64.b64decode(re.sub(r"\s+", "", match.group(2)))
    except Exception:
        return None
    if not data or len(data) > 512_000:
        return None
    return f"image/{mime}", data


def email_avatar_src(url: str | None, *, user_id: UUID | None = None) -> str | None:
    """Image URL a mail client can fetch.

    https photos pass through. A profile picture stored as a raster data URI
    is served from ``/api/auth/avatars/{user_id}`` so the message stays small
    and clients that strip data URIs still show the photo.
    """
    direct = photo_avatar_url_for_email(url)
    if direct:
        return direct
    if user_id is None or raster_avatar_bytes(url) is None:
        return None
    from app.config import get_settings

    digest = hashlib.sha256((url or "").encode("utf-8")).hexdigest()[:12]
    base = get_settings().public_api_url.rstrip("/")
    return f"{base}/api/auth/avatars/{user_id}?v={digest}"


def photo_avatar_url_for_email(url: str | None) -> str | None:
    """HTTPS (or absolute) photo URL safe for mail clients — never data URIs.

    Many clients strip or break ``data:`` images and relative paths, so the
    default signature stays text-only; photo is opt-in via ``{{avatar}}``.
    """
    raw = (url or "").strip()
    if not raw or raw.startswith("data:"):
        return None
    if raw.startswith("https://") or raw.startswith("http://"):
        return raw
    from app.services.agent_avatar import absolutize_avatar_url

    absolute = absolutize_avatar_url(raw)
    if absolute and (absolute.startswith("https://") or absolute.startswith("http://")):
        return absolute
    return None


def initials_avatar_html(name: str, *, size: int = 48) -> str:
    """Circle with initials. No image, so mail still shows a mark without a photo."""
    initials = html.escape(_initials(name))
    radius = max(1, size // 2)
    font = max(12, round(size * 0.36))
    return (
        '<table cellpadding="0" cellspacing="0" border="0" role="presentation" '
        'style="border-collapse:collapse">'
        f'<tr><td width="{size}" height="{size}" align="center" valign="middle" '
        f'style="width:{size}px;height:{size}px;background:{_AVATAR_COLOR};'
        f'border-radius:{radius}px;color:#ffffff;'
        f'font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:{font}px;'
        f'font-weight:600;line-height:{size}px;text-align:center">{initials}</td></tr></table>'
    )


def avatar_placeholder_html(*, avatar_url: str | None, name: str, size: int = 48) -> str:
    """``{{avatar}}``: https photo, or an initials circle when there is no photo."""
    photo = photo_avatar_url_for_email(avatar_url)
    if photo:
        return round_avatar_img_html(url=photo, name=name, size=size)
    return initials_avatar_html(name, size=size)


def _signature_detail_bits(vars_: dict[str, str]) -> str:
    display = vars_["name"]
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
    return "".join(detail_bits)


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
    """Text-only default: closing + name / role / company / contacts.

    No avatar image — SVG data URIs and many hosted photos break in mail
    clients. Opt in with a custom template that includes ``{{avatar}}``.
    ``avatar_url`` is accepted for API compatibility but unused here.
    """
    del avatar_url  # unused in text default
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
    closing = vars_["closing"]
    details = _signature_detail_bits(vars_)
    return (
        f'<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'
        f'font-size:14px;line-height:1.45;color:#1f2937">'
        f'<p style="margin:0 0 14px 0">{html.escape(closing)},</p>'
        f'<div style="padding-left:14px;border-left:2px solid #e5e7eb">{details}</div>'
        f"</div>"
    )


def compose_avatar_signature_html(
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
    """Optional layout with photo left + details right; falls back to text default."""
    photo = photo_avatar_url_for_email(avatar_url)
    if not photo:
        return compose_default_signature_html(
            name=name,
            email=email,
            job_title=job_title,
            company=company,
            phone=phone,
            website=website,
            address=address,
            language=language,
        )
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
    avatar = round_avatar_img_html(url=photo, name=display, size=48)
    details = _signature_detail_bits(vars_)
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
            from app.services.user_names import user_full_name

            return (user_full_name(user) or user.email or "").strip() or None
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
    channel_account: ChannelAccount | None = None,
    channel_account_id: UUID | None = None,
) -> str | None:
    """Resolve the one signature for this send.

    Agent send: agent custom → dynamic default (+ disclaimer).
    User send: mailbox template when source=mailbox → personal → default.
    When source=sender (or no channel): personal → default.

    Agent-identity sends always include the Bokito powered-by disclaimer.
    """
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    language = resolve_workspace_language(tenant)
    company = tenant_company_name(tenant)

    account = channel_account
    if account is None and channel_account_id is not None:
        account = (
            await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.id == channel_account_id,
                    ChannelAccount.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()

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

    from app.services.user_names import user_full_name

    user_extras = user_signature_extras(user)
    user_vars = signature_identity_vars(
        name=user_full_name(user) if user else "",
        first_name=user.first_name if user else None,
        last_name=user.last_name if user else None,
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

    if send_as == "agent" and agent:
        agent_avatar = _agent_avatar_url(agent)
        signature = agent_signature_html(agent)
        if signature:
            rendered = render_signature_template(
                signature, agent_vars, avatar_url=agent_avatar
            )
            return with_agent_disclaimer(rendered, language=language)
        body = compose_default_signature_html(
            name=agent.name or "Assistant",
            company=company,
            language=language,
        )
        return with_agent_disclaimer(body, language=language)

    if send_as == "user" and user:
        avatar_src = email_avatar_src(user.avatar_url, user_id=user.id)
        source = mailbox_signature_source(account)
        if source == SIGNATURE_SOURCE_MAILBOX:
            mailbox_template = mailbox_signature_html(account)
            if mailbox_template:
                return render_signature_template(
                    mailbox_template, user_vars, avatar_url=avatar_src
                )
        personal = user_signature_html(user)
        if personal:
            return render_signature_template(
                personal, user_vars, avatar_url=avatar_src
            )
        return compose_default_signature_html(
            name=user_full_name(user) or user.email,
            email=user.email,
            job_title=user.job_title,
            company=company,
            phone=user_extras.get("phone"),
            website=user_extras.get("website"),
            address=user_extras.get("address"),
            language=language,
        )

    return None

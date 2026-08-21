"""Transactional mail for auth and member-lifecycle flows.

Delivery order: Resend HTTP API -> SMTP -> dev log. Actual delivery runs in a
background task with retries so a provider outage never blocks or fails the
calling flow (invites, password reset, verification). `send_mail` returns True
when a provider is configured and delivery was scheduled; without a provider
the mail is logged and False is returned so callers (and the UI) can surface
"mail not configured" and offer copyable links instead.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import smtplib
from email.message import EmailMessage
from html import escape
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"

# Seconds to wait before each attempt (first is immediate).
RETRY_DELAYS: tuple[float, ...] = (0.0, 5.0, 25.0)

# Strong references to in-flight delivery tasks; asyncio only keeps weak ones.
_delivery_tasks: set[asyncio.Task] = set()


def mail_configured() -> bool:
    settings = get_settings()
    return bool(settings.resend_api_key or settings.smtp_host)


def _mail_from() -> str:
    settings = get_settings()
    return settings.mail_from or settings.smtp_from


# ---------------------------------------------------------------------------
# HTML template (single branded layout, inline CSS, plain-text alternative
# always provided by callers)
# ---------------------------------------------------------------------------

_P_STYLE = "margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;"
_MUTED_STYLE = "margin:24px 0 0;font-size:13px;line-height:1.5;color:#a1a1aa;"


_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$")


def tenant_mail_branding(tenant: Any | None) -> dict[str, str | None]:
    """Branding fields for tenant-facing mails (digests, notifications).

    Logo is only used when it is a hosted URL — data URIs are stripped by most
    mail clients. Color must be a hex value to survive inline CSS safely.
    """
    if tenant is None:
        return {"brand_name": None, "brand_color": None, "logo_url": None}
    color: str | None = None
    try:
        settings = json.loads(tenant.settings_json or "{}")
        appearance = settings.get("appearance") if isinstance(settings, dict) else {}
        raw = (appearance or {}).get("main_color") if isinstance(appearance, dict) else None
        if isinstance(raw, str) and _HEX_COLOR_RE.match(raw.strip()):
            color = raw.strip()
    except (json.JSONDecodeError, AttributeError):
        pass
    logo = getattr(tenant, "logo_url", None)
    if not (isinstance(logo, str) and logo.startswith(("http://", "https://"))):
        logo = None
    return {"brand_name": tenant.name or None, "brand_color": color, "logo_url": logo}


def render_mail_html(
    *,
    title: str,
    paragraphs: list[str],
    cta_label: str | None = None,
    cta_url: str | None = None,
    footer: str = "",
    brand_name: str | None = None,
    brand_color: str | None = None,
    logo_url: str | None = None,
) -> str:
    """Minimal branded transactional layout. All values are escaped.

    Platform mails omit the branding args and render as "Bokito"; tenant-facing
    mails (digests, notifications) pass `tenant_mail_branding(tenant)` values.
    """
    button_color = brand_color if brand_color and _HEX_COLOR_RE.match(brand_color) else "#18181b"
    parts: list[str] = [f'<p style="{_P_STYLE}">{escape(p)}</p>' for p in paragraphs]
    if cta_label and cta_url:
        parts.append(
            '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">'
            f"<tr><td style=\"border-radius:8px;background:{button_color};\">"
            f'<a href="{escape(cta_url, quote=True)}" '
            'style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;'
            'color:#fafafa;text-decoration:none;">'
            f"{escape(cta_label)}</a></td></tr></table>"
        )
        parts.append(
            f'<p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:#a1a1aa;">'
            f"Or copy this link into your browser:<br>"
            f'<a href="{escape(cta_url, quote=True)}" style="color:#71717a;word-break:break-all;">'
            f"{escape(cta_url)}</a></p>"
        )
    if footer:
        parts.append(f'<p style="{_MUTED_STYLE}">{escape(footer)}</p>')
    body = "".join(parts)
    if logo_url:
        wordmark = (
            f'<img src="{escape(logo_url, quote=True)}" alt="{escape(brand_name or "Bokito")}" '
            'height="28" style="display:block;height:28px;max-width:180px;margin:0 0 24px;" />'
        )
    else:
        wordmark = (
            '<p style="margin:0 0 24px;font-size:15px;font-weight:700;letter-spacing:0.02em;'
            f'color:#18181b;">{escape(brand_name or "Bokito")}</p>'
        )
    return (
        "<!doctype html><html><body style=\"margin:0;padding:0;background:#f4f4f5;\">"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;'
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"
        'text-align:left;"><tr><td>'
        f"{wordmark}"
        f'<h1 style="margin:0 0 16px;font-size:19px;line-height:1.4;color:#18181b;">{escape(title)}</h1>'
        f"{body}"
        "</td></tr></table>"
        '<p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;">Powered by Bokito - the inbox, '
        "the agents, and the approvals in one system.</p>"
        "</td></tr></table></body></html>"
    )


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------


async def _deliver_resend(to: str, subject: str, text: str, html: str | None) -> None:
    settings = get_settings()
    payload: dict = {"from": _mail_from(), "to": [to], "subject": subject, "text": text}
    if html:
        payload["html"] = html
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            RESEND_API_URL,
            json=payload,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        )
        response.raise_for_status()


def _deliver_smtp_sync(to: str, subject: str, text: str, html: str | None) -> None:
    settings = get_settings()
    msg = EmailMessage()
    msg["From"] = _mail_from()
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    # Implicit SSL (SMTPS, e.g. Spacemail port 465) vs STARTTLS (port 587).
    use_ssl = settings.smtp_ssl or settings.smtp_port == 465
    smtp_cls = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    with smtp_cls(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if not use_ssl and settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)


async def _attempt_delivery(to: str, subject: str, text: str, html: str | None) -> None:
    """Try Resend first, then SMTP. Raises when every configured provider fails."""
    settings = get_settings()
    last_error: Exception | None = None
    if settings.resend_api_key:
        try:
            await _deliver_resend(to, subject, text, html)
            return
        except Exception as exc:  # fall through to SMTP
            last_error = exc
            logger.warning("resend delivery to %s failed: %s", to, exc)
    if settings.smtp_host:
        await asyncio.to_thread(_deliver_smtp_sync, to, subject, text, html)
        return
    raise last_error if last_error else RuntimeError("no mail provider configured")


async def _deliver_with_retry(
    to: str, subject: str, text: str, html: str | None, kind: str
) -> None:
    for attempt, delay in enumerate(RETRY_DELAYS, start=1):
        if delay:
            await asyncio.sleep(delay)
        try:
            await _attempt_delivery(to, subject, text, html)
            logger.info("mail delivered kind=%s to=%s attempt=%d", kind, to, attempt)
            return
        except Exception:
            logger.exception(
                "mail delivery attempt %d/%d failed kind=%s to=%s",
                attempt,
                len(RETRY_DELAYS),
                kind,
                to,
            )
    logger.error("mail delivery gave up kind=%s to=%s", kind, to)


async def send_mail(
    to: str, subject: str, text: str, html: str | None = None, *, kind: str = "generic"
) -> bool:
    """Schedule a transactional mail.

    Returns True when a provider is configured and delivery was scheduled
    (fire-and-forget with retries); False when mail is unconfigured (dev log).
    """
    if not mail_configured():
        logger.info(
            "[mail:dev] kind=%s to=%s subject=%r body=%r", kind, to, subject, text[:500]
        )
        return False
    task = asyncio.create_task(_deliver_with_retry(to, subject, text, html, kind))
    _delivery_tasks.add(task)
    task.add_done_callback(_delivery_tasks.discard)
    return True


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


async def send_invite_mail(
    to: str, *, invite_link: str, tenant_name: str, inviter_name: str
) -> bool:
    subject = f"{inviter_name} invited you to {tenant_name} on Bokito"
    text = (
        f"{inviter_name} invited you to join the {tenant_name} workspace on Bokito.\n\n"
        f"Accept the invite and set up your account:\n{invite_link}\n\n"
        "This link expires in 7 days. If you were not expecting this invite you can ignore this email."
    )
    html = render_mail_html(
        title=f"Join {tenant_name} on Bokito",
        paragraphs=[
            f"{inviter_name} invited you to join the {tenant_name} workspace on Bokito."
        ],
        cta_label="Accept invite",
        cta_url=invite_link,
        footer=(
            "This link expires in 7 days. If you were not expecting this invite "
            "you can ignore this email."
        ),
    )
    return await send_mail(to, subject, text, html, kind="invite")


async def send_password_reset_mail(to: str, *, reset_link: str) -> bool:
    subject = "Reset your Bokito password"
    text = (
        "A password reset was requested for your Bokito account.\n\n"
        f"Set a new password:\n{reset_link}\n\n"
        "This link expires in 60 minutes. If you did not request this you can ignore this email."
    )
    html = render_mail_html(
        title="Reset your password",
        paragraphs=["A password reset was requested for your Bokito account."],
        cta_label="Set a new password",
        cta_url=reset_link,
        footer=(
            "This link expires in 60 minutes. If you did not request this "
            "you can ignore this email."
        ),
    )
    return await send_mail(to, subject, text, html, kind="password_reset")


async def send_verification_mail(to: str, *, verify_link: str) -> bool:
    subject = "Verify your email address"
    text = (
        "Confirm this email address for your Bokito account.\n\n"
        f"Verify your email:\n{verify_link}\n\n"
        "This link expires in 24 hours. If you did not request this you can ignore this email."
    )
    html = render_mail_html(
        title="Verify your email address",
        paragraphs=["Confirm this email address for your Bokito account."],
        cta_label="Verify email",
        cta_url=verify_link,
        footer=(
            "This link expires in 24 hours. If you did not request this "
            "you can ignore this email."
        ),
    )
    return await send_mail(to, subject, text, html, kind="email_verify")


async def send_welcome_mail(to: str, *, tenant_name: str, app_url: str) -> bool:
    subject = f"Welcome to {tenant_name} on Bokito"
    text = (
        f"Your account is ready and you are now a member of {tenant_name}.\n\n"
        f"Open Bokito:\n{app_url}\n"
    )
    html = render_mail_html(
        title=f"Welcome to {tenant_name}",
        paragraphs=[f"Your account is ready and you are now a member of {tenant_name}."],
        cta_label="Open Bokito",
        cta_url=app_url,
    )
    return await send_mail(to, subject, text, html, kind="welcome")


async def send_onboarding_channel_nudge(to: str, *, tenant_name: str) -> bool:
    """One-time return nudge: workspace exists >=24h but no channel connected."""
    settings = get_settings()
    channels_url = f"{settings.public_app_url.rstrip('/')}/settings/channels"
    subject = "Connect your first channel to Bokito"
    paragraphs = [
        f"Your workspace {tenant_name} is ready, but no channel is connected yet.",
        "Connect a mailbox (or the chat widget) and Bokito starts triaging incoming "
        "conversations, suggesting replies, and asking you only when a decision is needed.",
        "It takes about two minutes.",
    ]
    text = "\n\n".join(paragraphs) + f"\n\nConnect a channel: {channels_url}"
    html = render_mail_html(
        title="Your inbox is waiting",
        paragraphs=paragraphs,
        cta_label="Connect a channel",
        cta_url=channels_url,
        footer="You receive this once because your workspace has no connected channel yet.",
    )
    return await send_mail(to, subject, text, html, kind="onboarding_nudge")


async def send_password_changed_mail(to: str) -> bool:
    subject = "Your Bokito password was changed"
    text = (
        "The password for your Bokito account was just changed and all active "
        "sessions were signed out.\n\n"
        "If this was you, no action is needed. If you did not do this, reset "
        "your password immediately and contact your workspace owner."
    )
    html = render_mail_html(
        title="Your password was changed",
        paragraphs=[
            "The password for your Bokito account was just changed and all active "
            "sessions were signed out.",
            "If this was you, no action is needed. If you did not do this, reset "
            "your password immediately and contact your workspace owner.",
        ],
    )
    return await send_mail(to, subject, text, html, kind="password_changed")

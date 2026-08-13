"""Transactional mail for auth flows (invites, password reset, verification).

Sends via SMTP when SMTP_HOST is configured; otherwise logs the mail so dev
environments keep working without an SMTP server (auth endpoints additionally
return dev magic links outside production).
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.config import get_settings

logger = logging.getLogger(__name__)


def mail_configured() -> bool:
    return bool(get_settings().smtp_host)


def _send_sync(to: str, subject: str, text: str) -> None:
    settings = get_settings()
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)


async def send_mail(to: str, subject: str, text: str) -> bool:
    """Send a plain-text mail. Returns True when actually delivered via SMTP."""
    if not mail_configured():
        logger.info("[mail:dev] to=%s subject=%r body=%r", to, subject, text[:500])
        return False
    try:
        await asyncio.to_thread(_send_sync, to, subject, text)
        return True
    except Exception:
        logger.exception("transactional mail to %s failed", to)
        return False


async def send_invite_mail(
    to: str, *, invite_link: str, tenant_name: str, inviter_name: str
) -> bool:
    subject = f"{inviter_name} invited you to {tenant_name} on Bokito"
    text = (
        f"{inviter_name} invited you to join the {tenant_name} workspace on Bokito.\n\n"
        f"Accept the invite and set up your account:\n{invite_link}\n\n"
        "This link expires in 7 days. If you were not expecting this invite you can ignore this email."
    )
    return await send_mail(to, subject, text)


async def send_password_reset_mail(to: str, *, reset_link: str) -> bool:
    subject = "Reset your Bokito password"
    text = (
        "A password reset was requested for your Bokito account.\n\n"
        f"Set a new password:\n{reset_link}\n\n"
        "This link expires in 60 minutes. If you did not request this you can ignore this email."
    )
    return await send_mail(to, subject, text)


async def send_verification_mail(to: str, *, verify_link: str) -> bool:
    subject = "Verify your email address"
    text = (
        "Confirm this email address for your Bokito account.\n\n"
        f"Verify your email:\n{verify_link}\n\n"
        "This link expires in 24 hours. If you did not request this you can ignore this email."
    )
    return await send_mail(to, subject, text)

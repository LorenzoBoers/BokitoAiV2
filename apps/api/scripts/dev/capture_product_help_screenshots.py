"""Capture product-help screenshots from a local logged-in dashboard.

Usage (from repo root, dashboard on :5174 and API on :8000):

    .\\apps\\api\\.venv\\Scripts\\python.exe apps/api/scripts/dev/capture_product_help_screenshots.py

Logs in as the local seed owner (override with BOKITO_DOCS_EMAIL / BOKITO_DOCS_PASSWORD).
Set BOKITO_DOCS_ONLY=models,usage to recapture only those article slugs.
Prefers an installed Chrome or Edge so Playwright does not need a browser download.
Blurs email addresses and obvious message bodies before each shot.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ASSETS = REPO / "docs" / "product-help" / "assets"
BASE = os.environ.get("BOKITO_DOCS_APP_URL", "http://127.0.0.1:5174").rstrip("/")
EMAIL = os.environ.get("BOKITO_DOCS_EMAIL", "admin@bokito.ai")
PASSWORD = os.environ.get("BOKITO_DOCS_PASSWORD", "bokito-test-password")

SHOTS: list[tuple[str, str, str]] = [
    ("/cockpit", "cockpit", "overview"),
    ("/cockpit", "cockpit", "awaiting-decision"),
    ("/cockpit", "welcome", "rail"),
    ("/cockpit", "tour", "sidebar"),
    ("/communication/inbox/open", "communication", "open-queue"),
    ("/communication/inbox/open", "communication", "thread-composer"),
    ("/communication/inbox/open", "communication", "composer-modes"),
    ("/communication/inbox/open", "communication", "decision-card"),
    ("/communication/inbox/open", "decisions", "approve"),
    ("/communication/inbox/open", "communication", "handling-picker"),
    ("/communication/inbox/open", "communication", "agent-turn"),
    ("/communication/inbox/open", "communication", "hashtags"),
    ("/settings/action-tags", "categories", "catalog"),
    ("/communication/tag/klacht/all", "categories", "ticket-panel"),
    ("/communication/runs/all", "agent-runs", "runs-list"),
    ("/contacts", "contacts", "contact-card"),
    ("/contacts", "contacts", "contact-handling"),
    ("/communication/inbox/open", "contacts", "link-conversation"),
    ("/settings/channels", "channels", "mailbox-status"),
    ("/settings/channels", "channels", "communication-tags"),
    ("/settings/channels", "quickstart", "mailbox"),
    ("/settings/communication", "inbox-ai", "workspace-default"),
    ("/ai/assistant/external/installation", "widget", "installation"),
    ("/ai/assistant/external/installation", "widget-embed", "snippet"),
    ("/agents", "agents", "library"),
    ("/agenda?view=week", "agenda", "week"),
    ("/projects", "projects", "project"),
    ("/projects", "projects", "boards"),
    ("/workstreams", "workstreams", "board"),
    ("/knowledge", "knowledge", "add-doc"),
    ("/settings/govern", "govern", "posture"),
    ("/settings/govern", "govern", "drafts"),
    ("/settings/govern", "govern", "conversations"),
    ("/settings/govern", "autonomy", "presets"),
    ("/settings/models", "models", "catalog"),
    ("/settings/trust", "privacy-security", "data-region"),
    ("/connections/marketplace", "integrations", "marketplace"),
    ("/connections/accounting", "integrations", "module-home"),
    ("/settings/mcp", "mcp", "servers"),
    ("/team", "team", "invite"),
    ("/settings/help-centers", "help-centers", "publish"),
    ("/settings/developers", "mcp-endpoint", "connect-ai-tools"),
    ("/settings/general", "setup-guide", "workspace"),
]

# Shots that sit below the fold: scroll the heading matching this pattern (EN|NL) into view first.
SCROLL_TO: dict[tuple[str, str], re.Pattern[str]] = {
    ("privacy-security", "data-region"): re.compile(r"^(Data processing|Gegevensverwerking)$"),
}

# Shots that need interaction first: ("click" | "wait" | "scroll", CSS selector) steps, run in order.
# A shot with steps always reloads its page so earlier clicks do not leak into it.
PREPARE: dict[tuple[str, str], list[tuple[str, str]]] = {
    ("communication", "handling-picker"): [
        ("click", 'main [role="button"][tabindex="0"]:has-text("Petra Bakker")'),
        ("click", '[data-testid="thread-ai-handling"]'),
    ],
    ("communication", "agent-turn"): [
        ("click", 'main [role="button"][tabindex="0"]:has-text("Bokito Assistant")'),
    ],
    ("communication", "hashtags"): [
        ("click", '[data-section="hashtags"] button.nav-row'),
        ("wait", '[data-testid="thread-row-ticket"]'),
    ],
    ("categories", "ticket-panel"): [
        ("click", 'main [role="button"][tabindex="0"]'),
        ("wait", '[data-testid="thread-ticket"]'),
    ],
    ("channels", "communication-tags"): [
        ("scroll", "#communication-tags"),
    ],
    ("projects", "boards"): [
        ("click", 'main [role="link"]:has-text("Bokito Platform")'),
        ("scroll", '[data-testid="project-playbook-boards"]'),
    ],
    ("workstreams", "board"): [
        ("click", 'main a[href^="/workstreams/"]:has-text("klacht")'),
        ("wait", '[data-testid="flow-ticket-board"]'),
    ],
    ("contacts", "contact-handling"): [
        ("click", "main tbody tr"),
        ("scroll", '[data-testid="contact-ai-handling"]'),
    ],
    ("contacts", "link-conversation"): [
        (
            "click",
            'main [role="button"][tabindex="0"]:has-text("bezoeker"), '
            'main [role="button"][tabindex="0"]:has-text("visitor")',
        ),
        ("click", '[data-testid="contact-link-open"]'),
    ],
    ("govern", "conversations"): [
        ("scroll", '[data-testid="govern-conversations"]'),
    ],
    ("mcp-endpoint", "connect-ai-tools"): [
        ("click", '[data-testid="ai-tool-claudeCode"] summary'),
    ],
    ("channels", "mailbox-status"): [
        ("click", '[data-testid="channel-row"] button[aria-expanded="false"]'),
        ("scroll", '[data-testid="channel-row"]'),
    ],
}

REDACT_JS = """
(() => {
  const style = document.getElementById('docs-redact') || document.createElement('style');
  style.id = 'docs-redact';
  style.textContent = `
    [data-sonner-toaster], [role="status"] { visibility: hidden !important; }
  `;
  document.head.appendChild(style);
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i;
  const walk = (root) => {
    const nodes = root.querySelectorAll('p, span, div, a, td, li');
    for (const el of nodes) {
      if (el.closest('nav, header, [data-sidebar], aside')) continue;
      const text = (el.childNodes.length === 1 && el.textContent || '').trim();
      if (!text || text.length > 160) continue;
      if (email.test(text) || /^(re:|fw:|fwd:)/i.test(text)) {
        el.style.filter = 'blur(7px)';
      }
    }
  };
  walk(document.body);
})()
"""


def _launch(playwright):
    last_error = None
    for channel in ("chrome", "msedge", None):
        try:
            if channel:
                return playwright.chromium.launch(channel=channel, headless=True)
            return playwright.chromium.launch(headless=True)
        except Exception as exc:  # noqa: BLE001 — try the next browser
            last_error = exc
    raise RuntimeError(f"Could not launch a browser: {last_error}")


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Install Playwright in the API venv: pip install playwright", file=sys.stderr)
        return 1

    ASSETS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = _launch(playwright)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(f"{BASE}/login", wait_until="networkidle", timeout=60000)
        page.locator('input[type="email"]').fill(EMAIL)
        page.locator('input[type="password"]').fill(PASSWORD)
        page.locator('input[type="password"]').press("Enter")
        page.wait_for_url(lambda url: "/login" not in url, timeout=45000)
        page.wait_for_timeout(1500)

        only = {s.strip() for s in os.environ.get("BOKITO_DOCS_ONLY", "").split(",") if s.strip()}
        last_url = ""
        for path, slug, name in SHOTS:
            if only and slug not in only:
                continue
            dest = ASSETS / slug
            dest.mkdir(parents=True, exist_ok=True)
            url = f"{BASE}{path}"
            steps = PREPARE.get((slug, name))
            if url != last_url or steps:
                page.goto(url, wait_until="networkidle", timeout=60000)
                page.wait_for_timeout(1200)
                last_url = "" if steps else url
            scroll_text = SCROLL_TO.get((slug, name))
            if steps:
                try:
                    for action, selector in steps:
                        target = page.locator(selector).first
                        if action == "click":
                            target.click(timeout=5000)
                        elif action == "wait":
                            target.wait_for(state="visible", timeout=10000)
                        else:
                            target.scroll_into_view_if_needed(timeout=5000)
                        page.wait_for_timeout(800)
                except Exception as exc:  # noqa: BLE001 — keep the shot, just unprepared
                    print(f"prepare skipped for {slug}/{name}: {exc}")
            elif scroll_text:
                try:
                    page.get_by_role("heading", name=scroll_text).first.scroll_into_view_if_needed(
                        timeout=3000
                    )
                    page.wait_for_timeout(300)
                except Exception as exc:  # noqa: BLE001 — keep the shot, just unscrolled
                    print(f"scroll skipped for {slug}/{name}: {exc}")
            elif url == last_url:
                page.evaluate("window.scrollTo(0, 0)")
            page.evaluate(REDACT_JS)
            page.wait_for_timeout(200)
            out = dest / f"{name}.png"
            page.screenshot(path=str(out), full_page=False)
            print(f"wrote {out.relative_to(REPO)}")

        if (ASSETS / "agents" / "library.png").is_file() and (not only or "agents" in only):
            page.goto(f"{BASE}/agents", wait_until="networkidle")
            page.wait_for_timeout(800)
            try:
                page.locator("main a").first.click(timeout=3000)
                page.wait_for_timeout(1200)
                page.evaluate(REDACT_JS)
                brief = ASSETS / "agents" / "agent-brief.png"
                page.screenshot(path=str(brief), full_page=False)
                print(f"wrote {brief.relative_to(REPO)}")
            except Exception as exc:  # noqa: BLE001
                print(f"skip agent-brief: {exc}")

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

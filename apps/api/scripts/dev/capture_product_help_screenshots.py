"""Capture product-help screenshots from a local logged-in dashboard.

Usage (from repo root, dashboard on :5174 and API on :8000):

    .\\apps\\api\\.venv\\Scripts\\python.exe apps/api/scripts/dev/capture_product_help_screenshots.py

Logs in as the local seed owner (override with BOKITO_DOCS_EMAIL / BOKITO_DOCS_PASSWORD).
Prefers an installed Chrome or Edge so Playwright does not need a browser download.
Blurs email addresses and obvious message bodies before each shot.
"""

from __future__ import annotations

import os
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
    ("/communication/inbox/open", "communication", "decision-card"),
    ("/communication/inbox/open", "decisions", "approve"),
    ("/communication/runs/all", "agent-runs", "runs-list"),
    ("/contacts", "contacts", "contact-card"),
    ("/settings/channels", "channels", "mailbox-status"),
    ("/settings/channels", "quickstart", "mailbox"),
    ("/settings/communication", "inbox-ai", "draft-mode"),
    ("/ai/assistant/external/installation", "widget", "installation"),
    ("/ai/assistant/external/installation", "widget-embed", "snippet"),
    ("/agents", "agents", "library"),
    ("/agenda", "agenda", "week"),
    ("/agenda?view=automations", "agenda", "automations"),
    ("/projects", "projects", "project"),
    ("/knowledge", "knowledge", "add-doc"),
    ("/settings/govern", "govern", "posture"),
    ("/settings/govern", "govern", "drafts"),
    ("/settings/govern", "autonomy", "presets"),
    ("/settings/models", "models", "catalog"),
    ("/settings/marketplace", "integrations", "marketplace"),
    ("/settings/mcp", "mcp", "servers"),
    ("/settings/members", "members", "invite"),
    ("/settings/help-centers", "help-centers", "publish"),
    ("/settings/general", "setup-guide", "workspace"),
]

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

        last_url = ""
        for path, slug, name in SHOTS:
            dest = ASSETS / slug
            dest.mkdir(parents=True, exist_ok=True)
            url = f"{BASE}{path}"
            if url != last_url:
                page.goto(url, wait_until="networkidle", timeout=60000)
                page.wait_for_timeout(1200)
                last_url = url
            page.evaluate(REDACT_JS)
            page.wait_for_timeout(200)
            out = dest / f"{name}.png"
            page.screenshot(path=str(out), full_page=False)
            print(f"wrote {out.relative_to(REPO)}")

        if (ASSETS / "agents" / "library.png").is_file():
            page.goto(f"{BASE}/agents", wait_until="networkidle")
            page.wait_for_timeout(800)
            card = page.locator("a, button").filter(has_text="").first
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

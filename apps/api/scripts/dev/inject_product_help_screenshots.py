"""Insert screenshot markdown into product-help articles (idempotent)."""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ROOT = REPO / "docs" / "product-help"

# slug, en heading, nl heading, asset name, en alt, nl alt, en caption, nl caption
SHOTS: list[tuple[str, str, str, str, str, str, str, str]] = [
    ("communication", "Work the Open queue", "Werk de wachtrij Open af", "open-queue", "Open queue in Communication", "Wachtrij Open in Communicatie", "Open lists customer work that still needs you.", "Open toont klantwerk dat nog jou nodig heeft."),
    ("communication", "Reply in a thread", "Antwoord in een gesprek", "thread-composer", "Thread and composer in Communication", "Gesprek en composer in Communicatie", "The thread, contact and composer sit on one screen.", "Gesprek, contact en composer staan op één scherm."),
    ("communication", "Decide in the thread", "Beslis in het gesprek", "decision-card", "Decision card in a thread", "Keuzekaart in een gesprek", "Decision cards appear in the timeline.", "Keuzekaarten verschijnen in de tijdlijn."),
    ("decisions", "Find a waiting decision", "Vind een wachtende beslissing", "approve", "A waiting decision in the thread", "Een wachtende beslissing in het gesprek", "Open the thread from Communication, Agent runs or Cockpit.", "Open het gesprek vanuit Communicatie, Agent-runs of Cockpit."),
    ("cockpit", "Scan the day on Overview", "Scan de dag op Overzicht", "overview", "Cockpit Overview", "Cockpit Overzicht", "Overview shows open work, decisions and recent runs.", "Overzicht toont open werk, beslissingen en recente runs."),
    ("cockpit", "Open work that is waiting on you", "Open werk dat op jou wacht", "awaiting-decision", "Cockpit attention items", "Cockpit-aandachtspunten", "Awaiting decision jumps to the same list as Agent runs.", "Wacht op beslissing springt naar dezelfde lijst als Agent-runs."),
    ("agent-runs", "Open the runs list", "Open de runlijst", "runs-list", "Agent runs list", "Lijst Agent-runs", "Scheduled work stays out of Open.", "Gepland werk blijft buiten Open."),
    ("contacts", "Open a contact from a thread", "Open een contact vanuit een gesprek", "contact-card", "Contacts page", "Contactenpagina", "Everyone who writes in lands here.", "Iedereen die binnenkomt landt hier."),
    ("channels", "Connect a mailbox", "Koppel een mailbox", "mailbox-status", "Channel settings with mailboxes", "Kanaalinstellingen met mailboxen", "Mailbox status, sync and routing live on Channels.", "Mailboxstatus, sync en routing staan bij Kanalen."),
    ("inbox-ai", "Choose when drafts appear", "Kies wanneer concepten verschijnen", "draft-mode", "Inbox AI channel defaults", "Inbox AI-kanaalstandaarden", "Pick when the assistant drafts per channel.", "Kies per kanaal wanneer de assistent concepten maakt."),
    ("widget", "Copy the embed snippet", "Kopieer de embed-snippet", "installation", "Website chat installation", "Websitechat-installatie", "Copy the snippet from Installation.", "Kopieer de snippet onder Installatie."),
    ("agents", "Browse the library", "Blader door de bibliotheek", "library", "Agents library", "Agentbibliotheek", "Each agent is a card. The default handler has a Lead badge.", "Elke agent is een kaart. De standaardbehandelaar heeft een Lead-badge."),
    ("agents", "Brief an agent", "Brief een agent", "agent-brief", "Agent detail", "Agentdetail", "Edit role, instructions, model and tools.", "Wijzig rol, instructies, model en tools."),
    ("agenda", "See the week", "Bekijk de week", "week", "Agenda week view", "Agenda-weekweergave", "Week shows planned wakes on each day.", "Week toont geplande wakes per dag."),
    ("agenda", "Pause or run an automation", "Pauzeer of start een automatisering", "automations", "Agenda automations", "Agenda-automatiseringen", "Pause, edit or run an automation now.", "Pauzeer, bewerk of start een automatisering nu."),
    ("projects", "Open a project", "Open een project", "project", "Projects list", "Projectenlijst", "Each card shows the lead agent and budget.", "Elke kaart toont de lead-agent en het budget."),
    ("knowledge", "Add a document", "Voeg een document toe", "add-doc", "Knowledge page", "Kennis-pagina", "Add the documents agents should answer from.", "Voeg de documenten toe waaruit agents antwoorden."),
    ("govern", "Set the workspace posture", "Zet de workspacehouding", "posture", "Govern policy", "Govern-beleid", "Pick Manual, Assisted or Autonomous.", "Kies Handmatig, Ondersteund of Autonoom."),
    ("govern", "Review a platform draft", "Beoordeel een platformconcept", "drafts", "Govern draft queue", "Govern-conceptwachtrij", "Structural drafts wait here. Message decisions stay in the thread.", "Structurele concepten wachten hier. Berichtbeslissingen blijven in het gesprek."),
    ("autonomy", "Pick a preset", "Kies een preset", "presets", "Autonomy posture presets", "Autonomiehouding-presets", "The preset lives on Govern.", "Het preset staat op Govern."),
    ("models", "Enable a workspace model", "Zet een workspacemodel aan", "catalog", "Models settings", "Modelinstellingen", "Enable the chat and embedding models this workspace needs.", "Zet de chat- en embeddingmodellen aan die deze workspace nodig heeft."),
    ("integrations", "Install from the marketplace", "Installeer vanuit de marketplace", "marketplace", "Integrations marketplace", "Integraties-marketplace", "Marketplace is where you install a new app.", "Marketplace is waar je een nieuwe app installeert."),
    ("mcp", "Add a server", "Voeg een server toe", "servers", "MCP servers", "MCP-servers", "Add the server URL and credentials.", "Voeg de server-URL en credentials toe."),
    ("members", "Invite someone", "Iemand uitnodigen", "invite", "Members settings", "Ledeninstellingen", "Owners and admins invite the team here.", "Eigenaren en admins nodigen het team hier uit."),
    ("help-centers", "Publish an article", "Een artikel publiceren", "publish", "Help centers settings", "Helpcenter-instellingen", "Published Knowledge docs appear here.", "Gepubliceerde Kennis-docs verschijnen hier."),
    ("welcome", "What you use it for", "Waar je het voor gebruikt", "rail", "Bokito sidebar", "Bokito-zijbalk", "One sidebar: Control, AI and Settings.", "Eén zijbalk: Besturing, AI en Instellingen."),
    ("tour", "Control: the daily loop", "Control: de dagelijkse loop", "sidebar", "Sidebar with the daily loop", "Zijbalk met de dagelijkse loop", "Cockpit, Communication, Contacts, Agenda and Projects.", "Cockpit, Communicatie, Contacten, Agenda en Projecten."),
    ("quickstart", "1. Connect a mailbox", "1. Koppel een mailbox", "mailbox", "Connect a mailbox", "Een mailbox koppelen", "Open Settings, then Channels.", "Open Instellingen en daarna Kanalen."),
    ("setup-guide", "Workspace basics", "Workspace-basics", "workspace", "Workspace general settings", "Algemene workspace-instellingen", "Set the name, logo and language first.", "Zet eerst naam, logo en taal."),
]


def inject(path: Path, heading: str, slug: str, name: str, alt: str, caption: str) -> bool:
    text = path.read_text(encoding="utf-8")
    src = f"/api/docs/assets/{slug}/{name}.png"
    if src in text:
        return False
    marker = f"## {heading}\n"
    idx = text.find(marker)
    if idx < 0:
        print(f"missing heading {heading!r} in {path}")
        return False
    after = idx + len(marker)
    # Skip one blank and one paragraph (or go straight to steps).
    rest = text[after:]
    lines = rest.splitlines(keepends=True)
    insert_at = 0
    skipped_blank = False
    skipped_para = False
    for i, line in enumerate(lines):
        if not skipped_blank and line.strip() == "":
            skipped_blank = True
            continue
        if not skipped_para and line.strip() and not line.startswith("#") and not line.startswith("1."):
            skipped_para = True
            insert_at = i + 1
            if i + 1 < len(lines) and lines[i + 1].strip() == "":
                insert_at = i + 2
            break
        if line.startswith("1."):
            insert_at = i
            break
    block = f"![{alt}]({src})\n*{caption}*\n\n"
    lines.insert(insert_at, block)
    path.write_text(text[:after] + "".join(lines), encoding="utf-8")
    return True


def main() -> None:
    changed = 0
    for slug, en_h, nl_h, name, en_alt, nl_alt, en_cap, nl_cap in SHOTS:
        for lang, heading, alt, cap in (("en", en_h, en_alt, en_cap), ("nl", nl_h, nl_alt, nl_cap)):
            matches = list((ROOT / lang).rglob(f"{slug}.md"))
            if not matches:
                print(f"missing article {lang}/{slug}")
                continue
            if inject(matches[0], heading, slug, name, alt, cap):
                changed += 1
                print(f"injected {lang}/{slug} #{name}")
    print(f"updated {changed} articles")


if __name__ == "__main__":
    main()

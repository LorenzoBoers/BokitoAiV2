# Bokito strategy, September 2026

Why V2 exists, what the market looks like, and which direction Bokito takes. Engineering north star: [`CORE_INTENT.md`](CORE_INTENT.md). Market framing: [`POSITIONING.md`](POSITIONING.md). Coexistence with V1: [`adr/002-v2-coexistence.md`](adr/002-v2-coexistence.md).

Last updated: 30 September 2026.

---

## 1. Conclusion

The philosophy of Bokito, "drive the company from the conversation", is not outdated. The market is moving toward it. What has been commoditised is the layer underneath: agent plus connectors plus approvals plus audit. OpenAI (Workspace Agents, Dots, Agents API), Anthropic (Cowork, Claude for Small Business), Microsoft (Agent 365, Copilot Cowork) and Meta (Business Agent on WhatsApp) ship that layer bundled or free. Two startups shaped like a horizontal "agent over your inbox and CRM" (Zams, Zivy) closed in 2026.

Three words from the philosophy remain uncovered by the labs and by company-OS startups:

- **Shared.** Labs build per-user assistants. Dots: only the owner can direct a dot. Workspace Agents: one person's mailbox. A company-wide conversation with customers, partners, colleagues and agents in one list does not exist there.
- **External.** No lab or company-OS startup sits on WhatsApp, shared email, a website widget and a phone line with thread state. Email is personal for them.
- **Governed at company level.** Labs ask per task. A workspace autonomy posture with rollback, audit and "consequential tools always ask" exists only at enterprise prices (Agent 365 at $15 per user inside a $99 per user E7 bundle).

Bokito therefore does not add platform breadth and does not become an industry tool. It executes the philosophy sharper as a category: **the governed conversation layer for companies run with AI**. Segment by way of working (2 to 50 people, already using two or more AI tools, two or more external channels, wanting to stay in the EU), not by sector. Verticals are modules: signal types, playbooks and tools, never screens or identity.

## 2. Market, September 2026

Frontier labs

- OpenAI: Frontier (enterprise, sales-led), Workspace Agents in Business at $20 per user, Dots (always-on agents with a cloud computer, 4000+ apps, not in the EEA, no WhatsApp), Agents API, Codex Cloud. Agent Builder is retired on 30 November 2026: building agents is transient, using them is not.
- Anthropic: Cowork, Claude for Small Business (43 workflows, 37 connectors, approve before send). Run rate around $65B.
- Microsoft: Agent 365 at $15 per user (governance only), Copilot bundled into M365 Business since 1 July 2026.
- Meta: Business Agent self-serve inside WhatsApp Business. From 1 October 2026 every service message, including AI replies, is billed per message.

Company-OS and governed-operator startups (the category that shares Bokito's philosophy)

- Hulda, Zebi, Crost, Swiftly: "AI-native business OS" for solo founders, all early access, US. Hulda and Swiftly replace the SaaS stack with one database.
- Kantum (Paris): closest to Bokito. Governed operator over email, WhatsApp, Slack, phone and CRM; escalation by WhatsApp then phone; $39 solo, $149 team, $249 with phone agent. Small team, no EU production tenants.
- The category is forming now, is empty in Europe, and nobody has production tenants, EU hosting or a thread model that has matured for years. The window is 12 to 18 months.

Horizontal customer-communication SaaS

- Consolidation: Salesforce bought Fin for $3.6B, Zendesk bought Forethought, ServiceNow bought Moveworks. The neutral "not your CRM" position is emptying.
- Price has converged on $0.50 to $2.00 per resolved conversation plus seats. 82% of buyers prefer hybrid pricing.
- Shared inbox for SMB: Front $25 to $105 per seat, Trengo EUR 299 to 499 per month, Crisp EUR 45 to 295 per month with EU hosting. Agents are add-ons there, not colleagues.

Signals

- Gartner: 40%+ of agentic projects cancelled by end of 2027; prescription: "agents propose, a separate control layer evaluates before execution". That is the Decision object.
- SMB adoption is flat (small companies at 22%; Dutch SMB at 29.8%). Blockers after experience: privacy (49%) and legal risk (43%). 9% of Dutch SMBs have an AI policy.
- McKinsey: 32% of companies cancel software purchases because they build with coding agents. Bokito hands work to Codex, Claude Code and Cursor instead of competing with them.
- Sovereignty is a selection criterion: 36% of Dutch decision makers require an EU provider; 49% of German buyers require EU hosting.
- EU AI Act Article 50 (an AI must identify itself) applies since 2 August 2026. High-risk obligations moved to December 2027.

## 3. Directions, ranked

1. **The governed conversation layer for AI-run companies** (core). One workspace where customers and partners arrive by email, WhatsApp, widget and phone; colleagues and agents answer in the same list; agents propose and people decide inline; one dial sets how much runs without asking; everything is in the thread and in Govern.
2. **Land through the shared inbox, expand into the operations layer** (entry). Sell the first month as a shared inbox in which agents are real colleagues: decision cards instead of bot replies, autonomy dial, resolved and time-saved that add up, EU hosting. Then playbooks, Govern, modules.
3. **Control plane for the tools people already use** (second pillar). MCP endpoint and BYOK as distribution: ChatGPT, Claude and Copilot operate the workspace; Bokito decides what they may do and hands coding work to Codex, Claude Code or Cursor. One workbench adapter that works beats five stubs.
4. **Partners as channel.** Agencies, advisors and accountants run client workspaces; the white-label market shows they resell agents at $300 to $2,000 per client per month.
5. **Digital twin and learning as the long-term moat.** Thread history, decisions, corrections and outcomes become the company memory nobody else has. Requires that learning actually counts.
6. **Verticals as modules.** Installers, accountancy, property management, garages, healthcare: chosen when tenants show a pattern, delivered as signal types, playbooks and tools.

Rejected as main direction: a horizontal agent-building platform or canvas (labs win this; Agent Builder is already dying), a one-database company OS that replaces the stack, Govern sold alone, agentic commerce.

## 4. Pricing hypothesis

Flat workspace fee in three steps (indicative EUR 49 solo, 149 team, 399 business) plus a fee per resolved conversation, with channel fees (Meta per message) passed through visibly. Resolved means closed without human handoff for 72 hours. To be validated with ten conversations in the ICP before launch.

## 5. What this means for the product

- V2 is built as a new application next to V1. V1 is frozen as legacy and keeps running for existing tenants.
- One mental model: the OODA loop. Observe (every inbound becomes a message in a conversation), Orient (contact, organisation, knowledge, memory, recognition as a Signal), Decide (a Decision in the thread, or policy decides), Act (a Run through the tool executor), Feedback (usage, outcomes, feedback feed policy and metrics).
- Five operator nouns: Conversation, Contact (with Organization), Agent, Playbook, Decision. Signal is a typed recognition on a Conversation. Project leaves the core.
- Tools-first: every mutation is a tool; REST, agents, MCP clients and the command palette call the same executor with a trust level.
- One ledger (`runs`), one connection table, one decision resolve path, Postgres-native types, one migration baseline.
- Govern and metering are products: policy as a table, usage events including channel costs, outcomes per conversation, Article 50 disclosure per connection by default, model provider with a region and an EU default.

## 6. Open questions to validate

- Does the ICP pay a workspace fee for "agents as colleagues under governance" on top of a free Meta Business Agent or a Copilot bundle?
- Does the buyer recognise "decide in the thread" as value or as approval fatigue? Measure decision cards per resolved conversation.
- How fast do Kantum add EU hosting and Trengo or Crisp add real agent colleagues?

## 7. Sources

Market research was conducted on 29 and 30 September 2026 across vendor pages, help centres, press releases and analyst summaries (OpenAI, Anthropic, Microsoft, Meta, Google, Salesforce, Zendesk, HubSpot, Sierra, Decagon, Kantum, Hulda, Zebi, Crost, Swiftly, Front, Trengo, Crisp, Gartner, McKinsey, Eurostat, CBS, KVK, Bitkom, Mistral, EU Digital Omnibus). Figures are dated in the text where they matter; treat third-party estimates as such.

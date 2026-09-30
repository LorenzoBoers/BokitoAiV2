---
title: Govern in V2
intro: One autonomy dial, allowances per category, changes with a way back and an append-only audit.
description: Set the V2 autonomy posture, override allowances per tool category, keep consequential tools on ask, review and roll back changes, read the audit log and the EU share of model usage.
keywords: v2, govern, autonomy, posture, allowances, consequential, decision, changes, rollback, audit, usage, eu, disclosure
sort: 30
related: v2-communication,v2-work,v2-developers
---

# Govern in V2

**Govern** is where you decide how much agents may do without asking and where every configuration change is recorded with a way back. Ask inline, record in Govern: decisions are answered in threads, the rules that raised them live here.

## Set the autonomy posture

One dial for the workspace. Agents and Signal types can sit below it, never above.

1. Open **Govern**, **Policy**.
2. Under **Autonomy posture** pick **Manual** (agents draft, a person sends and applies everything), **Assisted** (agents read and write inside Bokito; communicating and external actions ask first) or **Autonomous** (agents act within allowances; consequential tools still ask).
3. Save. Raising the posture is itself a governed change: the banner **Changing posture needs approval. A decision was raised in Govern.** appears and an admin approves it.
4. Check **Overview**, **Posture** to confirm the active level.

## Override an allowance per category

Every tool belongs to one category. The posture sets a default verdict per category; you can override it.

1. Under **Allowances per category** find **Read**, **Write**, **Communicate**, **External** and **Destructive**.
2. Leave **Posture** to inherit, or pick **Allow**, **Ask** or **Deny**.
3. Under **Always ask** review the tools that raise a decision regardless of posture, such as sending an invoice from a connected ledger.
4. Use **Per-tool overrides** for a single tool that should differ from its category.
5. Operators are never asked: when you run a tool yourself it either runs or is denied. API clients and agents get the decision.

## Set the AI disclosure line

Channels with disclosure on append a sentence to AI-written replies (EU AI Act, Art. 50).

1. Under **AI disclosure (Art. 50)** read the default: *This reply was written with the help of an AI assistant.*
2. Replace it with your own wording or leave it empty to keep the default.
3. Switch disclosure per channel under **Connections**, **AI disclosure on outbound**.

## Review and roll back a change

Playbook edits, policy changes and agent updates are recorded as changes you can undo.

1. Open **Govern**, **Changes**.
2. Each row shows who proposed it, its status (**Draft**, **Applied**, **Rejected**, **Rolled back**) and **Before and after**.
3. Press **Apply** on a draft, **Reject** to drop it, or **Roll back** on an applied change.
4. The rollback is itself a new change, so the trail stays complete.

## Read the audit log and usage

1. Open **Govern**, **Audit** for the append-only log of tool calls and settings changes. Use **Filter by action** to narrow it.
2. Open **Govern**, **Usage** for **Total, 30 days**, **EU share** of model and embedding calls, **Cost per day** and a **Breakdown** per kind, provider and region.
3. Open **Overview** for **Resolved by agents** and **Time saved**: conversations an agent closed without handoff that stayed closed for 72 hours, computed nightly.

## What to do next

- Create tokens for scripts and MCP clients under **Govern**, **API tokens**: [/docs/v2/v2-developers](/docs/v2/v2-developers)
- Give an agent its own cap below the workspace posture: [/docs/v2/v2-work](/docs/v2/v2-work)

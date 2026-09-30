---
title: What Bokito V2 is
intro: One conversation surface for the company, with agents that act under a policy you set.
description: Bokito V2 on v2.bokito.ai in one page. The five objects, how agents and people share one list, where decisions land, and how to create your first workspace.
keywords: v2, bokito v2, overview, conversation, agent, decision, playbook, contact, workspace
sort: 10
related: v2-communication,v2-govern,v2-work,v2-connections,v2-developers
---

# What Bokito V2 is

Bokito V2 runs at `https://v2.bokito.ai` next to the current platform. Customers, partners and colleagues write where they already write; the company answers in one list where people and AI agents work side by side, and every action an agent takes is visible, governed and reversible from that same thread.

## Five objects, no more

V2 is built on five nouns. Every screen shows one of them; nothing else exists.

| Object | What it is | Where you see it |
| --- | --- | --- |
| Conversation | A thread with a customer, a partner, a colleague or an agent | Communication |
| Contact and Organization | Who is on the other side, with the memory agents keep about them | Contact drawer in a thread |
| Agent | A passport: name, role, instructions, model and autonomy cap | Work, Agents |
| Playbook | Steps an agent runs in order, in a thread, under the same policy as a reply | Work, Playbooks |
| Decision | A question an agent asks before it acts; answered inline, recorded in Govern | Thread, Overview, Govern |

A Signal is a typed recognition on a conversation (an invoice question, a complaint, a lead). Signal types come with modules and never add a screen.

## How a message travels

1. A message arrives through a connected channel: email, WhatsApp, website chat or an internal thread.
2. The agent that owns the channel reads the thread, the contact memory and your Knowledge documents.
3. It acts within the workspace policy. Reading and drafting is free; sending to a customer or calling an external system either runs, asks or is denied depending on your **Autonomy posture**.
4. When it asks, a Decision appears in the thread and on Overview. You approve or reject there.
5. Every tool call lands in the run ledger with its cost. Nightly, V2 counts which conversations agents resolved without a person stepping in.

## Where V2 differs from V1

- One list instead of an inbox, a case queue and a task board. Filters do the rest.
- Autonomy is one dial per workspace, with allowances per tool category and a short list of tools that always ask.
- Tools are the only way agents change anything. The same tools power the command palette, the REST API and the MCP endpoint, so the policy is applied once.
- The EU managed model is the default. Bring your own key when you want to; usage and the EU share of model calls are visible under Govern.
- Modules add Signal types, playbooks and tools for one line of work. The first one connects Moneybird for accounting.

## Create a workspace

V2 has its own database and its own accounts. Nothing from the current platform is moved.

1. Open `https://v2.bokito.ai` and choose **Create workspace**.
2. Fill in **Your name**, **Email**, **Password** and **Workspace name**.
3. Pick the default **Language**; agents reply and disclose in that language.
4. Land in **Communication**. Press **New** to start an internal thread with the default agent and ask it for a summary of what it can do.
5. Invite colleagues under **Settings**, **Members**, **Invite a colleague**.

## What to do next

- Learn the list and the thread: [/docs/v2/v2-communication](/docs/v2/v2-communication)
- Set the autonomy posture before you connect a customer channel: [/docs/v2/v2-govern](/docs/v2/v2-govern)
- Connect email, WhatsApp or the website chat: [/docs/v2/v2-connections](/docs/v2/v2-connections)

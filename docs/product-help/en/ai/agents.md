---
title: How Agents works
intro: The library of AI workers. Communication is where they talk; this page is where you hire and brief them.
description: Brief company agents, set chat access, archive them, add a signature, and set initials or icon.
keywords: agents, ai workforce, archive, chat access, signature, avatar, icon, default agent
sort: 10
related: govern,knowledge,communication,agenda
---

# How Agents works

Agents are the AI workers for this workspace. Every agent has one shape: name, purpose, audience, model, allowed tools, owner, and optional defaults. Bokito is the system agent that acts for the signed-in user; it is not part of the worker library.

## Browse the library

![Agents library](/api/docs/assets/agents/library.png)
*Each agent is a card. The default agent is marked quietly as Default.*

1. Open **Agents**. Company agents appear as cards with their audience. Each card can show **open** conversations and threads that **need a decision**. Search and the pills **All** and **Working** narrow the grid.
2. Choose **New agent**. Enter a **Name**, choose the **Audience**, select a **Model**, describe the **Purpose**, then choose **Create agent**.
3. Open a card for instructions, model and chat access. Use **Chat with this agent** to start an internal thread. Agenda and conversations are quiet links on the detail page. Related settings (AI handling, Knowledge, Govern) sit as links at the bottom of the page, not in the header.

Members can open an agent to read it. They see **You can read this agent. Ask an admin to change settings.** They can still chat from Communication.

Real decisions live in each conversation (and under **Open conversations** on the agent). Tip cards for automated mail do not inflate those counts.

New chats in Communication require a **company agent**. If none are available for you, the composer shows **No agents available**. Open **Agents** or the setup guide to add one.

## Brief an agent

![Agent detail](/api/docs/assets/agents/agent-brief.png)
*Edit purpose, audience, model and allowed tools.*

1. Open the agent. Edit its **Name**, **Purpose**, **Audience**, and **Model**.
2. Under **Tools & permissions**, choose the tool allowlist. Workspace posture and the per-type or playbook policy in [Govern](/docs/govern/govern) still bound every allowed tool.
3. Set **Autonomy level** on the agent: **Manual — always ask**, **Approval — gated actions**, **Auto — act independently**, or **Workspace default**. This sits at or below the workspace ceiling on [Autonomy](/docs/govern/autonomy).
4. In **Communication settings**, choose one default agent for each connected channel. A conversation-level agent pin always wins. **Archive** hides an agent and clears its channel defaults; run history stays.

## Managed agents

Some agents are owned by a platform stack or module (for example Trading). They show a **Managed** badge on the library card and the agent detail page.

1. Open **Agents** and find a card with the **Managed** label.
2. Open the agent. The badge names the owning pack when you hover.
3. If you **Archive** a managed agent, stack seed/update runs do not bring it back by themselves. Bokito opens a restore Decision in Communication; approve it to return the agent to the library, or reject to keep it archived.

## Limit who can chat

1. An idle agent shows **Ready**. Open **Communication** on the agent page (chat access). Choose **Everyone**, **Selected users**, or **Nobody**.
2. **Nobody** keeps background work (Agenda, AI handling) without a direct chat from Communication.
3. To remove an agent from the library, use **Archive** under the ··· menu.

## Add an agent signature

1. On a company agent, open **Email signature & send as**.
2. Choose the default **Send as**: **As this agent** (signs as the agent) or **As the approving teammate** (impersonates the person who approves).
3. Enter a plain-text signature. Line breaks are kept. When the agent sends as itself, Bokito always adds a short “Replied by an AI agent · Powered by Bokito AI” line with a link to [bokito.ai](https://bokito.ai) under the signature.
4. Save. Approvals for this agent use that default until you pick another Send as on the card.


## Set name or icon

1. Open a company agent.
2. Choose **Edit** next to the agent name.
3. Change the **name**, pick **Initials** or **Icon**, then save. Agents always use the platform AI violet — there is no per-agent color or photo picker.

The same look shows on the Agents library, agent detail, Communication, and the webchat header bubble for the answering agent.

## Schedule the agent

1. From the agent, open **Agenda**.
2. You land on [Agenda](/docs/ai/agenda) filtered to that agent.
3. Attach a wake so the agent runs without you starting a chat.

## What to do next

Point the agent at [Knowledge](/docs/ai/knowledge). Set how far it may go on [Autonomy](/docs/govern/autonomy).

---
title: How Agents works
intro: The library of AI workers. Communication is where they talk; this page is where you hire and brief them.
description: Brief company agents, set chat access, pause them, add a signature, and set visual identity.
keywords: agents, ai workforce, pause, chat access, signature, avatar, icon
sort: 10
related: govern,knowledge,communication,agenda
---

# How Agents works

Agents are the AI workers for this workspace. Open **Agents** to add one, change a brief, or start a chat. Members talk to existing agents from Communication.

## Browse the library

![Agents library](/api/docs/assets/agents/library.png)
*Each agent is a card. The default handler has a Lead badge.*

1. Open **Agents**. Company agents appear as cards. The agent that handles unassigned work shows a **Lead** badge and the line **Handles mail when nothing else is assigned**. Each card can show **open** conversations and threads that **need a decision** — open the card and scroll to **Open conversations**, or jump into Communication for that agent. **Filter agents** narrows the grid. Pills **All**, **Working**, **Paused** and **Lead** hide the rest.
2. Choose **New agent**. Pick a starter (**Customer support**, **Team assistant**, or **Project lead**), enter a **Name**, pick a **Role** (the line under the role explains what it does), a **Model**, optional **Project**, optional **Instructions**, then **Create agent**.
3. Open a card for instructions, model and chat access. Use **Chat** to start an internal thread. **More actions** holds Knowledge, Inbox AI, Setup and **Duplicate**.

Members can open an agent to read it. They see **You can read this agent. Ask an admin to change settings.** They can still chat from Communication.

Real decisions live in each conversation (and under **Open conversations** on the agent). Tip cards for automated mail do not inflate those counts.

New chats in Communication require a **company agent**. If none are available for you, the composer shows **No agents available**. Open **Agents** or the setup guide to add one.

## Brief an agent

![Agent detail](/api/docs/assets/agents/agent-brief.png)
*Edit role, instructions, model and tools.*

1. Open the agent. Edit **Name** and **Instructions**, then save.
2. Under **Tools & permissions**, leave **Autonomy level** on **Workspace default**, or set **Manual — always ask**, **Approval — gated actions**, or **Auto — act independently**. A short line under the control says what that means. Open **Workspace posture** to change the default. **Allowed tools** with nothing selected means all tools, still gated by [Govern](/docs/govern/govern).
3. **Make lead agent** when this agent should handle work with no specific assignment. **Archive** asks if **Pause** is enough first. You cannot archive the current lead until another agent is the lead.

## Pause or limit who can chat

1. An idle agent shows **Ready**. On the agent page, choose **Pause** to stop scheduled and inbound work (status becomes **Paused**). **Wake** resumes it. A paused agent will not finish Agenda wakes until you resume it. **Archive** hides it from the list; run history stays.
2. Open **Communication** on the same page (chat access). Choose **Everyone**, **Selected users**, or **Nobody**.
3. **Nobody** keeps background work (Agenda, Inbox AI) without a direct chat from Communication.

Leads do not use the same pause and access controls as other company agents.

## Add an agent signature

1. On a company agent, open **Email signature & send as**.
2. Choose the default **Send as**: **As this agent** (signs as the agent) or **As the approving teammate** (impersonates the person who approves).
3. Enter a plain-text signature. Line breaks are kept. When the agent sends as itself, Bokito always adds a short “Replied by an AI agent · Powered by Bokito AI” line with a link to [bokito.ai](https://bokito.ai) under the signature.
4. Save. Approvals for this agent use that default until you pick another Send as on the card.


## Set icon, color or photo

1. Open a company agent.
2. On the **Visual identity** card, choose **Edit**.
3. Pick **Initials**, **Icon** (with a color), or **Image** (upload a photo), then save.

The same look shows on the Agents library, agent detail, Messages, the default agent email signature (photo when set), and the webchat header bubble for the answering agent.

## Schedule the agent

1. From the agent, open **Schedule**.
2. You land on [Agenda](/docs/ai/agenda) filtered to that agent.
3. Attach a wake so the agent runs without you starting a chat.

## What to do next

Point the agent at [Knowledge](/docs/ai/knowledge). Set how far it may go on [Autonomy](/docs/govern/autonomy).

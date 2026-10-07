---
title: How Agents works
intro: The library of AI workers. Communication is where they talk; this page is where you hire and brief them.
description: Brief company agents, set chat access, deactivate them, add a signature, and set name, description or icon.
keywords: agents, ai workforce, deactivate, reactivate, chat access, signature, avatar, icon, default agent, ceiling, rules, try out, ask questions to
sort: 10
related: govern,knowledge,communication,agenda
---

# How Agents works

Agents are the AI workers for this workspace. Every agent has one shape: name, description, instructions, model, allowed tools, owner, and optional defaults. Bokito is the system agent that acts for the signed-in user; it is not part of the worker library.

## Browse the library

![Agents library](/api/docs/assets/agents/library.png)
*Each agent is a card. The default agent is marked quietly as Default.*

1. Open **Agents**. Company agents appear as cards. Each card can show **open** conversations (the agent's detail, **Open conversations**) and threads that **need a decision** (**For you**, filtered to that agent). Search and the pills **All** and **Working** narrow the grid. Above the cards, **Activity** is a now-centered timeline of even-sized points. Each point has an icon for the action type (chat, scheduled wake, heartbeat, and so on). When several actions sit close together, the point shows a number; hover to see them stacked. Sessions of two minutes or less show one clock time, not a from–to range. Choose a point to open the run, conversation or Agenda item. The same timeline sits on each agent page for that agent alone.
2. Choose **New agent**. Enter a **Name**, an optional **Description**, select a **Model**, add **Instructions**, then choose **Create agent**. The description is the short role others see on the card; instructions are the brief the agent follows.
3. Open a card for instructions, model and chat access. Use **Chat with this agent** to start an internal thread. Agenda and conversations are quiet links on the detail page. Related settings (AI handling, Knowledge, Govern) sit as links at the bottom of the page, not in the header.

Members can open an agent to read it. They see **You can read this agent. Ask an admin to change settings.** They can still chat from Communication.

In a chat with an agent, the side panel shows **AI agent** in the same muted style as the model line. The presence dot sits on the avatar (no Standby/Working label). Choose the model line to open **Models**. **Active now** appears while it works and **Last active 5 minutes ago** after its last run or reply. That live state is the same on Agents, the Communication rail, Teams and the project lead. Choose the agent name (or the work line) while it is active to open the conversation or run it is in; **Open agent** still opens the agent page. The count row (**2 modules | 3 connections | 999+ tools**) uses the same muted style as the model line. Expanding it shows one quiet row of modules and connections (logo then name, no extra headings). Look-ups and signals for that thread sit under **This conversation**.

Real decisions live in each conversation (and under **Open conversations** on the agent). Tip cards for automated mail do not inflate those counts.

New chats in Communication require a **company agent**. If none are available for you, the composer shows **No agents available**. Open **Agents** or the setup guide to add one.

## Brief an agent

![Agent detail](/api/docs/assets/agents/agent-brief.png)
*Edit purpose, model and allowed tools.*

1. Open the agent. The **Instructions** card shows a short preview. Choose **Edit** to change the full prompt in a dialog. Also edit **Name**, **Purpose**, and **Model and runtime**.
2. Under **Model and runtime**, pick **Workspace default** (follows [Models](/docs/govern/models)), **Automatic** (Bokito picks a tier per action), or pin **Maki**, **Bokito** or **Kong**. New agents start on Workspace default.
3. Under **Tools & permissions**, choose the tool allowlist. Workspace posture and the per-type or playbook policy in [Govern](/docs/govern/govern) still bound every allowed tool.
4. On [Channels](/docs/inbox/channels), choose one default agent for each connected channel. A conversation-level agent pin always wins. **Deactivate** hides an agent from the library and clears its channel defaults; run history stays.
5. A new workspace's front desk agent ships with a description and brief already filled in. During the first chat it asks what the company does and proposes its own updated description and instructions as a Govern draft; approve it under [Govern](/docs/govern/govern) **Pending reviews** or edit the brief here yourself.

## Set when the agent acts on its own

1. Open the agent and find **When this agent acts on its own**. Set the **Ceiling**: **Manual**, **Assisted** or **Autonomous**. The ceiling caps everything the agent does, also the AI handling of conversations it owns. Only an owner or admin can set Autonomous.
2. Under **Rules**, add an exception. Write the situation, for example *Ask before anything about refunds*, choose **What the agent does** (**Never do this**, **Ask first**, **Do it without asking**) and the **Kind of rule**: **The agent weighs it** for a situation, or **Always for one action** for a specific action or category.
3. Choose **Add rule**. Rules from **Rules for all agents** on [Govern](/docs/govern/govern) show here too. Each rule counts how often it was used, approved and rejected.
4. Under **Try out**, pick an action and a certainty from 1 to 10, then **Try**. The answer says whether the agent does it on its own, asks first, or may not, and which rule decided. Below certainty 7 the agent always asks.

Sending to customers always asks, whatever the rules say. Agents can propose a rule themselves; it arrives as a card to confirm in the conversation.

## Choose who the agent asks

1. Open the agent and find **Ask questions to**.
2. Keep **Automatic** to ask the conversation owner, then whoever handed over the work, then the owner team. Someone who is away is skipped.
3. Or pick one person or one team. Their questions and drafts go there; the agent still skips that person while they are away.

## Managed agents

Some agents are owned by a platform stack or module (for example Trading). They show a **Managed** badge on the library card and the agent detail page.

1. Open **Agents** and find a card with the **Managed** label.
2. Open the agent. The badge names the owning pack when you hover.
3. If you **Deactivate** a managed agent, stack seed/update runs do not bring it back by themselves. Bokito opens a restore Decision in Communication; approve it to return the agent to the library, or reject to keep it deactivated.

## Limit who can chat

1. An idle agent shows **Ready**. Open **Communication** on the agent page (chat access). Choose **Everyone**, **Selected users**, or **Nobody**.
2. **Nobody** keeps background work (Agenda, AI handling) without a direct chat from Communication. Front desk, project and other lead agents start on **Everyone** so the whole team can ask them directly.
3. To take an agent out of the library, use **Deactivate** under the ··· menu. Status becomes **Deactivated**. On **Agents**, open the **Deactivated** filter to find them again, or use **Reactivate** on the agent page or on [Workforce](/docs/getting-started/team) under **Deactivated**. Deactivated agents leave pickers and channel access matrices; leftover grants clear when you save access. History stays. Each card shows **Last active** from the agent's last run.

## Add an agent signature

1. On a company agent, open **Email signature & send as**.
2. Choose the default **Send as**: **As this agent** (signs as the agent) or **As the approving teammate** (impersonates the person who approves).
3. Enter a plain-text signature. Line breaks are kept. When the agent sends as itself, Bokito always adds a short “Replied by an AI agent · Powered by Bokito AI” line with a link to [bokito.ai](https://bokito.ai) under the signature.
4. Save. Approvals for this agent use that default until you pick another Send as on the card.


## Set name, description or icon

1. Open a company agent.
2. Choose **Edit** at the top right of the header.
3. Change the **name**, fill in the **Description** (the short role on the library card), pick **Initials** or **Icon**, then save. Agents always use the platform AI violet — there is no per-agent color or photo picker. Instructions stay on the agent page; they are not this description.

The same look shows on the Agents library, agent detail, Communication, and the webchat header bubble for the answering agent.

## Schedule the agent

1. From the agent, open **Agenda**.
2. You land on [Agenda](/docs/ai/agenda) filtered to that agent.
3. Attach a wake so the agent runs without you starting a chat.

## What to do next

Point the agent at [Knowledge](/docs/ai/knowledge). Set how far it may go on [Autonomy](/docs/govern/autonomy). See its numbers on [Team](/docs/getting-started/team).

---
title: How Agents works
intro: The library of AI workers. Communication is where they talk; this page is where you hire and brief them.
description: Brief company agents, set chat access, deactivate them, add a signature, and set name, job title, description or bot look.
keywords: agents, ai workforce, deactivate, reactivate, chat access, signature, avatar, bot, color, default agent, ceiling, rules, try out, ask questions to, definition, capability, subagent
sort: 10
related: govern,knowledge,communication,agenda
---

# How Agents works

Agents are the AI workers for this workspace. Every agent has one shape: name, description, instructions, model, allowed tools, owner, and optional defaults. Bokito is the system agent that acts for the signed-in user; it is not part of the worker library.

## Browse the library

![Agents library](/api/docs/assets/agents/library.png)
*Each agent is a card. The default agent is marked quietly as Default.*

1. Open **Agents**. Company agents appear as cards. Each card can show **open** conversations (the agent's detail, **Open conversations**) and threads that **need a decision** (**For you**, filtered to that agent). Search and the pills **All** and **Working** narrow the grid. An agent that leads a folder shows that folder as a folder chip on its card; click it to open the folder. Above the cards, **Activity** is a now-centered timeline of even-sized points. Each point has an icon for the action type (chat, scheduled wake, heartbeat, and so on). When several actions sit close together, the point shows a number; hover to see them stacked. Sessions of two minutes or less show one clock time, not a from–to range. Choose a point to open the run, conversation or Agenda item. The same timeline sits on each agent page for that agent alone.
2. Choose **New agent**. Enter a **Name**, a required **Job title** (max 32 characters), an optional **Description**, select a **Model**, add **Instructions**, then choose **Create agent**. The job title sits under the name; the description is a longer optional blurb. Instructions are the brief the agent follows.
3. Open a card. The gear at the top right opens **Settings**: instructions, model, rules, signature, chat access and tools. Use **New chat** to start an internal thread. Agenda and conversations are quiet links under the centered profile header. Related settings (Autonomy, Knowledge, Govern) sit as links at the bottom of the page, not in the header.

Members can open an agent to read it. They see **You can read this agent. Ask an admin to change settings.** They can still chat from Communication.

In a chat with an agent, the side panel shows the function under the name, in the agent's color. The presence dot sits on the avatar (no Standby/Working label). Choose the model line to open **Models**. That live state is the same on Agents, the Communication rail, Teams and the folder lead. Choose the agent name (or the work line) while it is active to open the conversation or run it is in; **Open agent** still opens the agent page. The count row (**2 modules | 3 connections | 999+ tools**) uses the same muted style as the model line. Expanding it shows one quiet row of modules and connections (logo then name, no extra headings). Look-ups and signals for that thread sit under **This conversation**. When the conversation owns a snapshot canvas, that block also shows the canvas name, a compact preview and a link to open it.

Real decisions live in each conversation (and under **Open conversations** on the agent). Tip cards for automated mail do not inflate those counts.

New chats in Communication require a **company agent**. If none are available for you, the composer shows **No agents available**. Open **Agents** or the setup guide to add one.

## Brief an agent

![Agent detail](/api/docs/assets/agents/agent-brief.png)
*Edit purpose, model and allowed tools.*

1. Open the agent. The profile header shows the mark, **name**, required **job title** (in the mark color), and optional **description**. Choose the gear at the top right. Under **Instructions**, a short preview is shown. Choose **Edit** to change the full prompt. Also edit **Model and runtime**.
2. Under **Model and runtime**, pick **Workspace default** (follows [Models](/docs/govern/models)), **Automatic** (Bokito picks a tier per action), or pin **Maki**, **Bokito** or **Kong**. New agents start on Workspace default.
3. Under **Tools & permissions**, choose the tool allowlist. Include **Web search** and **Fetch page** when the agent should look up public facts or read a public URL (workspace search stays on **search index** / docs). Workspace posture and the per-type or flow policy in [Govern](/docs/govern/govern) still bound every allowed tool.
4. On [Channels](/docs/inbox/channels), choose one default agent for each connected channel. A conversation-level agent pin always wins while that agent is active. **Deactivate** hides an agent from the library, clears its channel defaults, and moves open conversations to the workspace lead. Past messages keep the old author. Run history stays.
5. After you create a company agent, open a chat with it and ask it to draft its own brief from the company docs. The change lands as a Govern draft; approve it under [Govern](/docs/govern/govern) **Pending reviews** or edit the brief here yourself.

## Set when the agent acts on its own

1. Open the agent, choose the gear, and find **When this agent acts on its own**. Set the **Ceiling**: **Manual**, **Assisted** or **Autonomous**. The ceiling caps everything the agent does, also the Autonomy of conversations it owns. Only an owner or admin can set Autonomous.
2. Under **Rules**, add an exception. Write the situation, for example *Ask before anything about refunds*, choose **What the agent does** (**Never do this**, **Ask first**, **Do it without asking**) and the **Kind of rule**: **The agent weighs it** for a situation, or **Always for one action** for a specific action or category.
3. Choose **Add rule**. Rules from **Rules for all agents** on [Govern](/docs/govern/govern) show here too. Each rule counts how often it was used, approved and rejected.
4. Under **Try out**, pick an action and a certainty from 1 to 10, then **Try**. The answer says whether the agent does it on its own, asks first, or may not, and which rule decided. Below certainty 7 the agent always asks.

Sending to customers always asks, whatever the rules say. Agents can propose a rule themselves; it arrives as a card to confirm in the conversation.

## Set what the agent may touch

The **Definition** card limits an agent further than its tool list, and decides how a turn must end.

1. Open the agent, choose the gear, and find **Definition**.
2. Set **Capability**: **All tools**, **No consequential tools** (never sends to customers or makes other consequential changes) or **Read only**.
3. Set **Prompt**: **Add to Bokito's prompt** keeps Bokito's working rules and adds the instructions; **Own prompt only** uses the instructions alone.
4. Fill in **Blocked tools** (blocked even when the tool list includes them), **Skills** (workspace doc paths the agent reads when they apply), **Must end with** (the agent is reminded until it calls one of these tools, at most 8 times per turn) and **MCP servers**.
5. Choose **Save**. Agents that answer customer mail always end a turn with a draft reply, a no-reply note, a decision or a sent reply.

## Choose how much the agent thinks

**Thinking** sets how hard the agent thinks before and between its actions. The agent decides per step whether to think, answer or act; this setting is the ceiling.

1. Open the agent, choose the gear, and find **Definition**.
2. Set **Thinking**: **Light** for fast short answers, **Normal** for most work, or **Thorough** for analysis and long tasks.
3. Choose **Save**. A greeting or a thank-you always gets a fast answer. On a longer task the agent first says in one sentence what it will do, then does it and ends with the result.

## Let an agent hand off a subtask

An agent can start a subagent for a side task, such as research, while it keeps working.

1. Ask the agent in a conversation to look something up or check something on the side.
2. The thread shows one row **Subagent {agent}: {task}** with its status: **Queued**, **Running**, **Done**, **Failed** or **Stopped**.
3. Choose the row to read the result. The subagent never writes in the conversation itself; the agent that started it uses the result in its own reply.
4. At most 32 subagents run at the same time per workspace, and a subagent cannot start another one.

## Choose who the agent asks

1. Open the agent and find **Ask questions to**.
2. Keep **Automatic** to ask the conversation owner, then whoever handed over the work, then the owner team. Someone who is away is skipped.
3. Or pick one person or one team. Their questions and drafts go there; the agent still skips that person while they are away.

## Bring another agent into a conversation

1. In **Communication**, open a conversation. On **Team**, type `@` or choose the **@** button next to it and pick an agent (same chip style as people), or use **Bring in an agent** for a quiet session. Without a tag the message is for the whole team and the agent that spoke last answers, unless another participant clearly fits better.
2. `@` joins them as a participant and gives them a turn (same model as the website widget and peer chats). Name two agents, or write "both", and they answer one after the other in the order you named them. Avatars under the subject show who is in the thread; **Waiting on …** shows who is next.
3. Agents ask each other a question or hand the conversation over themselves. An agent bubble that starts with another agent's chip is a question to that agent; a name inside a sentence is only a link. The activity line shows **Asked {name}** or **Handed over to {name}**, and the answer appears in the thread. After a few agent turns without you they stop with one line that gives the turn back to you. A new message from you replaces turns that were still waiting, and **Stop** ends the running turn and everything queued.
4. Leads invite module specialists (Connections → Hire / Install) instead of doing module or hashtag work themselves. Peer chats use **start conversation** and look like any other internal thread; side tasks use a subagent (see below).

## Hire a module specialist

1. Open **Connections**, then a module such as **Accounting**.
2. Under assigned agents, choose **Hire specialist**. Bokito creates a specialist for that module, puts it on the roster and the module department, and opens a setup chat.
3. Or choose an existing company agent to assign. Only rostered agents get that module’s tools.
4. In a conversation, an agent can recommend a module you have not installed. The reply shows the same card as Connections: the specialist, what the module does, partner logos, and **Install**. Approving **Turn on** hires that specialist.

## Module and department agents

Some agents belong to a module (for example a hired Accounting specialist, or a Trading pack agent). Under the name, a small line says they come from that module, and opens it on Connections.

1. Open **Agents**. A module specialist shows **From the Accounting module** under the description.
2. Open the agent. That line links to the module on Connections.
3. If you **Deactivate** such an agent, pack or module reinstall does not bring it back by itself. Bokito opens a restore Decision in Communication; approve it to return the agent to the library, or reject to keep it deactivated.

## Limit who can chat

1. An idle agent shows **Ready**. Open the gear and choose **Communication** (chat access). Choose **Everyone**, **Selected users**, or **Nobody**.
2. **Nobody** keeps background work (Agenda, Autonomy) without a direct chat from Communication. Front desk, folder and other lead agents start on **Everyone** so the whole team can ask them directly.
3. To take an agent out of the library, use **Deactivate** under the ··· menu. Status becomes **Deactivated**. On **Agents**, open the **Deactivated** filter to find them again, or use **Reactivate** on the agent page or on [Workforce](/docs/getting-started/team) under **Deactivated**. Deactivated agents leave pickers and channel access matrices; leftover grants clear when you save access. History stays. Each card shows the function description under the name.

## Add an agent signature

1. On a company agent, open the gear and choose **Email signature & send as**.
2. Choose the default **Send as**: **As this agent** (signs as the agent) or **As the approving teammate** (impersonates the person who approves).
3. Enter a plain-text signature. Line breaks are kept. When the agent sends as itself, Bokito always adds a short “Replied by an AI agent · Powered by Bokito AI” line with a link to [bokito.ai](https://bokito.ai) under the signature.
4. Save. Approvals for this agent use that default until you pick another Send as on the card.


## Set name, job title, description or look

1. Open a company agent.
2. Hover the **name**: it becomes a pill with a pencil. A click opens the same dialog as the pencil on the agent mark (or **Edit** from the ··· menu).
3. Change the **name**, fill in the required **Job title** (max 32 characters; shown under the name in the mark color), optionally add a longer **Description**, then pick **Initials** or **Bot**. For **Bot**, choose a **shape** and a **color** for the animated face (quick picks: purple, the workspace accent, and gray; open **More colors** for the rest), then save. The Claude and Cursor bodies keep their original colors, so the color picker is hidden for them. Instructions live in the gear; they are not this description.
4. Under **Preview motion**, try the moods (**Idle**, **Listening**, **Thinking**, **Working**, **Searching**, **Writing**, **Sending**, **Sleeping**) and the short reactions (**Yes**, **No**, **Alert**, **Jump**, **Done**, **Leave**). In live chats the face follows the turn: it listens while you type, thinks while it reasons, searches while it looks things up, writes while text streams or a proposal is prepared, and sends while it hands work to a colleague. When the turn ends it shows done, leaves after a handoff, or shows an alert after an error. Only while the agent is busy (thinking, searching, writing, sending or working) does a soft orb in the agent's own color light up behind it, well beyond the mark, growing and shrinking with the work. Orbits and badges around the mark stay AI purple. While idle the face looks at your cursor and leans a little toward it.

The same look shows on the Agents library, agent detail, Communication, and the webchat header bubble for the answering agent.

## Schedule the agent

1. From the agent, open **Agenda**.
2. You land on [Agenda](/docs/ai/agenda) filtered to that agent.
3. Attach a wake so the agent runs without you starting a chat.

## What to do next

Point the agent at [Knowledge](/docs/ai/knowledge). Set how far it may go on [Autonomy](/docs/govern/autonomy). See its numbers on [Team](/docs/getting-started/team).

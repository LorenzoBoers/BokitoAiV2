---
title: Platform features
intro: Every part of Bokito, from the rail to the small buttons, and how they connect.
description: Overview of all Bokito features. For each part the English and Dutch name, what it does, and which other parts it works with.
keywords: features, overview, rail, conversation, folder, works in, delivered, flow, agent, autonomy, govern, grid, agenda
sort: 15
related: welcome,communication,agents,folders,flows,agenda,team,govern
---

# Platform features

Bokito is one conversation for the company. Clients write where they already write. The team and the agents answer in the same list. Pages are for browsing. The conversation is where you start, watch and correct the work.

Each block below has the English name as title and the Dutch name under it. The text says what it does and which other features it touches.

## The five concepts

Everything in Bokito hangs on these five. Label, department, channel and contact are properties and filters, not places where work lands.

### {icon:conversation} Conversation

**NL:** Gesprek. Everything that comes in or gets started. A status makes it a ticket. A date puts it on the agenda. A repeat makes it recurring. What an agent did shows as a message in that conversation. Connects to [Communication](/docs/inbox/communication), [Agenda](/docs/ai/agenda) and [Decisions](/docs/ai/decisions).

### {icon:folder} Folder

**NL:** Map. The place where all work on one subject comes together and lands: a client, a project or a department task. Folders nest. **Works in** shows where work in that folder happens: Board, Files and canvases in Bokito, and connections such as a GitHub repo, a Drive folder or an Exact administration. What a conversation produced lands here as **Delivered**. Connects to [Folders](/docs/ai/folders), [Labels](/docs/ai/categories) and [Knowledge](/docs/ai/knowledge).

### {icon:flow} Flow

**NL:** Werk. How one kind of work runs: stages and an owner per stage. The label with the flow is the mechanism underneath, for example `complaint`. Connects to [Flows](/docs/ai/flows), [Labels](/docs/ai/categories) and [Folders](/docs/ai/folders).

### {icon:agent} Agent

**NL:** Agent. An AI worker with a name, job title, instruction, model, allowed tools and a ceiling. One agent is the lead and catches what is bound nowhere else. The same agent shows on Agents, on Workforce, on the Grid and in Communication. Connects to [Agents](/docs/ai/agents), [Workforce](/docs/getting-started/team) and [Knowledge](/docs/ai/knowledge).

### {icon:autonomy} Autonomy

**NL:** Autonomie. What an agent may do on its own: **Autonomous**, **Assisted** or **Manual**. One dial in **Govern**, tab **Policy**, for the whole workspace. A channel, a conversation, an agent or a flow may sit lower; nothing goes above the dial. Connects to [Set Autonomy](/docs/govern/autonomy) and [Replies, safeguards and handovers](/docs/inbox/inbox-ai).

## Properties

### {icon:hash} Label

**NL:** Label. A label on a conversation. A label with a flow makes the conversation a ticket in that flow; a conversation has at most one. Color and icon exist only while the flow is attached. Labels also decide which folder a conversation sits in. Connects to [Labels](/docs/ai/categories) and [Flows](/docs/ai/flows).

### {icon:contact} Contact

**NL:** Contact. The person on the other side, per channel. Status is approved, pending or blocked. Labels on the contact count for folders. Connects to [Contacts](/docs/inbox/contacts), [Channels](/docs/inbox/channels) and the [widget](/docs/inbox/widget).

### {icon:company} Organization

**NL:** Bedrijf. The CRM company of a contact, linked by email domain. This is not the workspace. Its labels pass down to every contact of that company and so to their conversations. Connects to [Contacts](/docs/inbox/contacts) and [Folders](/docs/ai/folders).

## Rail

At the top the **New conversation** button, then **Inbox** on its own, above the **Work** group. Group **Work**: Agenda, Folders, Flows. Group **Team**: Agents, Workforce. Above your account: **Connections**, then **Settings**. Today lives in Inbox, Knowledge under Agents, the Grid under Workforce, and Govern and Usage under Settings.

### {icon:new-chat} New conversation

**NL:** Nieuw gesprek. Start a conversation with a company agent open to you, or an outbound client message. Without a reachable agent the composer says there are no agents. The helper in the corner is a different chat and is hidden on this screen. Connects to [Agents](/docs/ai/agents) and [Communication](/docs/inbox/communication).

### {icon:communication} Inbox

**NL:** Inbox. The desk of the day. Mail, website chat, Slack, WhatsApp and chats with agents in one list. Queues are views: For you, open, unassigned, closed, spam, per channel, per department and per agent. See [Communication](/docs/inbox/communication).

### {icon:today} Today

**NL:** Vandaag. The first item in Inbox (`/communication/today`): what waits on you, AI activity, open tickets, what is running and the trend of the week. Connects to [Today](/docs/getting-started/cockpit) and [Agenda](/docs/ai/agenda).

### {icon:for-you} For you

**NL:** Voor jou. Conversations where the turn or an open decision sits with you or your department. The same block shows on Today. The bell counts these rows.

### {icon:composer} Composer

**NL:** Opsteller. Reply, ask the AI, or write an internal note. The client does not see a note. Email has reply, reply all and forward. `/ticket name` files a ticket. While you type, an autonomous agent drafts instead of sending. Connects to [Replies, safeguards and handovers](/docs/inbox/inbox-ai).

### {icon:decision} Decision

**NL:** Beslissing. A question inside the conversation. Approve runs the action. Reject or snooze leaves it. Cards from the same turn form one bundle. Govern keeps only structural changes. Connects to [Decisions](/docs/ai/decisions).

### {icon:reply} Suggested reply

**NL:** Voorgesteld antwoord. A draft from the agent in the conversation. In Assisted you approve, edit or reject. A draft the client has overtaken is marked outdated. Connects to [Decisions](/docs/ai/decisions).

### {icon:no-reply} No reply needed

**NL:** Geen antwoord nodig. The reading says no answer is needed. Repeated choices become a rule for that sender. On the Grid such a conversation does not count as closed without a result. Connects to [Replies, safeguards and handovers](/docs/inbox/inbox-ai).

### {icon:delivered} Delivered

**NL:** Opgeleverd. Where the work from a conversation landed: a reply through the channel, a canvas or file on the conversation, a write to a connection, or knowledge after a correction. A canvas shows as "{item} on this conversation"; labels on the conversation decide the folder. A connection names that place, such as Exact. The Why panel lists the outcomes. Connects to [Folders](/docs/ai/folders) and [Communication](/docs/inbox/communication).

### {icon:plan} Plan

**NL:** Plannen. Set a date or repeat from a conversation. Agenda shows it. Closing lasts until the next time. Connects to [Agenda](/docs/ai/agenda).

### {icon:assignment} Assignment

**NL:** Toewijzen. One owner: a person, an agent or a department. Assigning a person sets the Autonomy of that conversation to Manual. Without an assignment it falls to the channel owner, otherwise to All people. Connects to [Workforce](/docs/getting-started/team) and [Channels](/docs/inbox/channels).

### {icon:split} Move and merge conversations

**NL:** Verplaatsen en samenvoegen. **Move to** sends a message and what follows to a new or an existing conversation; a second request in a mail thread gets its own conversation and new replies land there. **Merge into...** moves a whole conversation into another. Connects to [Labels](/docs/ai/categories).

### {icon:mic} Agent dock

**NL:** Agent-dock. A row of agent faces in the bottom-right corner. Hold a face or its key (F1, F2, F4, F8, F9, Shift+F2; F12 for all) and talk; answers come back as voice notes in one queue per person. Connects to [Communication](/docs/inbox/communication).

### {icon:participants} Participants

**NL:** Deelnemers. Several people and agents in one conversation. You invite, pass the turn or post a visible message. `@agent` in the composer does that in one step. Too many turns in a row from one agent force a decision. Connects to [Agents](/docs/ai/agents).

### {icon:agenda} Agenda

**NL:** Agenda. What happened, what is due and what is planned, plus events from Google or Outlook. The number on the rail counts due work on conversations assigned to you. Connects to [Agenda](/docs/ai/agenda), [Communication](/docs/inbox/communication) and [Connections](/docs/integrations/integrations).

### {icon:folder} Folders

**NL:** Mappen. The tree of folders. Members read. Owners and admins rename, set labels and nest. A folder is a container: subfolders, conversations, images, files and canvases. The board, agenda, Works in and docs sit on the department's folder tab. Connects to [Folders](/docs/ai/folders) and [Workforce](/docs/getting-started/team).

### {icon:works-in} Works in

**NL:** Werkt in. One section on the department's folder tab, with every place where work in that folder happens, one card per place. A filled icon is inside Bokito (Board, Files, Canvas), an outlined icon is a connection. A connection that receives work always hangs on a folder. **Add to Works in** adds a place. Connects to [Workforce](/docs/getting-started/team) and [Connections](/docs/integrations/integrations).

### {icon:canvas} Canvas

**NL:** Canvas. A workspace inside a folder, for example for a client's numbers. It sits under Works in. An agent builds it in a conversation; refreshing is the repeat of that conversation on the agenda. Connects to [Folders](/docs/ai/folders), [Agents](/docs/ai/agents) and [Agenda](/docs/ai/agenda).

### {icon:board} Board

**NL:** Bord. Tickets of a flow, per stage. On a folder you see the flows that match there. On a flow you see a lane per folder. Dragging changes the stage. Connects to [Flows](/docs/ai/flows).

### {icon:flows} Flows

**NL:** Werk. The list of flows. Members see the board. Owners and admins create flows and change stages. A flow picks a free label or creates one. Connects to [Flows](/docs/ai/flows).

### {icon:stages} Stages

**NL:** Fasen. Not started, Waiting and Done, plus closed. A suggested ticket sits before the pipeline. A stage can have a checkup. It shows on the agenda and goes to the owner at that moment. Connects to [Agenda](/docs/ai/agenda).

### {icon:agent} Agents

**NL:** Agents. The library, with the **Knowledge** tab. Members read and may chat when chat access allows it. Owners and admins create, set instruction, model, tools, lead and archive. Deactivating moves open conversations to the lead. History stays. Connects to [Agents](/docs/ai/agents) and [Models](/docs/govern/models).

### {icon:knowledge} Knowledge

**NL:** Kennis. Markdown agents read on every run, for the organization, a folder or an agent. Kinds are document, memory, persona, skill and heartbeat. Publishing makes an article for the widget. Connects to [Knowledge](/docs/ai/knowledge) and the [widget](/docs/inbox/widget).

### {icon:assistant} Bokito assistant

**NL:** Bokito-assistent. Your helper in the corner and under Help. Not a company agent, not on the Grid and not in the library. Knows the screen, answers from these docs and hands work on within your role. A member cannot change channels, agents or Govern through Bokito. Connects to [Bokito](/docs/getting-started/assistant).

### {icon:workbench} Workbench

**NL:** Werkbank. Coding work goes to Cursor, Claude, Devin or a similar tool. The result comes back in the conversation. Bokito shows no code editor of its own. Connects to [Decisions](/docs/ai/decisions) and [Connections](/docs/integrations/integrations).

### {icon:workforce} Workforce

**NL:** Workforce. The sections **People and agents** and **Departments**, plus the Grid, Workflow and Organogram. Owners and admins invite and change roles. Only the owner changes another owner. An agent's ceiling sits in the same column as a person's role. Connects to [Workforce](/docs/getting-started/team) and [Agents](/docs/ai/agents).

### {icon:department} Department

**NL:** Afdeling. A group of people and agents in a tree under the organization, at most two levels deep. Each department has one point of contact, an agent that picks up its work and asks its crew, and optionally one accountable person. Without an agent it uses a pickup mode: people pick up, round robin, or least open. A module install creates one department. Connects to [Workforce](/docs/getting-started/team) and [Channels](/docs/inbox/channels).

### {icon:presence} Presence

**NL:** Aanwezigheid. Available, away or offline. You set away in the account menu. Agents skip you, departments give you no new conversation, and website chat does not count you for a live handover. Connects to [Workforce](/docs/getting-started/team) and the [widget](/docs/inbox/widget).

### {icon:grid} Grid

**NL:** Grid. The organization map in 3D: departments with their people and agents, and the folders, flows and connections they work with. Next to it sit **Workflow** and the **Organogram** (the department tree, root at the top). **Workflow**: how work runs through the company, in four layers from left to right: **Intake** (channels), **Executors** (people and agents per department), **Flow** and **Result** (reply, folders with their Works in, knowledge). Workflow's lenses are Flow, Labels and Autonomy, in 3D or 2D; bottlenecks sit in the side panel. **Open in Grid** sits on Agents, Flows and Folders. You edit on those pages. Connects to [Workforce](/docs/getting-started/team).

## Settings

Personal belongs to the member. Workspace, channels, labels, Govern, models, connections, usage and privacy belong to owners and admins.

### {icon:profile} Profile & security

**NL:** Profiel en beveiliging. Name, screen language, start page, appearance, personal signature and two-step verification. The screen language is not the working language agents write in; that sits in Govern.

### {icon:notifications} Notifications

**NL:** Meldingen. Now, later or in a daily digest. The bell opens For you. Connects to [Decisions](/docs/ai/decisions).

### {icon:branding} General and Branding

**NL:** Algemeen en huisstijl. Name, logo and look of the workspace. The logo also shows in the widget. Connects to the [setup guide](/docs/getting-started/setup-guide).

### {icon:channels} Channels

**NL:** Kanalen. Email, website chat, Slack and WhatsApp. Per channel the department it lands on and a signature. Autonomy per channel sits in Govern. A choice on the conversation wins over the department's point of contact. Connects to [Channels](/docs/inbox/channels).

### {icon:labels} Labels

**NL:** Labels. One list. A free label, attach a flow, or turn it into a folder. Here you also set who may confirm an AI suggestion. Members may always file a ticket themselves. Connects to [Labels](/docs/ai/categories).

### {icon:govern} Govern

**NL:** Govern. Two parts. The **Log**: pending reviews, version history and the recent audit. **Policy**: from top to bottom the Autonomy dial, the default per channel, **Safeguards**, handovers, the working language, and collapsed the default tool permissions. **Agent access** shows per agent what it may do. Daily replies stay in the conversation. Connects to [Govern](/docs/govern/govern) and [Set Autonomy](/docs/govern/autonomy).

### {icon:models} Models

**NL:** Modellen. The workspace default, an image model, and per agent automatic or a fixed model. Without a live key replies are placeholders. Connects to [Models](/docs/govern/models).

### {icon:connections} Connections

**NL:** Koppelingen. Discover modules and partner logins; Installed lists every registration (cards or list), including several administrations on one host. A login does not give agents tools yet: install the module first and assign an agent. A connection that receives work goes under Works in on a folder. Mailboxes open Channels. Calendar apps open Agenda. Connects to [Connections](/docs/integrations/integrations) and [MCP](/docs/integrations/mcp).

### {icon:module} Module

**NL:** Module. A package that sets up once: a department, a specialist, labels, a flow, a skill and a folder with the right Works in item. After that it is plain data. No extra rail item. Connects to [Workforce](/docs/getting-started/team), [Flows](/docs/ai/flows) and [Connections](/docs/integrations/integrations).

### {icon:usage} Usage

**NL:** Verbruik. Under **Settings**, **Usage**. Tokens and cost against a budget. An owner or admin changes the budget. Cost never bypasses an approval. Connects to [Today](/docs/getting-started/cockpit) and [Models](/docs/govern/models).

### {icon:privacy} Data & privacy

**NL:** Gegevens en privacy. Retention, whether the AI may use message text, EU-only models, and export or erase a person. Connects to [Data & privacy](/docs/govern/privacy-security).

### {icon:developers} Developers

**NL:** Voor ontwikkelaars. API tokens, MCP clients and outbound webhooks. Connects to the [API overview](/docs/developers/api-overview), [webhooks](/docs/developers/webhooks) and the [MCP endpoint](/docs/developers/mcp-endpoint).

### {icon:bin} Bin

**NL:** Prullenbak. Deleted conversations, contacts, folders, knowledge, flows, agenda items and departments. Restore or delete for good. Connects to [Data & privacy](/docs/govern/privacy-security).

### {icon:help} Help and setup guide

**NL:** Hulp en instelgids. The checklist for a new workspace and the tour of the rail. Connects to the [setup guide](/docs/getting-started/setup-guide) and the [tour](/docs/getting-started/tour).

## What to do next

1. Open [Communication](/docs/inbox/communication) and work one conversation.
2. In **Govern**, tab **Policy**, set the Autonomy dial ([Set Autonomy](/docs/govern/autonomy)) and then, on the same tab, the **Safeguards** ([Replies, safeguards and handovers](/docs/inbox/inbox-ai)).
3. Follow the [setup guide](/docs/getting-started/setup-guide) if the workspace is still empty.

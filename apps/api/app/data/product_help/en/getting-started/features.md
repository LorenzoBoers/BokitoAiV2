---
title: Platform features
intro: Every part of Bokito, from the rail to the small controls, and how they connect.
description: A map of every Bokito feature. Each entry gives the English and Dutch name, what it does, and which other parts it works with.
keywords: features, today, rail, conversation, flow, folder, agent, govern, agenda
sort: 15
related: welcome,communication,agents,folders,flows,agenda,team,govern
---

# Platform features

Bokito is one conversation for the company. Customers keep writing where they already write. The team and the agents answer in the same list. Pages are for browsing. The conversation is where you start, watch and correct the work.

Each block below names the English and Dutch label. The text says what it does and which other features it connects to.

## The seven things you name

Everything else is a screen, a setting, or something that runs in the background.

### {icon:conversation} Conversation

**NL:** Gesprek. The only thread in the platform. A status makes it a ticket. A date makes it an agenda item. A repeat makes it recurring. What an agent did appears as a message in that conversation. Connects to [Communication](/docs/inbox/communication), [Today](/docs/getting-started/cockpit), [Agenda](/docs/ai/agenda) and [Decisions](/docs/ai/decisions).

### {icon:hash} label

**NL:** label. A hashtag that starts a flow. A conversation carries at most one. Filing it makes the conversation a ticket that moves through that flow's stages. Color and icon exist only while the flow is attached. Free hashtags beside it are labels, not a separate object. Connects to [Labels](/docs/ai/categories), [Flows](/docs/ai/flows) and [Folders](/docs/ai/folders).

### {icon:flow} Flow

**NL:** Flow. The stage pipeline for exactly one label. The list shows a title beside the label, for example `#klacht`. The label stays the identity. Each stage has an owner: a person, an agent or a department. The rail says Flows. These docs and the product say Flow. Connects to [Labels](/docs/ai/categories), [Folders](/docs/ai/folders) and [Agenda](/docs/ai/agenda).

### {icon:folder} Folder

**NL:** Map. A named place in a tree. Optional labels decide which conversations belong: the conversation must carry every label in the set, including labels on the contact and the company. Nesting only moves the place. The hub holds conversations, the board, canvas, docs and files. Connects to [Labels](/docs/ai/categories), [Flows](/docs/ai/flows) and [Knowledge](/docs/ai/knowledge). A department in the Communication sidebar is a different kind of folder.

### {icon:contact} Contact

**NL:** Contact. The person on the other side, per channel. Status is approved, pending or blocked. Labels on the contact count toward folders. Connects to [Contacts](/docs/inbox/contacts), [Channels](/docs/inbox/channels) and the [widget](/docs/inbox/widget).

### {icon:company} Organization

**NL:** Bedrijf. The CRM company linked to a contact by email domain. This is not the workspace. Labels pass to every contact of that company and on to their conversations. Connects to [Contacts](/docs/inbox/contacts) and [Folders](/docs/ai/folders).

### {icon:agent} Agent

**NL:** Agent. An AI coworker with a name, job title, instructions, model and allowed tools. One agent is the lead and catches whatever nothing more specific is bound to. The same agent appears in the library, on Workforce, on Grid and in Communication. Connects to [Agents](/docs/ai/agents), [Workforce](/docs/getting-started/team), [Knowledge](/docs/ai/knowledge) and [Govern](/docs/govern/govern).

### {icon:decision} Decision

**NL:** Beslissing. A question in the conversation itself. Approving runs the action. Declining or deferring leaves it. Cards from the same turn form one bundle. [Today](/docs/getting-started/cockpit) shows the same cards under For you. [Govern](/docs/govern/govern) keeps only structural changes. Connects to [Decisions](/docs/ai/decisions).

## Rail

Pinned: New conversation, Today, Communication. Work: Folders, Flows, Agenda. AI: Agents, Knowledge, Grid. Organization: Workforce, Connections, Settings. Govern lives under Settings, not as its own rail item.

### {icon:new-chat} New conversation

**NL:** Nieuw gesprek. Start a conversation with a company agent that is open to you, or an outbound customer message. With no reachable agent the composer says none are available. The corner helper is a different conversation and stays hidden on this screen. Connects to [Agents](/docs/ai/agents) and [Communication](/docs/inbox/communication).

### {icon:today} Today

**NL:** Today. The morning scan inside Communication (`/communication/today`): what needs attention, AI activity, open tickets, what is running and the week's trajectory. For you is the same list as For you in Communication. Connects to [Today](/docs/getting-started/cockpit), [Communication](/docs/inbox/communication) and [Agenda](/docs/ai/agenda).

### {icon:canvas} Canvas

**NL:** Canvas. A snapshot, not live tiles. You pick an agent. That agent builds the canvas in a conversation. Refresh is that conversation's repeat on the agenda. Folders have their own canvas. Connects to [Agents](/docs/ai/agents), [Agenda](/docs/ai/agenda) and [Folders](/docs/ai/folders).

### {icon:usage} Usage

**NL:** Verbruik. A tab on Today. Tokens and cost against a budget. An owner or admin changes the budget. Spend does not bypass an approval. Connects to [Today](/docs/getting-started/cockpit) and [Models](/docs/govern/models).

### {icon:communication} Communication

**NL:** Communicatie. Where the day happens. Mail, website chat, Slack, WhatsApp and chats with agents in one list. Queues are views: For you, open, unassigned, closed, spam, per channel, per department and per agent. Connects to each of the seven objects above. See [Communication](/docs/inbox/communication).

### {icon:for-you} For you

**NL:** Voor jou. Conversations whose turn or open decision sits with you or your department. The same block is called For you on Today. The bell counts these rows.

### {icon:composer} Composer

**NL:** Opsteller. Reply, ask the AI, or leave an internal note. A note stays hidden from the customer. Email supports reply, reply all and forward. `/ticket #name` files a ticket. While you type, an autonomous agent drafts instead of sending. Connects to [Autonomy](/docs/inbox/inbox-ai).

### {icon:plan} Plan

**NL:** Plannen. Set a date or a repeat from a conversation. Agenda shows it. Closing lasts until the next run. Connects to [Agenda](/docs/ai/agenda).

### {icon:assignment} Assignment

**NL:** Toewijzen. One owner: a person, an agent or a department. Assigning a person sets that conversation's Autonomy to Manual. With no assignment it falls to the channel owner, otherwise to All people. Connects to [Workforce](/docs/getting-started/team) and [Channels](/docs/inbox/channels).

### {icon:split} Split conversation

**NL:** Gesprek splitsen. A second request in the same email thread becomes a new conversation. Later replies land there. Connects to [Labels](/docs/ai/categories).

### {icon:no-reply} No reply needed

**NL:** Geen antwoord nodig. The read says no answer is required. Repeated choices become a rule for that sender. Connects to [Autonomy](/docs/inbox/inbox-ai).

### {icon:reply} Suggested reply

**NL:** Voorgesteld antwoord. An agent draft in the conversation. In Assisted you approve, edit or decline it. A draft the customer has overtaken is marked outdated. Connects to [Decisions](/docs/ai/decisions).

### {icon:participants} Participants

**NL:** Deelnemers. Several people and agents in one conversation. You invite, hand over the turn or post a visible message. `@agent` in the composer does that in one step. Too many turns in a row from one agent force a decision. Connects to [Agents](/docs/ai/agents).

### {icon:folder} Folders

**NL:** Mappen. The folder tree. Members read. Owners and admins rename, set labels and nest. Connects to [Folders](/docs/ai/folders). Docs on a folder are the same knowledge as on [Knowledge](/docs/ai/knowledge).

### {icon:board} Board

**NL:** Bord. Tickets of a flow, per stage. A folder shows the flows that match here. A flow shows a lane per folder. Dragging changes the stage. Connects to [Flows](/docs/ai/flows).

### {icon:flows} Flows

**NL:** Flows. The rail name of [Flows](/docs/ai/flows). Members see the board. Owners and admins create flows and edit stages. A flow picks a free hashtag or creates one.

### {icon:stages} Stages

**NL:** Fasen. Open, waiting, done, closed. A proposed ticket sits before the pipeline. A stage can carry a check-up. That check-up shows on the agenda and goes to whoever owns the conversation at that moment. Connects to [Agenda](/docs/ai/agenda).

### {icon:agenda} Agenda

**NL:** Agenda. What happened, what is due and what is planned, plus meetings from Google or Outlook. The What list is the same label tree as Communication. The rail count is due work on conversations assigned to you. Connects to [Agenda](/docs/ai/agenda), [Communication](/docs/inbox/communication) and [Connections](/docs/integrations/integrations).

### {icon:agent} Agents

**NL:** Agents. The library. Members read and can chat when chat access allows it. Owners and admins create, brief, pick a model, set tools, choose the lead and archive. Deactivating moves open conversations to the lead. History stays. Connects to [Agents](/docs/ai/agents), [Workforce](/docs/getting-started/team) and [Models](/docs/govern/models).

### {icon:assistant} Bokito assistant

**NL:** Bokito. Your helper in the corner and under Help. Not a company agent, not on Grid, not in the library. It knows the screen, answers from these docs and hands work on within your role. A member cannot change channels, agents or Govern through Bokito. Connects to [Bokito](/docs/getting-started/assistant).

### {icon:knowledge} Knowledge

**NL:** Kennis. Markdown agents read on every run. Scoped to the organization, a folder or an agent. Kinds include a document, memory, a persona, a skill and a heartbeat. Publishing makes an article for the widget. Connects to [Knowledge](/docs/ai/knowledge), [Agents](/docs/ai/agents) and the [widget](/docs/inbox/widget).

### {icon:grid} Grid

**NL:** Grid. The organization map. The company in the center, departments as islands, people, agents, channels and flows as marks. Labels and Bokito are not on the map. Open in Grid sits on Workforce, Agents, Flows, Folders and Connections. You edit on those pages, not on the map. Connects to [Workforce](/docs/getting-started/team).

### {icon:workforce} Workforce

**NL:** Workforce. The directory of people, invites and agents, plus departments. Owners and admins invite and change roles. Only the owner changes another owner. An agent's ceiling sits in the same column as a person's role. Hire opens Connections. Connects to [Workforce](/docs/getting-started/team) and [Agents](/docs/ai/agents).

### {icon:department} Department

**NL:** Afdeling. A group of people and agents. All people and All agents always exist and do not appear as folders in Communication. Custom departments do, with a pickup: people pick up, agent first, round robin, or least open. Installing a module creates one department. Removing that department removes the module. Connects to [Channels](/docs/inbox/channels) and [Connections](/docs/integrations/integrations).

### {icon:presence} Presence

**NL:** Aanwezigheid. Available, away or offline. You set away from the account menu. Agents skip you, departments do not hand you new conversations, and website chat does not count you for a live handover. Connects to [Workforce](/docs/getting-started/team) and the [widget](/docs/inbox/widget).

### {icon:connections} Connections

**NL:** Koppelingen. Modules, partner logins and AI tools on one page. A login does not yet give agents tools. Install the module and assign an agent first. Mailboxes open Channels. Calendar apps open Agenda. Connects to [Connections](/docs/integrations/integrations) and [MCP](/docs/integrations/mcp).

### {icon:module} Module

**NL:** Module. A package that drops once: a department, a specialist, labels, a flow and a skill. After that it is ordinary workspace data. It does not add a rail item. Connects to [Workforce](/docs/getting-started/team), [Flows](/docs/ai/flows) and [Labels](/docs/ai/categories).

### {icon:workbench} Workbench

**NL:** Werkbank. Coding work handed to Cursor, Claude, Devin or a similar tool. The result comes back in the conversation. Bokito does not host its own code editor. Connects to [Decisions](/docs/ai/decisions) and [Connections](/docs/integrations/integrations).

## Settings

Personal settings belong to the member. Workspace, channels, labels, models, privacy and Govern belong to an owner or admin.

### {icon:profile} Profile and security

**NL:** Profiel en beveiliging. Name, interface language, start page, appearance, a personal signature and two-factor sign-in. The interface language is not the language agents write in.

### {icon:notifications} Notifications

**NL:** Meldingen. Now, later, or a daily digest. The bell opens For you. Connects to [Decisions](/docs/ai/decisions).

### {icon:branding} General and branding

**NL:** Algemeen en huisstijl. The workspace name, logo and look. The logo also shows in the widget. Connects to the [setup guide](/docs/getting-started/setup-guide).

### {icon:channels} Channels

**NL:** Kanalen. Email, website chat, Slack and WhatsApp. Each channel has a default agent, an owner, Autonomy and a signature. A choice on the conversation wins over the default agent. Connects to [Channels](/docs/inbox/channels) and [Autonomy](/docs/inbox/inbox-ai).

### {icon:Autonomy} Autonomy

**NL:** Autonomie. Autonomous, Assisted or Manual. One dial on Govern for the whole workspace. A channel or a conversation may sit lower, as may an agent or a flow on Always review; nothing goes above the dial. Connects to [Autonomy](/docs/inbox/inbox-ai) and [autonomy](/docs/govern/autonomy).

### {icon:labels} Labels

**NL:** Labels. One list. Make a free label, attach a flow, or save it as a folder. This page also sets who may confirm an AI proposal. Members can always file a ticket themselves. Connects to [Labels](/docs/ai/categories).

### {icon:govern} Govern

**NL:** Govern. Two parts. The log shows pending proposals, history and the audit log. Autonomy holds the one dial, the default tool permissions and each agent's passport. Day-to-day replies stay in the conversation. Connects to [Govern](/docs/govern/govern) and [autonomy](/docs/govern/autonomy).

### {icon:models} Models

**NL:** Modellen. The workspace default, an image model, and per agent automatic or a pinned model. Without a live key, replies are placeholders. Connects to [Models](/docs/govern/models) and [Usage](/docs/getting-started/cockpit).

### {icon:privacy} Data and privacy

**NL:** Gegevens en privacy. Retention, whether the AI may use message text, EU-only models, and export or erase a person. Connects to [Data & privacy](/docs/govern/privacy-security).

### {icon:developers} Developers

**NL:** Ontwikkelaars. API tokens, MCP clients and outbound webhooks. Connects to the [API today](/docs/developers/api-today), [webhooks](/docs/developers/webhooks) and the [MCP endpoint](/docs/developers/mcp-endpoint).

### {icon:bin} Bin

**NL:** Prullenbak. Deleted conversations, contacts, folders, knowledge, flows, agenda items and departments. Restore or delete permanently. Connects to [Data & privacy](/docs/govern/privacy-security).

### {icon:help} Help and setup guide

**NL:** Hulp en instelgids. The checklist for a new workspace and the tour of the rail. Connects to the [setup guide](/docs/getting-started/setup-guide) and the [tour](/docs/getting-started/tour).

## Where names meet

| What you see | What it is |
| --- | --- |
| Flows in the rail | [Flows](/docs/ai/flows) |
| For you and For you | The same conversations, two doors |
| A folder in the Communication sidebar | A department, not a [folder](/docs/ai/folders) |
| Autonomous, Assisted, Manual | The Autonomy dial in [Govern](/docs/govern/autonomy) and the exceptions in [Autonomy](/docs/inbox/inbox-ai) |
| Agents in four places | Library, Workforce, Grid and Communication |
| Knowledge and docs on a folder | The same documents, two doors |

## What to do next

1. Open [Communication](/docs/inbox/communication) and work one conversation.
2. Set the Autonomy dial in [Govern](/docs/govern/autonomy), then the safeguards in [Autonomy](/docs/inbox/inbox-ai).
3. Follow the [setup guide](/docs/getting-started/setup-guide) when the workspace is still empty.

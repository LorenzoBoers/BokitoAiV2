---
title: How Workforce works
intro: People, agents and departments on one page, with who is available.
description: Invite people, see people and agents in one directory, group them into departments, set how a department picks up conversations, mark yourself away and read department numbers.
keywords: workforce, team, members, invite, roles, teams, availability, away, round robin, least open, pickup
sort: 60
related: setup-guide,communication,agents,channels
---

# How Workforce works

Workforce shows everyone who works conversations: the people in the workspace, the company agents, and the departments you group them into. Open **Workforce** in the rail under **Organization** to invite someone, scan the directory, or build a department. The organization map lives under **AI** as **Grid** (`/grid`). Communication, Calendar, Agents, Connections, Flows, Folders, and access lists link to the same map. The map is a full-page scene: the company in the center, each department as a soft island, and people, company agents, channels, flows and other items as marks on those islands. Departments are areas with a name chip, not separate bases. Filing labels (`#tags`) do not appear as marks; ties that ran through a label show as a direct line between the linked items. The personal Bokito helper is not on the map. Drag to pan; the wheel zooms. Hover a mark for a short showcase card. The legend on the right lists everything on the map; choose a row to find and highlight that mark. A mark opens that item.

## Invite someone

![Invite strip on Workforce](/api/docs/assets/team/invite.png)
*Owners and admins invite people at the top of Workforce.*

1. Open **Workforce**. Under **Invite people**, enter a full email and set **Role**: **Admin** or **Member**. Choose **What each role can do** between the role and **Invite** if you need the permission matrix.
2. Choose **Invite**. When this server cannot send mail, use **Copy invite link** and share it yourself.
3. Pending invites appear in the directory under **Pending**. Use **Resend invite email** or **Revoke invite**. On an active person, change the role or choose **Deactivate**. Only the **Owner** can promote, demote or deactivate an owner.

Members answer conversations. Owners and admins also connect channels, change autonomy and accept Govern proposals. See [Govern](/docs/govern/govern).

## Hire new agents

1. On **Workforce**, below **Invite people**, open the **Hire new agents** banner.
2. Choose **Marketplace**. It opens Connections filtered to modules (`/connections?kind=modules`), where you install specialists next to the team.

## Mark yourself away

1. Open your account menu (bottom of the rail) and set presence to **Away**. Your dot turns gray everywhere: in the list, in the thread, in the assign picker and on Workforce.
2. While you are away, agents skip you when they pick who to ask, teams do not hand you new conversations, and the website chat does not count you as available for a live handoff.
3. Set presence back to available when you are back. Someone counts as available while Bokito is open on one of their devices.

Agents show a purple corner mark: static when on standby, pulsing when they are working on a conversation or run.

## Read the directory

1. On **Workforce**, the directory lists people, pending invites and company agents together. An agent's function sits under the name in that agent's color. **Type** is plain text: **Person** for people and invites, **Agent** in the agent violet. Filter with **All**, **People**, **Agents**, **Pending** or **Deactivated**, or search by name. **All**, **People** and **Agents** hide deactivated rows. The **Last active** column shows when a person was last online and when an agent last ran. Open **Agents** from the related links for the agent library (same **Deactivated** filter there).
2. Each person shows role, teams, open work and presence (**Available**, **Away**, **Offline**). In **Role / ceiling**, an owner or admin changes a person's role, and changes an agent's ceiling with the same kind of menu: **Manual**, **Assisted** or **Autonomous**. Only an owner or admin can raise a ceiling to **Autonomous**. Each agent uses the same mark as on Agents and in Communication, and Status is **Standby**, **Working** or **Error**. Open an agent for 30-day metrics and rules (see [Agents](/docs/ai/agents)). **Organization map** sits in the page header.
3. People and agents use their own marks; teams use a facepile of members. Corner dots follow a shared hierarchy: green when a person is available, purple pulse when an agent on the team is working, amber when someone is away, static purple when only agents are available, gray when everyone is offline.

## Deactivate a person or agent

1. On **Workforce**, open the row for a person or a company agent. Choose **Deactivate**. They leave the working roster: pickers, teams, assignment and chat targets skip them. History in conversations and agent runs stays.
2. Status on that row (and on the agent page) is **Deactivated**. Open the **Deactivated** filter to see everyone who is out of the roster.
3. Choose **Reactivate** on the row, or **Reactivate** on the agent page, to put them back. Inviting the same email again also brings a deactivated person back when they accept.

## Build a team

1. Scroll to **Teams** and choose **New team**. **All people** and **All agents** always exist; their members follow the workspace. You cannot edit or change pickup on those system teams, and they never appear as folders in Communication.
2. Give a custom team a name and optional description. Tick the people and agents in it. A team can mix both. The team mark is always the member facepile — there is no separate icon or initials choice.
3. Under **Pick up conversations**, choose how new conversations owned by the team are handled:
   - **People pick up**: the conversation stays with the team; the first person who reacts takes it.
   - **Agent first**: an agent in the team answers first; people step in when it asks.
   - **Round robin**: each new conversation goes straight to the next available member in turn.
   - **Least open**: each new conversation goes to the available member with the fewest open conversations.
4. Choose **Save**. Every custom team appears under **Teams** in the Communication sidebar as a folder with **For you**, **Open**, **Unassigned** and **Closed**.
5. Back on **Workforce**, the name of a custom team and its **Conversations** button open the same team folder. The mark on the left of each team row — and in the assign picker, mentions and Communication folders — is that facepile: up to three member marks (people and agents) overlapping; when there are more, a fourth circle shows **+N**. Agent marks on Workforce open the agent page and match the mark on the agent page. The system teams **All people** and **All agents** have no folder, so their names stay plain text.

Round robin and least open only hand work to people who are available and agents that may handle the channel. When nobody fits, the conversation stays with the team. Each hand-out appears in the timeline and in the audit log. Make a team the owner of a channel under **Settings**, **Channels** (see [Channels](/docs/inbox/channels)).

## Personal settings stay personal

Each person has **Profile** and **Notifications**. On Profile (**Settings** → **Profile & security**) they set **First name**, **Last name**, **Language** (Dutch or English for the dashboard UI — menus and labels; this is not the organization working language), **Start page**, **Appearance**, and an optional personal **Email signature** (fallback when a mailbox uses each person's signature; placeholders such as `{{name}}`, `{{first_name}}` and `{{last_name}}` fill from the profile). Shared mailbox signatures are under **Settings** → **Channels**. Organization working language (how agents write for the team) lives under **Settings** → **Communication**. On Notifications they choose what reaches them per tier: **Now** (a conversation or question for you, a new message on a conversation you or your team own — on by default with in-app and push — a mention, a customer waiting for a person), **Later** (system notices such as a failed run or a Govern proposal, never as push) and **Digest** (team activity and finished runs, collapsed in the bell and sent as a daily email). Conversations that need you land in **For you** in Communication; the bell badge mirrors that count and opens **For you**, while the list under the bell keeps system notices.

## What to do next

Finish the [setup guide](/docs/getting-started/setup-guide), then connect [channels](/docs/inbox/channels) and choose which team owns each one.

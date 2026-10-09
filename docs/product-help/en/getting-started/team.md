---
title: How Workforce works
intro: People, agents and teams on one page, with who is available.
description: Invite people, see people and agents in one directory, group them into teams, set how a team picks up conversations, mark yourself away and read team numbers.
keywords: workforce, team, members, invite, roles, teams, availability, away, round robin, least open, pickup
sort: 60
related: setup-guide,communication,agents,channels
---

# How Workforce works

Workforce shows everyone who works conversations: the people in the workspace, the company agents, and the teams you group them into. Open **Workforce** in the rail under **Organization** to invite someone, scan the directory, or build a team.

## Invite someone

![Invite strip on Workforce](/api/docs/assets/team/invite.png)
*Owners and admins invite people at the top of Workforce.*

1. Open **Workforce**. Under **Invite a teammate**, enter a full email and set **Role**: **Admin** or **Member**. Open **What each role can do** if you need the permission matrix.
2. Choose **Invite**. When this server cannot send mail, use **Copy invite link** and share it yourself.
3. Pending invites appear in the directory under **Pending**. Use **Resend invite email** or **Revoke invite**. On an active person, change the role or choose **Deactivate**. Only the **Owner** can promote, demote or deactivate an owner.

Members answer conversations. Owners and admins also connect channels, change autonomy and accept Govern proposals. See [Govern](/docs/govern/govern).

## Mark yourself away

1. Open your account menu (bottom of the rail) and set presence to **Away**. Your dot turns gray everywhere: in the list, in the thread, in the assign picker and on Workforce.
2. While you are away, agents skip you when they pick who to ask, teams do not hand you new conversations, and the website chat does not count you as available for a live handoff.
3. Set presence back to available when you are back. Someone counts as available while Bokito is open on one of their devices.

Agents show a purple corner mark: static when on standby, pulsing when they are working on a conversation or run.

## Read the directory

1. On **Workforce**, the directory lists people, pending invites and company agents together. Filter with **All**, **People**, **Agents**, **Pending** or **Deactivated**, or search by name. **All**, **People** and **Agents** hide deactivated rows. The **Last active** column shows when a person was last online and when an agent last ran. Open **Agents** from the related links for the agent library (same **Deactivated** filter there).
2. Each person shows role, teams, open work and presence (**Available**, **Away**, **Offline**). Each agent uses the same mark as on Agents and in Communication, and Status is **Standby**, **Working** or **Error** — not question counts. Open an agent for 30-day metrics and rules (see [Agents](/docs/ai/agents)).
3. People, agents and teams use the same kind of mark: two-letter initials (or an icon/image when set). Corner dots follow a shared hierarchy: green when a person is available, purple pulse when an agent on the team is working, amber when someone is away, static purple when only agents are available, gray when everyone is offline.

## Deactivate a person or agent

1. On **Workforce**, open the row for a person or a company agent. Choose **Deactivate**. They leave the working roster: pickers, teams, assignment and chat targets skip them. History in conversations and agent runs stays.
2. Status on that row (and on the agent page) is **Deactivated**. Open the **Deactivated** filter to see everyone who is out of the roster.
3. Choose **Reactivate** on the row, or **Reactivate** on the agent page, to put them back. Inviting the same email again also brings a deactivated person back when they accept.

## Build a team

1. Scroll to **Teams** and choose **New team**. **All people** and **All agents** always exist; their members follow the workspace. You cannot edit, pin or change pickup on those system teams, and they never appear as folders in Communication.
2. Give a custom team a name, an optional description, and choose a **Team mark** (initials or icon). Tick the people and agents in it. A team can mix both.
3. Under **Pick up conversations**, choose how new conversations owned by the team are handled:
   - **People pick up**: the conversation stays with the team; the first person who reacts takes it.
   - **Agent first**: an agent in the team answers first; people step in when it asks.
   - **Round robin**: each new conversation goes straight to the next available member in turn.
   - **Least open**: each new conversation goes to the available member with the fewest open conversations.
4. Switch on **Show in the Communication sidebar** to give everyone a folder for this team with **For you**, **Open**, **Unassigned** and **Closed**. Choose **Save**.
5. In **Communication**, expand that team folder and choose **Group chat**. Bokito opens (or creates) one standing internal conversation owned by the team so members can talk without a customer thread.

Round robin and least open only hand work to people who are available and agents that may handle the channel. When nobody fits, the conversation stays with the team. Each hand-out appears in the timeline and in the audit log. Make a team the owner of a channel under **Settings**, **Channels** (see [Channels](/docs/inbox/channels)).

## Personal settings stay personal

Each person has **Profile** and **Notifications**. On Profile they set **Start page**, **Appearance**, language and an optional personal **Email signature** (fallback when a mailbox uses each person's signature). Shared mailbox signatures are under **Settings** → **Channels**. On Notifications they choose what reaches them per tier: **Now** (a conversation or question for you, a mention, a customer waiting for a person), **Later** (system notices such as a failed run or a Govern proposal, never as push) and **Digest** (team activity and finished runs, collapsed in the bell and sent as a daily email). Conversations that need you land in **For you** in Communication; the bell keeps system notices only.

## What to do next

Finish the [setup guide](/docs/getting-started/setup-guide), then connect [channels](/docs/inbox/channels) and choose which team owns each one.

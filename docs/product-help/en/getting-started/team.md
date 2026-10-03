---
title: How Team works
intro: People, agents and teams in one overview, with who is available.
description: Invite people, group people and agents into teams, set how a team picks up conversations, mark yourself away and read team numbers.
keywords: team, members, invite, roles, teams, availability, away, round robin, least open, pickup
sort: 60
related: setup-guide,communication,agents,channels
---

# How Team works

Team shows everyone who works conversations: the people in the workspace, the company agents, and the teams you group them into. Open **Team** in the rail to invite someone, build a team, or see who is available right now.

## Invite someone

![People tab on Team](/api/docs/assets/team/invite.png)
*Owners and admins invite people on the People tab.*

1. Open **Team**, then the **People** tab.
2. Under **Invite a teammate**, enter a full email and set **Role**: **Admin** or **Member**. The table **What each role can do** shows invite, change agents and handle conversations.
3. Choose **Invite**. When this server cannot send mail, use **Copy invite link** and share it yourself.
4. Follow pending invites under **Pending** with **Resend invite email** or **Revoke invite**. Open an active person to change the role or choose **Remove member**. Only the **Owner** can promote, demote or remove an owner.

Members answer conversations. Owners and admins also connect channels, change autonomy and accept Govern proposals. See [Govern](/docs/govern/govern).

## Mark yourself away

1. At the top of **Team**, switch **Away** on. Your dot turns gray everywhere: in the list, in the thread, in the assign picker and on Team.
2. While you are away, agents skip you when they pick who to ask, teams do not hand you new conversations, and the website chat does not count you as available for a live handoff.
3. Switch **Away** off when you are back. Someone counts as available while Bokito is open on one of their devices.

Agents are always available unless they are paused.

## Build a team

1. Open the **Teams** tab and choose **New team**. **All people** and **All agents** always exist; their members follow the workspace.
2. Give the team a name, an optional description, and tick the people and agents in it. A team can mix both.
3. Under **Pick up conversations**, choose how new conversations owned by the team are handled:
   - **People pick up**: the conversation stays with the team; the first person who reacts takes it.
   - **Agent first**: an agent in the team answers first; people step in when it asks.
   - **Round robin**: each new conversation goes straight to the next available member in turn.
   - **Least open**: each new conversation goes to the available member with the fewest open conversations.
4. Switch on **Show in the Communication sidebar** to give everyone a folder for this team with **For you**, **Open**, **Unassigned** and **Closed**. Choose **Save**.

Round robin and least open only hand work to people who are available and agents that may handle the channel. When nobody fits, the conversation stays with the team. Each hand-out appears in the timeline and in the audit log. Make a team the owner of a channel under **Settings**, **Channels** (see [Channels](/docs/inbox/channels)).

## Read the team numbers

1. Open the **Agents** tab. Each agent shows its open conversations, its ceiling and four numbers for the last 30 days: **Questions**, **Approved unchanged**, **Answer time** and **Picked up**.
2. Open the **Teams** tab. Each team card shows how many questions went to the team, how fast they were answered, and how many conversations the team handed out.
3. A low **Approved unchanged** share means people often edit or reject what the agent proposes. Open the agent and adjust its rules (see [Agents](/docs/ai/agents)).

## Personal settings stay personal

Each person has **Profile** and **Notifications**. On Profile they set **Start page**, **Appearance**, language and a personal **Email signature**. On Notifications they choose what reaches them per tier: **Now** (a conversation or question for you, a mention, a customer waiting for a person), **Later** (system notices such as a failed run or a Govern proposal, never as push) and **Digest** (team activity and finished runs, collapsed in the bell and sent as a daily email). Conversations that need you land in **For you** in Communication; the bell keeps system notices only.

## What to do next

Finish the [setup guide](/docs/getting-started/setup-guide), then connect [channels](/docs/inbox/channels) and choose which team owns each one.

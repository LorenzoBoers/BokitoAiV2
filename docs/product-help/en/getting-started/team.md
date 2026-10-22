---
title: How Workforce works
intro: People, agents and departments on one page, with who is available.
description: Invite people, see people and agents in one directory, group them into departments, set how a department picks up conversations, mark yourself away, and read the Grid from intake to result.
keywords: workforce, team, members, invite, roles, teams, availability, away, round robin, least open, pickup, grid, lens, labels, bottlenecks
sort: 60
related: setup-guide,communication,agents,channels
---

# How Workforce works

Workforce shows everyone who works conversations: the people in the workspace, the company agents, and the departments you group them into. Open **Workforce** in the rail under **Team** to invite someone, scan the directory, or build a department. A second menu sits flush against the left rail: **People and agents**, **Departments**, **Grid** (`/workforce/grid`) and **Workflow** (`/workforce/workflow`). The Grid shows in 3D how the company is organized. Workflow shows how work runs through the company: from the channel it arrives on, past the person or agent who picks it up and the flow it runs in, to the result it lands in.

## Invite someone

![Invite strip on Workforce](/api/docs/assets/team/invite.png)
*Owners and admins invite people at the top of Workforce.*

1. Open **Workforce**. Under **Invite people**, enter a full email and set **Role**: **Admin** or **Member**. Choose **What each role can do** between the role and **Invite** if you need the permission matrix.
2. Choose **Invite**. When this server cannot send mail, use **Copy invite link** and share it yourself.
3. Pending invites appear in the directory under **Pending**. Use **Resend invite email** or **Revoke invite**. On an active person, change the role or choose **Deactivate**. Only the **Owner** can promote, demote or deactivate an owner.

Members answer conversations. Owners and admins also connect channels, change autonomy and accept Govern proposals. See [Govern](/docs/govern/govern).

## Hire new agents

1. On **Workforce**, below **Invite people**, open the **Hire new agents** banner.
2. Choose **Catalog**. It opens Connections filtered to modules (`/connections?kind=modules`), where you install specialists next to the team.

## Mark yourself away

1. Open your account menu (bottom of the rail) and set presence to **Away**. Your dot turns gray everywhere: in the list, in the thread, in the assign picker and on Workforce.
2. While you are away, agents skip you when they pick who to ask, teams do not hand you new conversations, and the website chat does not count you as available for a live handoff.
3. Set presence back to available when you are back. Someone counts as available while Bokito is open on one of their devices.

Agents show a purple corner mark: static when on standby, pulsing when they are working on a conversation or run.

## Read the directory

1. On **Workforce**, the directory lists people, pending invites and company agents together. An agent's function sits under the name in that agent's color. **Type** is plain text: **Person** for people and invites, **AI agent** for company agents (`ai_agent`). Filter with **All**, **People**, **Agents**, **Pending** or **Deactivated**, or search by name. **All**, **People** and **Agents** hide deactivated rows. The **Last active** column shows when a person was last online and when an agent last ran. Open **Agents** from the related links for the agent library (same **Deactivated** filter there).
2. Each person shows role, teams, open work and presence (**Available**, **Away**, **Offline**). In **Role / ceiling**, an owner or admin changes a person's role, and changes an agent's ceiling with the same kind of menu: **Manual**, **Assisted** or **Autonomous**. Only an owner or admin can raise a ceiling to **Autonomous**. Each agent uses the same mark as on Agents and in Communication, and Status is **Standby**, **Working** or **Error**. Open an agent for 30-day metrics and rules (see [Agents](/docs/ai/agents)). **Open in Grid** in the page header opens the Grid (same control on Agents, Flows, Folders and Connections).
3. People and agents use their own marks. On the **Departments** tab each row shows the department icon on the left and a stack of member faces on the right. Corner dots follow a shared hierarchy: green when a person is available, purple pulse when an agent on the team is working, amber when someone is away, static purple when only agents are available, gray when everyone is offline.

## Deactivate a person or agent

1. On **Workforce**, open the row for a person or a company agent. Choose **Deactivate**. They leave the working roster: pickers, teams, assignment and chat targets skip them. History in conversations and agent runs stays.
2. Status on that row (and on the agent page) is **Deactivated**. Open the **Deactivated** filter to see everyone who is out of the roster.
3. Choose **Reactivate** on the row, or **Reactivate** on the agent page, to put them back. Inviting the same email again also brings a deactivated person back when they accept.

## Build a department

1. Scroll to **Departments** and choose **New department**. **All people** and **All agents** always exist; their members follow the workspace. You cannot edit or change pickup on those system departments, and they never appear as folders in Communication.
2. Give a custom department a name and optional description. Tick the people and agents in it. A department can mix both. The icon in the left menu is set on the department page.
3. Under **Pick up conversations**, choose how new conversations owned by the team are handled:
   - **People pick up**: the conversation stays with the team; the first person who reacts takes it.
   - **Agent first**: an agent in the team answers first; people step in when it asks.
   - **Round robin**: each new conversation goes straight to the next available member in turn.
   - **Least open**: each new conversation goes to the available member with the fewest open conversations.
4. Choose **Save**. Every custom team appears under **Departments** in the Communication sidebar. Clicking it shows that department's open work, with **Unassigned** underneath.
5. Back on **Workforce** → **Departments**, each row shows the department icon on the left and a stack of member faces on the right. Click a custom department to open its page. The same facepile appears in the assign picker, mentions and Communication folders: three member marks when there are three people or agents; when there are more, the third circle shows **+N**. The system root **All** has no page of its own.

Round robin and least open only hand work to people who are available and agents that may handle the channel. When nobody fits, the conversation stays with the team. Each hand-out appears in the timeline and in the audit log. Make a team the owner of a channel under **Settings**, **Channels** (see [Channels](/docs/inbox/channels)).

## Give a freelancer a limited view

A freelancer works in one or two departments and only sees that work.

1. On **Workforce**, find the person in the directory. Under **What this member sees**, choose **Own departments**. **Whole workspace** is the default.
2. Add the person to the departments they work in (see the section above). They see the conversations, tickets and folders of those departments, and what is assigned to them.
3. In **Hours per week**, enter the hours they work for you. Leave it empty when it does not apply.
4. Tickets with an **Uren** (hours) field count toward that number; the department lead warns in the morning briefing when someone is planned over their hours.

## Run a department from its page

A department page shows who leads it, who works in it, and how each of its flows runs.

1. Choose the department under **Departments** in the left menu, between **Work** and **Team**. Each department you work in sits there in blue, like **New chat**, with its count of open tickets. Owners and admins see every department; a member sees the departments they are in and those below them.
2. The icon sits next to the title. Owners and admins click it to pick the icon the department carries in the menu.
3. At the top right sit the lead agent and the person accountable (with whether they are available now), **Department conversation**, **Open in Grid** and the gear. Under the title are the department's autonomy and the module it came from.
4. The **All** tab holds the whole department: **Open**, **Waiting**, **Overdue** and **Decisions**, then **Today** with what needs attention now (unassigned work, work past its deadline or due this week, and the lead's latest orientation).
5. Under **Flows**, each flow is a pipeline: a circle per stage with its open tickets, a dot where something is past its deadline, and a bar with the spread across stages. From its scorecard it shows **Autonomous**, **Corrected** and **Closed (7 days)**. **Open board** opens the flow. Set a flow's department on the flow page.
6. Below that, **Team** lists the members with their duty (**Primary**, **Backup**), open work and hours a week; agents also show what they are doing and their cost over 7 days. **Improvement proposals** lists what the lead proposed.
7. Next to **All** is a tab per folder the department's work lands in, home folders first. A folder tab shows the same counts and pipelines, only for the tickets in that folder; **Open folder** goes to the folder.
8. Every weekday morning, the lead agent posts a briefing in the department conversation: what is late, what waits too long on a customer, what is incomplete, and who is over capacity. On Monday it also names one improvement. A department with an outward focus, such as Research, posts trends per client once a week instead (see [Agenda](/docs/ai/agenda)).

## Tell a department what to watch

The lead agent wakes on its own when something happens in its domain, not only at its morning orientation.

1. On the department page, choose the gear at the top right to open **What the lead pays attention to**. Tick the **Events the lead follows**, such as **New messages**, **Stage changes** or **Deadlines**, set the **Daily budget (EUR)** and the **Proposals per orientation**, and choose **Save**.
2. On the **All** tab, under **Domain questions**, the lead asks the accountable person what it cannot read from the work, for example which clients come first. Type the answer and choose **Answer**; the fact goes into the brief the lead reads every time it wakes.
3. **What this department can reach** shows who the lead may push or call: the person a decision is for, or anyone in the department when the work is urgent. Each person sets quiet hours and calls on their own **Notifications** page.
4. The folder tabs show where the department's work ends up, **Pushes and calls** the recent attempts to reach someone, and **Outcomes** how its last closed work went. Each attempt also appears in the conversation it was about.

## View the Grid

The Grid is the organization map in 3D: the company in the center and each department as an island with its people and agents, and the folders, flows and connections they work with.

1. Open **Workforce** and choose **Grid**.
2. Drag to pan, right-drag to tilt and scroll to zoom. Names next to the marks appear from **160%**; below that the map shows the marks only. Point at a mark to read its name. Department islands and the company name stay visible.
3. Hover an item in the legend to light it and its direct links. Click it to find it on the map; click it on the map to open its page.

**Open in Grid** on Agents, Flows, Folders and Connections opens this map with that item found.

## Follow work in Workflow

![Workflow in 2D with the Flow lens](/api/docs/assets/team/grid.png)
*Intake on the left, executors per department, flows, and results on the right.*

1. Open **Workforce** and choose **Workflow**. Four columns read left to right: **Intake**, **Approach · who, by department**, **Kind · flow label, % autonomous** and **Outcome**. A flow shows the share of its work that ran without a correction, for example **82% autonomous**. Line width is the number of conversations in the chosen period (**7 days**, **30 days** or **90 days**).
2. Pick a lens. **Flow** shows the stream. **Labels** colors a line in the flow label's color, with the same icon as elsewhere. Labels without a flow sit together as **Other**, in gray. Choose a label to follow only that label through the chain. **Autonomy** colors executors by what they may do alone (**Autonomous**, **Assisted**, **Manual**). The panel on the right starts with **Bottlenecks**: nodes that need attention, such as work nobody picks up, or a person or agent with more than 15 open conversations or more than twice what is usual in the team.
3. Workflow opens in **3D**: the four layers stand as plates side by side. Choose **2D** for the flat board with the same nodes. Drag to pan, scroll to zoom, and choose **Reset** to return to the start view.
4. Choose a node. The panel on the right shows where its work comes from and where it goes, each with its own icon, and the split per label. When there are bottlenecks, a button with an exclamation mark and the count sits to the left of the panel. Choose it and the Bottlenecks list appears in that spot, beside the panel. Close the list and the button comes back. The item stays open. When the node is an agent or a person, the face sits on the left, the function in color beside it, and the description under that. An agent breathes while idle and shows the working motion while busy. A person uses the same layout, with their photo. **Open conversations** opens that work in Communication. On a folder, **Add to Works in** opens the folder with the add form ready.
5. When much of a node's work has no label, choose **Suggest labels**. An agent chat opens with that unlabeled work, its senders and companies, and the agent sends one label plan; nothing changes until you approve it. See [Labels and tickets](/docs/ai/categories).

The Result column says **Estimated** while not every result is recorded as a delivery yet. A folder in that column includes the work of its subfolders; choose it to see each subfolder with its own count. A write through a connection that sits in no folder, such as an invoice in the accounting package, gets its own result with the connection's name. A closed conversation without a recorded destination lands in **Done**; its panel shows how many closed as **No reply needed**. A conversation counts under its flow label, or without one under the label it got first. The orange box **No department** holds people and agents who work conversations but sit in no department.

In 2D, each department is a lane with its people and agents on the left and its flows on the right; flows without a department sit below the lanes. **Open in Grid** on a department page opens Workflow with that lane in focus. Each bottleneck names the department and lead that own it.

## Personal settings stay personal

Each person has **Profile** and **Notifications**. On Profile (**Settings** → **Profile & security**) they set **First name**, **Last name**, **Language** (Dutch or English for the dashboard UI — menus and labels; this is not the organization working language), **Start page**, **Appearance**, and an optional personal **Email signature** (fallback when a mailbox uses each person's signature; placeholders such as `{{name}}`, `{{first_name}}` and `{{last_name}}` fill from the profile). Shared mailbox signatures are under **Settings** → **Channels**. Organization working language (how agents write for the team) lives under **Settings** → **Communication**. On Notifications they choose what reaches them per tier: **Now** (a conversation or question for you, a new message on a conversation you or your team own — on by default with in-app and push — a mention, a customer waiting for a person), **Later** (system notices such as a failed run or a Govern proposal, never as push) and **Digest** (team activity and finished runs, collapsed in the bell and sent as a daily email). Conversations that need you land in **For you** in Communication; the bell badge mirrors that count and opens **For you**, while the list under the bell keeps system notices. **When agents may reach you** sets quiet hours, the most pushes a day, and whether agents may call you about a decision. A decision push carries **Approve**, **Reject** and **Call me**; in the mobile app **Call me** opens the call, where you decide or pick up in the web app.

## What to do next

Finish the [setup guide](/docs/getting-started/setup-guide), then connect [channels](/docs/inbox/channels) and choose which team owns each one.

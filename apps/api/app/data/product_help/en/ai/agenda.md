---
title: How Agenda works
intro: Everything that happens in the workspace, by people and agents, on one calendar next to your own Google or Outlook meetings.
description: See what happened, what is due and what is planned, follow up on tickets, and plan tasks for people and agents.
keywords: agenda, calendar, schedule, task, check-up, wake, google calendar, outlook calendar
sort: 50
related: agents,folders,workstreams,communication,agent-runs,integrations
---

# How Agenda works

Agenda shows what happened, what is due and what is planned, for people and agents alike. Your connected calendars sit in the same grid, so meetings and work never compete for attention. The side list is **When** (the mini month), **What** (the same `#` tree as Communication), checkboxes for each person and agent, plus your Google or Outlook calendars. **Sync** pulls the last 90 days and the next 180 days. Calendars that are off show as **Off**; turning one on starts its sync. **Today** jumps back to the current day, and the search field filters the period you are looking at.

## See what happens when

![Agenda week view](/api/docs/assets/agenda/week.png)
*Week shows meetings from connected calendars, tasks and activity per day.*

1. Open **Agenda**. The help icon next to the title in the top bar opens this guide. **Day** is the default; switch to **Week**, **Month** or **List** on the same row as **New**, or press D, W, M or L.
2. Use **Today** and the arrows (or the arrow keys) to move through time. In **List**, the current day starts at the top; scroll up for earlier days, pick a date on the mini calendar under **When**, or use **Back to top** after you scroll down. The rail stays on screen while the list scrolls.
3. On the left, the mini month stays fixed. Below it, drag section headers (**What**, people, agents, **Calendars**) to reorder them. **What** is the same `#` tree as Communication: one active branch filters tasks and activity that hang on a conversation. Connected calendars ignore that filter. Tick people and agents on or off like calendars. Turn each Google or Outlook calendar on or off under **Calendars**. The plus next to **Calendars** opens Connections filtered to calendars.
4. Choose an item to open its details on the right, with who is responsible (a person, a team or an agent), and links to the conversation, folder or agent.

## Act on what needs attention

1. The number next to **Agenda** in the left rail counts due tasks on open conversations assigned to you. **Overview** shows the same items under **Running and next up**.
2. The **Needs attention** strip above the calendar counts due tasks and failed runs. Choose a count to see those items together.
3. Open a task to see the conversation, owner and when it is due. For a recurring stage follow-up, choose **Check now** to run it right away, or **Pause** to stop it.
4. From anywhere, press Ctrl+K (Cmd+K on Mac) and choose **Tasks due**.

## Follow up tickets from a flow

1. Open a Flow and choose **Edit**. Each stage has an **Owner** (a person, agent or team, or **Keep current owner**) and a **Check-up** rhythm (**Off**, hours, days or a week).
2. When a ticket enters that stage, Agenda creates a recurring task for whoever owns the conversation. Agents pick it up as a wake; people see it in their agenda and get the conversation marked unread when it is due.
3. The ticket panel in Communication shows when the next follow-up is due. A Flow with check-ups links to **Check-ups on Agenda** under its title. See [Flows](/docs/ai/workstreams).
4. On a contact page, each conversation shows its action tag, stage and next planned task.

## Plan an agenda item or a recurring task

Every agenda item is a conversation with a date. With a repeat it becomes a recurring task: the agent writes in that one conversation each time, so the history stays together.

1. Choose **New** and pick **Agenda item**, **Recurring task**, **Webhook** or **Calendar block**.
2. For an agenda item or recurring task, fill **Title**, **When** (**One moment** or **Repeat**, for example **Every weekday** at 09:00), **For whom** (you, a teammate or a team) and optionally an **Agent** with a **Task for the agent**. Without an agent the conversation comes back unread for whoever you chose. Choose **Save**.
3. Choosing an agenda item opens its conversation in Communication, where you change the date, pause the repeat or choose **Run now**. Calendar meetings have **Open as conversation** to discuss them with colleagues or an agent.
4. For a calendar block, pick the **Calendar**, title, start and end. Turn on **All day** to put it in the top row under the date headers.
5. **Tasks** and **Activity** under **Show**, and each connected calendar you leave on, appear in the grid at their own time. Manage recurring tasks under **Manage tasks** on the left.

You plan the same way from a conversation: choose **Plan** in the thread menu. See [Communication](/docs/inbox/communication). Agents plan work too: ask one in a conversation to "check this again on Friday" or "send me an overview of open quotes every Monday". Depending on your [autonomy posture](/docs/govern/autonomy), the plan is created directly or arrives as a decision in Communication first.

## Show your Google or Outlook calendars

1. Choose the plus next to **Calendars**. It opens **Connections** filtered to calendars. Choose **Connect Google Calendar** or **Connect Outlook Calendar** under **Calendar accounts**.
2. Finish sign-in. Under **Manage** on the account, switch on which provider calendars to sync. Each switched-on calendar becomes a **workspace calendar**: you can turn sync off, add hashtags for Agenda filters, and set who may **use** (see events) or **manage** (change sync, tags and access).
3. In Agenda, each account lists its calendars with color and toggle. Hashtag chips on a calendar filter the grid to calendars that carry that tag. Hiding a calendar on this device does not change shared sync or access.
4. Choose a meeting to see its calendar, account and details. **Edit** and **Delete** appear only when you may use a writable calendar.
5. If an account shows **Sign in again**, its sign-in expired. Choose it and finish the sign-in; meetings stay visible until then.

The Google or Outlook connection holds the sign-in; each workspace calendar has its own access list. See [Connect integrations](/docs/integrations/integrations).

## What to do next

Finished runs appear under [Agent runs](/docs/inbox/agent-runs). Each [folder](/docs/ai/folders) (a saved tag filterset) can filter Agenda the same way as Communication.

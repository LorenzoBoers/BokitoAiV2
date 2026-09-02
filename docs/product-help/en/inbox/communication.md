---
title: How Communication works
intro: The hub for every conversation — customers and agents in one place.
description: Work customer email, chat and internal threads from Communication, including compose, notes, snooze and saved replies.
keywords: inbox, messages, threads, email, chat, compose, snooze, saved replies
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions
---

# How Communication works

Communication is where the day happens. Customer mail, website chat and internal agent threads share one hub. Open it when something needs a reply or a decision. While an agent works, the thread shows live purple status lines — a bubble appears only when the agent writes a reply or asks for a decision.

## Work the Open queue

Open is customer work that still needs you.

![Open queue in Communication](/api/docs/assets/communication/open-queue.png)
*Open lists customer work that still needs you.*

1. Open **Communication**. At the top, **All communication** is a folder like the rest of the sidebar: click it to expand **Open**, **Mine**, **Unassigned** and **Closed** (plus **Snoozed**, **Spam**, and the purple **Decisions** sub-view — the same list Reports **Awaiting decision** uses). **Activity**, **Contacts** and **Settings** sit pinned at the bottom — Activity and Contacts open their own pages (not the thread list). The first expand opens the default sub-view from **Settings** → **Email & messages** (Folders and tags) — usually **Open**, or **Mine** if you set that. **Outbound** is mail you started.
2. Switch to **Mine** for threads assigned to you, or **Unassigned** for work with no owner yet.
3. Scan the list. Each row shows the last real message, prefixed with **You:** when you sent it. A follow-up from the same website visitor stays in that Open thread. Use the search field at the top of the list, then open **Filters** for **Needs reply**, **Unread** or **Pinned** — they apply on top of Open, Mine or any other queue, and Bokito remembers the choice in the URL as `?filter=`. Switching filters keeps the conversation you have open. **1**–**4** switch those quick filters; **5** opens **Decisions**. A **Needs decision** badge marks threads with an open approval card. In the same **Filters** menu, narrow further by assignee, priority or channel. Click a tag chip on a row to open that tag's folder. Press **?** for inbox shortcuts: **J**/**K** move, **]**/**[** jump unread, **E** closes (Undo in the toast), **H** snoozes one hour, **Shift+H** picks a time, **X** selects, **Shift-click** selects a range, **Cmd+A** selects loaded rows, **U** marks unread, **Shift+U** marks all loaded read when nothing is selected, **A** assigns to you, **Shift+A** opens the assignee list, **P** pins, **R** focuses the reply, **C** composes, **N** starts a new chat, **L** copies the link, **#** copies the thread id, **/** searches, **Esc** returns to the list (it does not leave the thread while a menu is open). Assistant chats use the same move, pin, unread, reply and search keys.
4. The **Channels** section lists only channels you have configured: each mailbox or Bokito address, **Website chat** when the widget channel is on, and WhatsApp or Slack after you connect them. When nothing is connected yet, **Add a channel** sits at the top of that list. Every channel is a folder with the same sub-views: **Open**, **Mine**, **Unassigned** and **Closed** — and each folder lists only threads from that channel (Website chat never mixes in mailbox mail). Sub-views stay hidden until you click the channel — that expands the list and opens the default sub-view; click again to collapse. Only one folder stays expanded at a time. Change the default (globally or per channel) under **Settings**, then **Email & messages** (Folders and tags). A **Tags** section and the **Agents** section (company agents you may chat with) use the same folder pattern. Tag a conversation from its detail pane: **Add tag** searches your tag list, shows what each tag is for, and creates the tag when the name is new. A tagged conversation appears under Tags across every channel, and a thread with several tags shows up under each of them. Hover the **Tags** section and use the gear to manage tags and pin the ones you always want as folders. AI triage can add tags too, but only ones that already exist in your list.
5. Pin what matters, choose **Assign** or **Assign to me**, or **Snooze** (toolbar clock). Presets are **1 hour**, **4 hours**, **Tomorrow 9:00**, **Next Monday 9:00**, **Until the customer replies**, or **Choose date and time**. After a reply, the arrow next to **Send** offers **Send and close** and **Send and snooze** to finish in one step. **Mark loaded as read** clears unread on the conversations already in the list.
6. Select several rows for bulk **Read**, **Close**, **Pin**, **Mark as spam**, **Assign to me**, **Assign**, **Reopen**, **Mark unread** or **Snooze until tomorrow 9:00**. Shift-click a checkbox to take the range from the last selected row. The row indicator menu can also snooze until tomorrow. **More** holds Snoozed, Closed and Spam. The command palette also jumps to Closed, Spam, Activity, New chat, Needs reply and Decisions, and can open a conversation or run by ID.

Snoozed threads sit under **Snoozed** until the timer fires or the customer writes again. Opening one from Snoozed returns you to Open. A closed conversation reopens on its own when the customer replies in the same email thread, so a late "thanks, one more thing" lands back in Open instead of starting a new conversation.

## Start a new chat or email

1. Choose **New chat** to open a composer. **Back to Messages** returns to Open. Choose a **company agent** in To (required), or pick a person / type an email. Enter starts the thread. If no agents are available, the page shows **No agents available**.
2. Choose **New email** to compose outbound mail. Pick From (a connected mailbox), To, subject and attachments. **Templates** inserts a saved reply, same library as the thread composer. A Bokito address you created counts as a mailbox you can send from. The list header shows when mail last arrived; open **Channel settings** if that looks stale.
3. You can also start mail from a contact card or the command palette.
4. An empty inbox still offers **New chat**, **Install widget**, and the setup guide — website chat does not wait for email.

## Reply, note, or insert a saved reply

![Thread and composer in Communication](/api/docs/assets/communication/thread-composer.png)
*The thread, contact and composer sit on one screen.*

1. Select a thread. History, contact and AI context sit on one screen.
2. The composer sends on the same channel the customer used. The first tab is always **Reply**, with the channel icon (email, WhatsApp, website chat, …) and a hover tooltip for the channel and recipient. **Ctrl+Enter** sends email and is printed on the Send button; Enter sends chat. The arrow next to **Send** holds **Send and close** and **Send and snooze**. **Send as:** **You** or the agent picks whose signature is appended and whose name appears as the email From display name (the mailbox address stays the connected account).
3. Switch to **Internal** for a team message the customer never sees (hover the tab for the reminder). Typing `@` and selecting a person or agent from the picker switches you to Internal (or into an agent meta conversation). Plain `@text` without a selection stays customer reply text. Switching back to Reply flattens mentions to plain `@Name`. Internal messages still work if no mailbox can send. Closed or spam threads keep them too — a **Reopen** button sits on the composer.
4. Open **Templates** in the composer to insert a saved reply, or save the current text as one. Manage the library under **Settings**, then **Email & messages** (Saved replies).
5. Email replies can add CC/BCC and append your mailbox signature. When the customer copied colleagues on their email, **Reply all** pre-fills their CC list (and other To recipients, not your mailbox). **Quote** inserts the last inbound lines, including HTML-only mail. **Forward as new email** keeps attachments. After you close or task the same sender several times, Bokito can ask to always do that — **Always do this** or **Not now**. From the thread menu you can also choose **Always close mail from this sender**. Those rules live under Email & messages.
6. Search also matches company names and attachment filenames.

## Use an AI draft

1. When [Inbox AI](/docs/inbox/inbox-ai) is on **Suggest replies**, a draft card sits in the thread. The card shows only the customer-facing reply. Team context sits under it as an **Internal note** (not sent with the email).
2. Choose **Send as:** **You** or the agent — the signature sits directly under the draft body in the same card (not under the internal note). The chosen identity also sets the From display name on the mail; the mailbox address does not change. When none is configured, Bokito shows a default built from name, role, company and workspace language, with a **Set signature** link to Profile or the agent page. Edit the wording, then send — or choose **Not now** / **I'll handle it myself**. Sending or approving one draft dismisses leftover suggestion cards. Older dismissed drafts collapse to one line (**Earlier draft — dismissed**).
3. Ask the agent in a meta conversation to draft a reply; it proposes one as a suggested-reply card on the conversation, which you approve, edit or decline like any other draft. There is no separate **Draft with AI** button in the composer.
4. A banner on the thread says when the AI is handling it. **Take over from AI** pauses the assistant so you can finish by hand. Sending a reply also pauses the AI and ends any open meta conversation. **Hand back to AI** resumes it. On **Reply automatically**, take over is how you stop a live send. In website chat the visitor sees a "team member is handling this" banner appear on takeover and disappear again on handback or close.

## Talk with an agent in the thread

Pull an agent in when you want to think out loud, look something up, or hand the conversation over.

1. Click the purple agent chip in the composer (named after the thread owner, or open a short list of candidates), or type `@` and select an agent. That starts an internal meta conversation — the customer never sees it.
2. Meta turns appear as normal chat bubbles in a light violet band in the same timeline (not a nested scroll panel). The composer stays on the agent tab until you end the session or send a customer Reply.
3. Ask for a reply and the agent proposes one as a suggested-reply card. Ask it to continue with the contact and it can take the conversation over. Tagging a teammate mid-meta notifies them; the message still goes to the agent.
4. When work is done — or after a few minutes of silence — the agent (or the system) offers a checkout card: end the session, continue, or apply follow-ups. Approving **End session** collapses the segment to a summary you can expand later. Sending a customer Reply ends the meta session without running checkout actions.
5. Changed your mind before you typed anything? **Cancel** removes the session. Once you have exchanged a message, use the checkout or **End session**.

## Decide in the thread

![Decision card in a thread](/api/docs/assets/communication/decision-card.png)
*Decision cards appear in the timeline.*

1. A decision card appears when an agent needs your judgment.
2. Read the proposal. When the card offers several concrete choices, each button keeps its own label (for example send vs cancel vs ask the customer). Approve, edit or decline. **Later** / **Not now** parks the conversation until tomorrow 9:00 so it leaves Open. The single **I'll handle it myself** button is only for pausing AI so you take over.
3. Nothing customer-facing goes out until you answer, unless autonomy allows it. Approving **Create task** opens a follow-up on [Agenda](/docs/ai/agenda). You can also create a task from the thread menu on any customer conversation, or choose **Add to project** in the same menu to send the thread to a project's queue with a project picker — real work lands on the project backlog without leaving the conversation. See [Decisions](/docs/ai/decisions).

## Capture a website visitor

1. Open a website-chat thread. The header can show **+N earlier** when this person already wrote before — that opens the contact panel.
2. In **Details**, type their name and email, then **Save email**. Write email becomes available once a real address is stored.
3. The contact card shows whether they are approved, pending or blocked, and company names open the company page when one exists. Unsaved contact notes stay highlighted until you save, and leaving the page asks you to confirm. Mail from a workspace member shows a **Teammate** card instead (no Block or Approve) — they are not treated as a customer contact.

## What to do next

Connect a mailbox under [Channels](/docs/inbox/channels). Open [Contacts](/docs/inbox/contacts) to see who is writing in.

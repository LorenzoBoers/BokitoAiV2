---
title: How Communication works
intro: The hub for every conversation — customers and agents in one place.
description: Work customer email, chat and internal threads from Communication, including compose, notes, snooze and saved replies.
keywords: inbox, communication, messages, threads, email, chat, compose, snooze, saved replies
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions,cases
---

# How Communication works

Communication is where the day happens. Customer mail, website chat and internal agent threads share one hub. Open it when something needs a reply or a decision. While an agent works, the thread shows live purple status lines — a bubble appears only when the agent writes a reply or asks for a decision.

## Work the Open queue

Open is customer work that still needs you.

![Open queue in Communication](/api/docs/assets/communication/open-queue.png)
*Open lists customer work that still needs you.*

1. Open **Communication**. At the top, **All communication** is a folder: click it to expand **Open**, **Mine**, **Unassigned** and **Closed** (plus **Snoozed** and **Spam**). Directly below sits **Decisions** — the folder for every conversation with an open approval card (customer and internal). Overview, the bell, and deep links land there. **Contacts** and **Settings** sit pinned at the bottom. The first expand opens the default sub-view from **Settings** → **Channels** (Folders) — usually **Open**, or **Mine** if you set that.
2. Switch to **Mine** for threads assigned to you, or **Unassigned** for work with no owner yet. Open **Decisions** when you only want yes/no cards.
3. Scan the list. Each row shows the last real message, prefixed with **You:** when you sent it. A follow-up from the same website visitor stays in that Open thread. Use the search field at the top of the list, then open **Filters** for **Needs reply**, **Unread** or **Pinned** — they apply on top of Open, Mine or any other queue. Filters do not stick across folders. A **Needs decision** badge marks rows with an open card. Press **?** for inbox shortcuts: **J**/**K** move, **]**/**[** jump unread, **E** closes (Undo in the toast), **H** snoozes one hour, **Shift+H** picks a time, **X** selects, **Shift-click** selects a range, **Cmd+A** selects loaded rows, **U** marks unread, **Shift+U** marks all loaded read when nothing is selected, **A** assigns to you, **Shift+A** opens the assignee list, **P** pins, **R** focuses the reply, **C** composes, **N** starts a new chat, **L** copies the link, **#** copies the thread id, **/** searches, **Esc** returns to the list (it does not leave the thread while a menu is open). Assistant chats use the same move, pin, unread, reply and search keys.
4. The **Channels** section lists only channels you have configured: each mailbox or Bokito address, **Website chat** when the widget channel is on, and WhatsApp after you connect it. When nothing is connected yet, **Add a channel** sits at the top of that list. Every channel is a folder with the same sub-views: **Open**, **Mine**, **Unassigned** and **Closed** — and each folder lists only threads from that channel (Website chat never mixes in mailbox mail). Sub-views stay hidden until you click the channel — that expands the list and opens the default sub-view; click again to collapse. Only one folder stays expanded at a time. Change the default (globally or per channel) under **Settings**, then **Channels** (Folders). The **Agents** section (company agents you may chat with) uses the same folder pattern. Classification uses Signals, not tags: review them under **This conversation** and manage their catalog under **Settings** → **Signal types**. See [How Signals work](/docs/ai/cases).
5. Pin what matters, choose **Assign** or **Assign to me**, or **Snooze** (toolbar clock). Presets are **1 hour**, **4 hours**, **Tomorrow 9:00**, **Next Monday 9:00**, **Until the customer replies**, or **Choose date and time**. After a reply, the arrow next to **Send** offers **Send and close** and **Send and snooze** to finish in one step. **Mark loaded as read** clears unread on the conversations already in the list.
6. Select several rows for bulk **Read**, **Close**, **Pin**, **Mark as spam**, **Assign to me**, **Assign**, **Reopen**, **Mark unread** or **Snooze until tomorrow 9:00**. Shift-click a checkbox to take the range from the last selected row. The row indicator menu can also snooze until tomorrow. **More** holds Snoozed, Closed and Spam. The command palette also jumps to Closed, Spam, Activity, New chat, Needs reply and Decisions, and can open a conversation or run by ID.

Snoozed threads sit under **Snoozed** until the timer fires or the customer writes again. Opening one from Snoozed returns you to Open. A closed conversation reopens on its own when the customer replies in the same email thread, so a late "thanks, one more thing" lands back in Open instead of starting a new conversation.

## Start a new chat or email

1. Choose **New chat**. You see three large choices: **Contact**, **Agent**, and **Teammate**. Nothing is created until you send — this is a draft in Communication.
2. **Contact** (or **Teammate**): pick **To**, choose **From** (a connected mailbox; you can switch before send and optionally **Remember as default**), add a subject, write the message, then send. Hover **+** on a mailbox in the sidebar to start with that From already set. Typing a new address is fine; a contact is not required first.
3. **Agent**: pick a company agent (or use **+** on an agent row), type, and send. That creates the chat thread. If no agents are available, the page says so.
4. You can also start mail from a contact card or the command palette. Forward from a thread still opens the compose dialog.
5. An empty inbox still offers **New chat**, **Install widget**, and the setup guide — website chat does not wait for email.

## Reply, note, or insert a saved reply

![Thread and composer in Communication](/api/docs/assets/communication/thread-composer.png)
*The thread, contact and composer sit on one screen.*

1. Select a thread. The title sits in the header; under it a meta row shows priority, cases on this conversation, and (right-aligned, purple) the channel agent. Contact details stay in the side panel — the agent is not listed there, because it owns the channel/thread, not the person.
2. The composer sends on the same channel the customer used. On email threads the first tab shows the **mailbox name** (and provider icon) instead of a generic Reply label — hover for the send-from hint. When you have more than one mailbox, open that tab to pick another; sending from a different mailbox **moves** the conversation to that channel. **Ctrl+Enter** sends email and is printed on the Send button; Enter sends chat. The arrow next to **Send** holds **Send and close** and **Send and snooze**. **Send as:** **You** or the agent picks whose signature is appended and whose name appears as the email From display name (the mailbox address stays the connected account).
3. Switch to **Internal** for a team message the customer never sees (hover the tab for the reminder). Typing `@` and selecting a person or agent from the picker switches you to Internal (or into an agent meta conversation). Plain `@text` without a selection stays customer reply text. Switching back to Reply flattens mentions to plain `@Name`. Internal messages still work if no mailbox can send. Closed or spam threads keep them too — a **Reopen** button sits on the composer.
4. Open **Write** (sparkles) in the composer to describe what you want to send, or to rewrite, shorten, expand or change the tone of text already in the box. Under **What should this say?** you can dictate with the same microphone control. Dictation also works on Reply, Internal and the agent tab: hold to talk or click to start; while listening the button matches the chat widget (green glow and wave bars; hover shows a check). Click or release to confirm. Spoken text lands live in the box and the field grows with it. Saved replies live under that Write menu, or under **Settings**, then **Channels**.
5. Email replies can add CC/BCC and append your mailbox signature. When the customer copied colleagues on their email, **Reply all** pre-fills their CC list (and other To recipients, not your mailbox). **Quote** inserts the last inbound lines, including HTML-only mail. **Forward as new email** keeps attachments. After you close or task the same sender several times, Bokito can ask to always do that — **Always do this** or **Not now**. From the thread menu you can also choose **Always close mail from this sender**. Those rules live under **Channels**.
6. Search also matches company names and attachment filenames.

## Use an AI draft

1. When [Inbox AI](/docs/inbox/inbox-ai) is on **Suggest replies**, a suggested-reply bubble sits in the thread on the left with the agent avatar — same chat chrome as other agent messages. The bubble shows only the customer-facing reply. Team context sits under it as an **Internal note** (not sent with the email).
2. Choose **Send as:** **You** or the agent — the signature sits directly under the draft body in the same bubble (not under the internal note). The chosen identity also sets the From display name on the mail; the mailbox address does not change. When none is configured, Bokito shows a default built from name, role, company and workspace language, with a **Set signature** link to Profile or the agent page. Edit the wording, then send — or choose **Not now** / **I'll handle it myself**. Sending or approving one draft dismisses leftover suggestions. Older dismissed drafts collapse to one short bubble (**Earlier draft — dismissed**).
3. Or use **Write** in the composer: type an intent (or leave it empty to draft from the thread), generate into the reply box, then edit and send yourself. Quick actions rewrite text already in the box. Nothing is sent until you press Send.
4. A banner on the thread says when the AI is handling it, or when AI is paused. When a visitor asks for a human, the banner reads **Customer asked for a human — AI paused.** **Take over from AI** (on that banner) pauses the assistant so you can finish by hand; the composer opens on **Reply**. Sending a reply also pauses the AI and ends any open meta conversation. **Resume AI** hands it back. On **Reply automatically**, take over is how you stop a live send. In website chat the visitor sees a "team member is handling this" banner appear on takeover and disappear again on handback or close. Turn customer human-ask alerts on or off under **Settings**, then **Notifications**.

## Talk with an agent in the thread

Pull an agent in when you want to think out loud, look something up, or hand the conversation over.

1. Open the agent tab in the composer (named after the thread owner), or type `@` and select an agent. Switching to the tab alone does not start a meta conversation — your first message on that tab does. The customer never sees it.
2. Type on the agent tab and press Enter. Your message appears as a right-aligned bubble; the agent streams a left-aligned bubble in the same timeline (no separate violet panel). A thin **internal** strip marks the session. You can send again while it replies: the current answer stops, your new message is queued, and the agent continues with the buffered texts. **Stop** cancels without queuing. The composer stays on the agent tab until you end the session or send a customer Reply.
3. Ask for a reply and the agent proposes one as a suggested-reply bubble. Prefer **Write** in the composer when you only need text in the reply box — use the agent tab for research and coordination. Tagging a teammate mid-meta notifies them; the message still goes to the agent. Suggestions do not switch the composer to Reply while a stream is still running.
4. When work is done — or after a few minutes of silence — the agent (or the system) offers a checkout decision: end the session, continue, or apply follow-ups. Approving **End session** collapses the meta chat to one shared summary bubble (agent avatar left, yours on the right) that you can expand later. Sending a customer Reply ends the meta session without running checkout actions. Agent messages that go out to the customer show **Sent to the customer** under the agent name so they stay distinct from internal meta bubbles.
5. Changed your mind before you typed anything? **Cancel** removes the session. Once you have exchanged a message, use the checkout or **End session**.

## Decide in the thread

![Decision card in a thread](/api/docs/assets/communication/decision-card.png)
*Decision cards appear in the timeline as chat bubbles.*

1. A decision bubble appears when an agent needs your judgment.
2. Read the proposal. When the card offers several concrete choices, each button keeps its own label (for example send vs cancel vs ask the customer). Approve, edit or decline. **Later** / **Not now** parks the conversation until tomorrow 9:00 so it leaves Open. The single **I'll handle it myself** button is only for pausing AI so you take over.
3. Nothing customer-facing goes out until you answer, unless autonomy allows it. Approving **What next** (or the old Create task choice) sets a next look-at on this conversation — a title and when — and shows it on [Agenda](/docs/ai/agenda). From the thread menu choose **What next** to schedule a look-at or open a typed Signal. Clear the look-at under **This conversation** in the side panel when you are done. Choose **Add to project** in the same menu to link the thread to a project. See [Decisions](/docs/ai/decisions).

## Capture a website visitor

1. Open a website-chat thread. The header can show **+N earlier** when this person already wrote before — that opens the contact panel.
2. In **Details**, type their name and email, then **Save email**. Write email becomes available once a real address is stored.
3. The contact card shows whether they are approved, pending or blocked, and company names open the company page when one exists. Unsaved contact notes stay highlighted until you save, and leaving the page asks you to confirm. Mail from a workspace member shows a **Teammate** card instead (no Block or Approve) — they are not treated as a customer contact.

## See signals on a conversation

1. Open a customer or internal thread. The side panel lists **Signals** under **This conversation**.
2. Each row shows the type, status, and a playbook or project link when one is bound.
3. Choose **Add a signal**, or **Add Storing** / **Add Factuur/betaling** (or another type) when a second intent appears. Several signals can sit on one conversation — see [Signals](/docs/ai/cases).

## What to do next

Connect a mailbox under [Channels](/docs/inbox/channels). Open [Contacts](/docs/inbox/contacts) to see who is writing in.

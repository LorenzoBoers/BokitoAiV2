---
title: How Communication works
intro: The hub for every conversation — customers and agents in one place.
description: Work customer email, chat and internal threads from Communication, including compose, notes, snooze and saved replies.
keywords: inbox, messages, threads, email, chat, compose, snooze, saved replies
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions
---

# How Communication works

Communication is where the day happens. Customer mail, website chat and internal agent threads share one hub. Open it when something needs a reply or a decision.

## Work the Open queue

Open is customer work that still needs you.

![Open queue in Communication](/api/docs/assets/communication/open-queue.png)
*Open lists customer work that still needs you.*

1. Open **Communication**. The sidebar splits **Customer** and **Agents**. Customer work lands on **Open** (still needs anyone). **All** is the same inbox without that filter. **Outbound** is mail you started. Agent jobs stay under **Agents** → [Agent runs](/docs/inbox/agent-runs).
2. Switch to **Mine** for threads assigned to you, or **Unassigned** for work with no owner yet.
3. Scan the list. Each row shows the last real message, prefixed with **You:** when you sent it. A follow-up from the same website visitor stays in that Open thread. Use **Needs reply**, **Unread** or **Pinned** — they apply on top of Open, Mine or any other queue, and Bokito remembers the chip in the URL as `?filter=`. **1**–**4** switch those chips from the keyboard. Narrow further with assignee, priority or channel. The **Labels** section filters Urgent, VIP, Follow-up or Billing. Press **?** for inbox shortcuts: **J**/**K** move, **]**/**[** jump unread, **E** closes (Undo in the toast), **H** snoozes one hour, **Shift+H** picks a time, **X** selects, **Shift-click** selects a range, **Cmd+A** selects loaded rows, **U** marks unread, **Shift+U** marks read, **A** assigns to you, **Shift+A** opens the assignee list, **P** pins, **R** focuses the reply, **C** composes, **N** starts a new chat, **L** copies the link, **#** copies the thread id, **/** searches, **Esc** returns to the list. Assistant chats use the same move, pin, unread, reply and search keys.
4. The **Channels** section lists each mailbox, **Website chat**, **Team chat**, and WhatsApp or Slack after you connect them. If no mailbox is connected yet, **Connect email** sits at the top of that list.
5. Pin what matters, choose **Assign** or **Assign to me**, or **Snooze** (toolbar clock). Presets are **1 hour**, **4 hours**, **Tomorrow 9:00**, **Next Monday 9:00**, **Until the customer replies**, or **Choose date and time**. After a reply, **Send and snooze** parks the thread in one step. **Mark loaded as read** clears unread on the conversations already in the list.
6. Select several rows for bulk **Read**, **Close**, **Pin**, **Mark as spam**, **Assign to me**, **Assign**, **Reopen** or **Mark unread**. Shift-click a checkbox to take the range from the last selected row. **More** holds Snoozed, Closed and Spam. The command palette also jumps to Closed, Spam, Agent runs, Assistant, and Needs reply, and can open a conversation or run by ID.

Snoozed threads sit under **Snoozed** until the timer fires or the customer writes again. Opening one from Snoozed returns you to Open.

## Start a new chat or email

1. Choose **New chat** to open a composer. **Back to Messages** returns to Open. The To field defaults to your personal assistant — pick a person, agent, or type an email. Enter starts the thread.
2. Choose **New email** to compose outbound mail. Pick From (a connected mailbox), To, subject and attachments.
3. You can also start mail from a contact card or the command palette.

## Reply, note, or insert a saved reply

![Thread and composer in Communication](/api/docs/assets/communication/thread-composer.png)
*The thread, contact and composer sit on one screen.*

1. Select a thread. History, contact and AI context sit on one screen.
2. The composer sends on the same channel the customer used (Email, Chat, WhatsApp). **Ctrl+Enter** sends email; Enter sends chat. **Send as:** **You** or the agent picks whose signature is appended.
3. Switch to **Note** for an internal comment the customer never sees (the hint says so). Notes still work if the mailbox was disconnected.
4. Open **Templates** in the composer to insert a saved reply, or save the current text as one. Manage the library under **Settings**, then **Email & messages** (Saved replies).
5. Email replies can add CC/BCC and append your mailbox signature. After you close or task the same sender several times, Bokito can ask to always do that — **Always do this** or **Not now**. Those rules live under Email & messages.

## Use an AI draft

1. When [Inbox AI](/docs/inbox/inbox-ai) is on **Suggest replies**, a draft card sits in the thread.
2. Edit the wording, then send — or choose **Not now** / **I'll handle it myself**. Sending or approving one draft dismisses leftover suggestion cards. Older dismissed drafts collapse to one line (**Earlier draft — dismissed**).
3. **Draft with AI** in the composer asks for a one-off draft without waiting for inbound mail. Optional guidance steers the tone.
4. **Take over from AI** pauses the assistant on that thread so you can finish by hand. **Hand back to AI** resumes it. On **Reply automatically**, take over is how you stop a live send.

## Decide in the thread

![Decision card in a thread](/api/docs/assets/communication/decision-card.png)
*Decision cards appear in the timeline.*

1. A decision card appears when an agent needs your judgment.
2. Read the proposal. Approve, edit or decline.
3. Nothing customer-facing goes out until you answer, unless autonomy allows it. See [Decisions](/docs/ai/decisions).

## What to do next

Connect a mailbox under [Channels](/docs/inbox/channels). Open [Contacts](/docs/inbox/contacts) to see who is writing in.

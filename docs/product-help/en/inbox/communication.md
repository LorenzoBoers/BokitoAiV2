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

1. Open **Communication**. The sidebar splits **Customer** and **Agents**. Customer work lands on **Open** (still needs anyone). **All** is the same inbox without that filter. **Outbound** is mail you started. Agent jobs stay under **Agents** → [Agent runs](/docs/inbox/agent-runs).
2. Switch to **Mine** for threads assigned to you, or **Unassigned** for work with no owner yet.
3. Scan the list. Each row shows the last real message, prefixed with **You:** when you sent it. A follow-up from the same website visitor stays in that Open thread. Use **Needs reply**, **Unread** or **Pinned** — they apply on top of Open, Mine or any other queue, and Bokito remembers the chip in the URL as `?filter=`. **1**–**4** switch those chips from the keyboard. Narrow further with assignee, priority or channel. The **Labels** section filters Urgent, VIP, Follow-up or Billing. Press **?** for inbox shortcuts: **J**/**K** move, **]**/**[** jump unread, **E** closes (Undo in the toast), **H** snoozes one hour, **Shift+H** picks a time, **X** selects, **Shift-click** selects a range, **Cmd+A** selects loaded rows, **U** marks unread, **Shift+U** marks read, **A** assigns to you, **Shift+A** opens the assignee list, **P** pins, **R** focuses the reply, **C** composes, **N** starts a new chat, **L** copies the link, **#** copies the thread id, **/** searches, **Esc** returns to the list. Assistant chats use the same move, pin, unread, reply and search keys.
4. The **Channels** section lists each mailbox, **Website chat**, **Team chat**, and WhatsApp or Slack after you connect them. If no mailbox is connected yet, **Connect email** sits at the top of that list.
5. Pin what matters, choose **Assign** or **Assign to me**, or **Snooze** (toolbar clock). Presets are **1 hour**, **4 hours**, **Tomorrow 9:00**, **Next Monday 9:00**, **Until the customer replies**, or **Choose date and time**. After a reply, the arrow next to **Send** offers **Send and close** and **Send and snooze** to finish in one step. **Mark loaded as read** clears unread on the conversations already in the list.
6. Select several rows for bulk **Read**, **Close**, **Pin**, **Mark as spam**, **Assign to me**, **Assign**, **Reopen** or **Mark unread**. Shift-click a checkbox to take the range from the last selected row. **More** holds Snoozed, Closed and Spam. The command palette also jumps to Closed, Spam, Agent runs, Assistant, and Needs reply, and can open a conversation or run by ID.

Snoozed threads sit under **Snoozed** until the timer fires or the customer writes again. Opening one from Snoozed returns you to Open. A closed conversation reopens on its own when the customer replies in the same email thread, so a late "thanks, one more thing" lands back in Open instead of starting a new conversation.

## Start a new chat or email

1. Choose **New chat** to open a composer. **Back to Messages** returns to Open. The To field defaults to your personal assistant — pick a person, agent, or type an email. Enter starts the thread.
2. Choose **New email** to compose outbound mail. Pick From (a connected mailbox), To, subject and attachments. The built-in Bokito address counts as a mailbox you can send from.
3. You can also start mail from a contact card or the command palette.
4. An empty inbox still offers **New chat**, **Install widget**, and the setup guide — website chat does not wait for email.

## Reply, note, or insert a saved reply

![Thread and composer in Communication](/api/docs/assets/communication/thread-composer.png)
*The thread, contact and composer sit on one screen.*

1. Select a thread. History, contact and AI context sit on one screen.
2. The composer sends on the same channel the customer used (Email, Chat, WhatsApp). **Ctrl+Enter** sends email; Enter sends chat — hover the **Send** button to see the shortcut. The arrow next to **Send** holds **Send and close** and **Send and snooze**. **Send as:** **You** or the agent picks whose signature is appended.
3. Switch to **Note** for an internal comment the customer never sees (hover the tab for the reminder). Notes still work if no mailbox can send. Closed or spam threads keep notes too — **Reopen** sits on the composer so you do not hunt for it.
4. Open **Templates** in the composer to insert a saved reply, or save the current text as one. Manage the library under **Settings**, then **Email & messages** (Saved replies).
5. Email replies can add CC/BCC and append your mailbox signature. When the customer copied colleagues on their email, **Reply all** pre-fills their CC list. **Quote** inserts the last inbound lines. After you close or task the same sender several times, Bokito can ask to always do that — **Always do this** or **Not now**. Those rules live under Email & messages.
6. Invoice or quote threads show **Open bookkeeping** and can add a **Billing** label. After you send, a toast offers Bookkeeping so you check the amount before you promise anything.

## Use an AI draft

1. When [Inbox AI](/docs/inbox/inbox-ai) is on **Suggest replies**, a draft card sits in the thread.
2. Edit the wording, then send — or choose **Not now** / **I'll handle it myself**. Sending or approving one draft dismisses leftover suggestion cards. Older dismissed drafts collapse to one line (**Earlier draft — dismissed**).
3. **Draft with AI** in the composer asks for a one-off draft without waiting for inbound mail. Optional guidance steers the tone. If no agent is assigned, the error offers **Open Agents**.
4. **Take over from AI** pauses the assistant on that thread so you can finish by hand. **Hand back to AI** resumes it. On **Reply automatically**, take over is how you stop a live send. In website chat the visitor sees a "team member is handling this" banner appear on takeover and disappear again on handback or close.

## Decide in the thread

![Decision card in a thread](/api/docs/assets/communication/decision-card.png)
*Decision cards appear in the timeline.*

1. A decision card appears when an agent needs your judgment.
2. Read the proposal. Approve, edit or decline.
3. Nothing customer-facing goes out until you answer, unless autonomy allows it. See [Decisions](/docs/ai/decisions).

## What to do next

Connect a mailbox under [Channels](/docs/inbox/channels). Open [Contacts](/docs/inbox/contacts) to see who is writing in.

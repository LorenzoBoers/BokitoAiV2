---
title: How Communication works
intro: The hub for every conversation — customers and agents in one place.
description: Work customer email, chat and internal threads from Communication, including compose, notes, snooze and saved replies.
keywords: inbox, communication, messages, threads, email, chat, compose, snooze, saved replies
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions,cases
---

# How Communication works

Communication is where the day happens. Customer mail, website chat, chats with company agents, and internal agent-run threads share one hub. Agent chats keep their own **Agents** folder in the sidebar, but they use the same queues and actions as the rest of Communication. Open it when something needs a reply or a decision. While an agent works, the thread shows live purple status lines — a bubble appears only when the agent writes a reply or asks for a decision.

## Work the Open queue

Open is conversation work that still needs you — customer channels and agent chats. Background agent runs stay under **Activity**.

![Open queue in Communication](/api/docs/assets/communication/open-queue.png)
*Open lists conversation work that still needs you, including agent chats.*

1. Open **Communication**. At the top, **All communication** is a folder: click it to expand **Open**, **Mine**, **Unassigned** and **Closed** (plus **Snoozed** and **Spam**). That list includes chats with company agents alongside customer mail and website chat. Directly below sits **Decisions** — the folder for every conversation with an open approval card (customer, agent chat, and internal). Overview, the bell, and deep links land there. **Contacts** and **Settings** sit pinned at the bottom. The first expand opens the default sub-view from **Settings** → **Channels** (Folders) — usually **Open**, or **Mine** if you set that.
2. Switch to **Mine** for threads assigned to you, or **Unassigned** for work with no owner yet. Open **Decisions** when you only want yes/no cards.
3. Scan the list. Each row shows the last real message, prefixed with **You:** when you sent it. A follow-up from the same website visitor stays in that Open thread. Use the search field at the top of the list, then open **Filters** for **Your turn**, **Unread** or **Pinned** — they apply on top of Open, Mine or any other queue. Filters do not stick across folders. A **Needs decision** badge marks rows with an open card. Press **?** for inbox shortcuts: **J**/**K** move, **]**/**[** jump unread, **E** closes (Undo in the toast), **H** snoozes one hour, **Shift+H** picks a time, **X** selects, **Shift-click** selects a range, **Cmd+A** selects loaded rows, **U** marks unread, **Shift+U** marks all loaded read when nothing is selected, **A** assigns to you, **Shift+A** opens the assignee list, **P** pins, **R** focuses the reply, **C** composes, **N** starts a new chat, **L** copies the link, **#** copies the thread id, **/** searches, **Esc** returns to the list (it does not leave the thread while a menu is open). Assistant chats use the same move, pin, unread, reply and search keys.
4. The **Channels** section lists only channels you have configured: each mailbox or Bokito address, **Website chat** when the widget channel is on, and WhatsApp after you connect it. When nothing is connected yet, **Add a channel** sits at the top of that list. Every channel is a folder with the same sub-views: **Open**, **Mine**, **Unassigned** and **Closed** — and each folder lists only threads from that channel (Website chat never mixes in mailbox mail). Sub-views stay hidden until you click the channel — that expands the list and opens the default sub-view; click again to collapse. Only one folder stays expanded at a time. Change the default (globally or per channel) under **Settings**, then **Channels** (Folders). The **Agents** section (company agents you may chat with) uses the same folder pattern. Classification uses Signals, not tags: review them under **This conversation** and manage their catalog under **Settings** → **Signal types**. See [How Signals work](/docs/ai/cases).
5. Pin what matters, choose **Assign** or **Assign to me**, or **Snooze** (toolbar clock). Presets are **1 hour**, **4 hours**, **Tomorrow 9:00**, **Next Monday 9:00**, **Until the customer replies**, or **Choose date and time**. After a reply, the arrow next to **Send** offers **Send and close** and **Send and snooze** to finish in one step. **Mark loaded as read** clears unread on the conversations already in the list.
6. Select several rows for bulk **Read**, **Close**, **Pin**, **Mark as spam**, **Assign to me**, **Assign**, **Reopen**, **Mark unread** or **Snooze until tomorrow 9:00**. Shift-click a checkbox to take the range from the last selected row. Row actions (close, snooze, assign) live on the row menu and the thread toolbar. **More** holds Snoozed, Closed and Spam. The command palette also jumps to Closed, Spam, Activity, New chat, Your turn and Decisions, and can open a conversation or run by ID.

Snoozed threads sit under **Snoozed** until the timer fires or the customer writes again. Opening one from Snoozed returns you to Open. A closed conversation reopens on its own when the customer replies in the same email thread, so a late "thanks, one more thing" lands back in Open instead of starting a new conversation.

## Start a new chat or email

1. Choose **New chat**. You see three large choices: **Contact**, **Agent**, and **Teammate**. Nothing is created until you send — this is a draft in Communication.
2. **Contact** (or **Teammate**): pick **To**, choose **From** (a connected mailbox; you can switch before send and optionally **Remember as default**), add a subject, write the message, then send. Hover **+** on a mailbox in the sidebar to start with that From already set. Typing a new address is fine; a contact is not required first.
3. **Agent**: pick a company agent (or use **+** on an agent row), type, and send. That creates the chat thread. If no agents are available, the page says so.
4. You can also start mail from a contact card or the command palette. Forward from a thread still opens the compose dialog.
5. An empty inbox still offers **New chat**, **Install widget**, and the setup guide — website chat does not wait for email.

## Choose what you send (Reply / Ask AI / Note)

![Composer modes in Communication](/api/docs/assets/communication/composer-modes.png)
*One composer with three destinations: the customer, the AI, or the team.*

1. Open a conversation. Under the timeline the composer shows a mode chip: **Reply to {name}**, **Ask {agent}**, and **Note**.
2. **Reply** goes to the customer on the same channel they used. Placeholder text reminds you they will see it. On email, **Ctrl+Enter** sends; on chat, Enter sends.
3. **Ask** talks only with the AI on this conversation (or starts an AI check-in). The customer sees nothing. A **Stop** control appears while the AI streams.
4. **Note** is team-only. Use it for handoffs and context that must not leave the workspace.
5. On an AI chat (`assistant` channel) or an AI check-in, Reply is hidden — only Ask and Note stay. Slash verbs and `@` mentions still work.

## See and change what the AI does

![AI handling picker in the thread header](/api/docs/assets/communication/handling-picker.png)
*The header shows the AI handling mode and which layer it follows.*

1. Open a customer conversation. The header shows the **AI handling** mode with its icon: **Autonomous** or **Assisted** (purple), or **Manual** (gray). The menu says where it comes from, for example **Follows the channel**.
2. Pick another mode to set it for this conversation only, until it closes. Choose **Follow the channel** (or the contact or workspace) to remove it again. Only an owner or admin can raise a conversation to Autonomous.
3. Choose **Take over** to set Manual and assign the conversation to you. **Hand back to AI** returns it to the inherited mode. Replying yourself on an autonomous conversation also takes it over.
4. In the composer, type `/manual`, `/assisted` or `/autonomous` (or `/handmatig`, `/geassisteerd`, `/autonoom`), optionally followed by a reason.
5. Every change appears in the timeline, for example **AI handling set to Assisted**. Rows in the list show the mode icon when a conversation or contact differs from its channel. See [AI handling](/docs/inbox/inbox-ai).
6. Live work appears as a thin strip under the timeline while the AI thinks or streams — the same place for customer replies and Ask turns.

## Approve an AI proposal from the composer

1. When the AI suggests a reply, the draft loads into the composer with **Send**, **Edit**, and **Dismiss**. The timeline only shows a short line: **AI proposed a reply**.
2. Edit the text if needed, then **Send** (or use the send menu for close / snooze). Sending resolves the decision and delivers the reply.
3. **Dismiss** rejects the proposal without sending. Other decisions (platform, module, agenda, checkout) stay as cards titled **Waiting for your OK** with plain verb buttons — no tool names in the copy.

## Decide in the thread

![Decision card in a thread](/api/docs/assets/communication/decision-card.png)
*Decision cards appear in the timeline as chat bubbles.*

1. A decision bubble appears when an agent needs your judgment.
2. Read the proposal. When the card offers several concrete choices, each button keeps its own label (for example send vs cancel vs ask the customer). Approve, edit or decline. **Later** / **Not now** parks the conversation until tomorrow 9:00 so it leaves Open. The single **I'll handle it myself** button sets the conversation to Manual and assigns you.
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

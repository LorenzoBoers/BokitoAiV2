---
title: How Communication works
intro: The hub for every conversation — customers and agents in one place.
description: Work customer email, chat and internal threads from Communication, including compose, notes, snooze and saved replies.
keywords: inbox, communication, messages, threads, email, chat, compose, snooze, saved replies
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions,categories
---

# How Communication works

Communication is where the day happens. Customer mail, website chat, chats with company agents, and internal agent-run threads share one hub. The Bokito helper in the corner is not part of this list — those chats stay in that widget. Agent chats keep their own **Agents** folder in the sidebar, but they use the same queues and actions as the rest of Communication. Open it when something needs a reply or a decision. An agent answers in short chat messages, with a compact line between them that shows what it did.

## See when send or tips need you

1. Open **Communication**. When no mailbox or chat channel is ready to send, a banner links to **Channels**.
2. When automated-mail tip cards wait, a banner shows the count with **Review** (opens decisions) and **Dismiss all**.
3. List rows show the AI category when there is no ticket yet, and a certainty percentage from 80% upward.

## Work the Open queue

Open is conversation work that still needs you — customer channels and agent chats. Background agent runs stay under **Activity**.

![Open queue in Communication](/api/docs/assets/communication/open-queue.png)
*Open lists conversation work that still needs you, including agent chats.*

1. Open **Communication**. You land on **For you** by default (the rail and start page use that queue unless you last left another). The help icon next to the title in the top bar opens the guide. **New conversation** sits at the top of the inner rail, left of the sidebar layout control. **All communication** is a folder: click it to expand **For you**, **Open**, **Unassigned** and **Closed** (plus **Spam**). That list includes chats with company agents alongside customer mail and website chat. Below it sit the **Teams**, **Channels**, **Chat with agents**, **Tags** and **Projects** sections (you can reorder or hide them). **Contacts** and **Settings** sit pinned at the bottom. Expanding a folder opens the default sub-view from **Settings** → **Channels** (Communication rail) — usually **For you**.
2. Stay on **For you** for your work: conversations you own, conversations where it is your turn or your team's turn, questions to everyone, mentions, and open decision cards. The bell badge mirrors this list and opens **For you** from the top. Rows where you must act now sort first. **Unassigned** holds conversations a team owns that nobody picked up yet. Teams shown in the sidebar get their own folder under **Teams** (see [Team](/docs/getting-started/team)); **Group chat** in that folder opens the team's standing internal conversation.
3. Scan the list. Each row shows the last real message, prefixed with **You:** when you sent it and **AI:** when an agent did. Next to **Filters**, the list-layout control switches **Compact list** and **Comfortable list**. Compact keeps assignee, ticket and hashtags on a bottom row that only appears when you hover, focus or select a conversation; Comfortable keeps that row visible. A follow-up from the same website visitor stays in that Open thread. Opening a conversation lands at the latest messages. A new inbound email opens at the start of that mail, not the signature. Use the search field at the top of the list, then open **Filters** for **Your turn**, **Unread** or **Pinned** — they apply on top of For you, Open or any other queue. Filters do not stick across folders. A **Needs decision** badge marks rows with an open card. Press **?** for inbox shortcuts: **J**/**K** move, **]**/**[** jump unread, **E** closes (Undo in the toast), **X** selects, **Shift-click** selects a range, **Cmd+A** selects loaded rows, **U** marks unread, **Shift+U** marks all loaded read when nothing is selected, **A** assigns to you, **Shift+A** opens the assignee list, **P** pins, **R** focuses the reply, **C** composes a new email, **N** starts a new conversation, **L** copies the link, **#** copies the thread id, **/** searches, **Esc** returns to the list (it does not leave the thread while a menu is open). Assistant chats use the same move, pin, unread, reply and search keys.
4. The **Channels** section lists only channels you have configured: each mailbox or Bokito address, **Website chat** when the widget channel is on, and WhatsApp after you connect it. When nothing is connected yet, **Add a channel** sits at the top of that list. Every channel is a folder with the same sub-views: **For you**, **Open**, **Unassigned** and **Closed** — and each folder lists only threads from that channel (Website chat never mixes in mailbox mail). Sub-views stay hidden until you click the channel — that expands the list and opens the default sub-view; click again to collapse. Only one folder stays expanded at a time. Change the default (globally or per row) under **Settings**, then **Channels** (Tags and Communication). The **Chat with agents** section (company agents you may chat with) uses the same folder pattern, plus an **Activity** row that opens that agent's work log. A conversation can carry one action tag, which makes it a ticket, shown under **Ticket** and as a chip on the list row; see [Action tags and tickets](/docs/ai/categories).
5. Pin what matters, choose **Assign** or **Assign to me**, or **What next** to plan a task on [Agenda](/docs/ai/agenda) without hiding the thread from Open. After a reply, the arrow next to **Send** offers **Send and close**. **Close** (or **Send and close**) removes the conversation from the folder you are in and opens the next one — it does not jump you to **Closed**. **Mark loaded as read** clears unread on the conversations already in the list. To come back later, mark the conversation unread or plan a task — there is no separate snooze park.
6. Select several rows for bulk actions that fit the folder you are in. In **Open**, **For you** or **Unassigned** you get **Close**; in **Closed** you get **Reopen** instead; in **Spam** you get **Not spam**. **Read**, **Pin**, **Assign**, **Mark as spam** (outside Spam), **Mark unread** and **Move to Bin** stay under the bar or **More actions** (Bin asks twice). On the **Pinned** filter the bar offers **Unpin**; on **Unread** it hides **Mark unread**. Shift-click a checkbox to take the range from the last selected row. Row actions (close or reopen, assign) live on the row menu and the thread toolbar. **Spam** sits under All communication with Closed. Restore from **Settings** → **Bin**. The command palette also jumps to Closed, Spam, Activity, New conversation, Your turn and Decisions, and can open a conversation or run by ID.

A closed conversation reopens on its own when the customer replies in the same email thread, so a late "thanks, one more thing" lands back in Open instead of starting a new conversation.

## Hand a conversation to a person, agent or team

Every conversation has one owner: a person, an agent or a team. Without one it belongs to the channel's owner team, else to All people.

1. Choose **Assign to me** in the assignee menu on a team-owned conversation to make it yours. **Take over** in **AI handling** does the same and sets Manual. Replying or adding a note also assigns you. It leaves **Unassigned** and the **For you** of the rest of the team. **Unassigned** in that menu clears a person or agent owner back to the channel's owner team (or All people).
2. Choose **Assign** to open the picker with **People**, **Agents** and **Teams**. Each person, agent and team shows a corner status: green/amber/gray for people, purple when an agent is available or pulsing purple when it is working; teams roll that up from their members (a person available wins; otherwise a working agent, then away, then an available agent). Someone without Handle access on the channel shows **No access to this channel** and cannot be picked. The list and header use the same mark for the current owner.
3. Picking an agent or a team asks for an optional message. An agent starts right away and answers as an internal note. A team picks the conversation up the way it is set to (see [Team](/docs/getting-started/team)).
4. In a note, type `@` to mention a person, an agent or a team. Mentioning an agent switches the composer to **Ask {agent}**; the meta conversation starts when you send. Mentioning a team notifies its people, or lets its agent answer first when the team is set to **Agent first**.

A person owner holds the conversation: agents only draft. Handing it to an agent or a team returns the conversation to its AI handling.

## Start a new conversation

1. Choose **New conversation** at the top of the inner rail (left of the sidebar layout control). You see **Email**, **Ticket**, and **Agent**. **WhatsApp** appears once a WhatsApp number can send. Who you email (a customer, a teammate, or a typed address) is chosen in the composer, not as a separate type. A mail or WhatsApp conversation is created only when you send. An unsent mail shows up as a **Mail draft** chip above the choices: **Continue writing** reopens it, the cross discards it.
2. **Email**: the draft is the same mail composer used for replies. Pick **To** — typing shows matching contacts and teammates, on **CC** and **BCC** too; arrow keys and Enter pick a suggestion. An entry that is not an email address is flagged under the fields and blocks sending. Open **CC/BCC** when needed, set the subject and write above your signature. **From** sits in the composer header when more than one mailbox can send; the mailbox you send from is remembered for next time. Attachments, dictation and **Ctrl+Enter** work as in a reply, and the draft autosaves until you send. Hover **+** on a mailbox in the sidebar to start with that From already set. Typing a new address is fine; a contact is not required first.
3. **WhatsApp**: enter the number and the message. The message joins the existing conversation for that number, or starts one. **Ticket**: pick an action tag (`#name` on a flow), a project when that flow sits on projects (or **No project**), a subject, and an optional note. **Log ticket** opens the internal conversation immediately, already filed on that action tag. **Agent**: pick a company agent (or use **+** on an agent row), type, and send. That creates the chat and places your text as the first bubble. The list title stays a placeholder until that first send, then becomes a short label from the intent — not the full message.
4. You can also start mail from a contact card or the command palette. Forward from a thread still opens the compose dialog.
5. An empty inbox still offers **New conversation**, **Install widget**, and the setup guide — website chat does not wait for email.

## Choose what you send (Reply / Ask AI / Note)

![Composer modes in Communication](/api/docs/assets/communication/composer-modes.png)
*One composer with three destinations: the customer, the AI, or the team.*

1. Open a conversation. Under the timeline the composer shows a mode chip: **Reply to {name}**, **Ask {agent}**, and **Note**.
2. **Reply** goes to the customer on the same channel they used. Placeholder text reminds you they will see it. On chat, Enter sends. On an email conversation the composer starts on **Reply** when the last message is from the customer and no decision is open. It stays on **Ask** when a decision is open or the last message was already yours, and on **Note** for an address that cannot receive mail. The Reply chip opens the mail composer — on the newest customer mail, or without quoted history on a conversation you started yourself. See the next section.
3. **Ask** talks only with the AI on this conversation (or starts an AI check-in). The customer sees nothing. The composer outline turns purple. Switching to Ask or mentioning an agent does not open a meta conversation until you send. **Cancel** on an empty meta conversation removes it. A **Stop** control appears while the AI streams. Paste a screenshot or image into the composer (or use the paperclip) so the AI can see it on that turn.
4. **Note** is team-only. The composer outline is gray. Use it for handoffs and context that must not leave the workspace.
5. On an AI chat (`assistant` channel) or an AI check-in, Reply is hidden — only Ask and Note stay, with **Note** after **Ask**. Slash verbs and `@` mentions still work.

## Read an email thread

Chat messages are bubbles; an email is a document, so it renders as a mail card on neutral paper. Who sent it shows in the envelope band on top and in the side the card hangs on, the same way chat bubbles do.

![An inbound mail card and an AI mail card in an email conversation](/api/docs/assets/communication/mail-card.png)
*Every mail is a card: the envelope band names the sender and recipients, the body is the mail as it was sent.*

1. Open an email conversation. Received mail hangs left with the contact avatar; mail you sent hangs right with a green band; mail an agent sent carries an **AI** chip and a purple band. The body always sits on white, so signatures, quotes and images look as they did in the mail client.
2. The band reads **Sender · to you, +1**. Click it to show **From**, **To**, **CC** and **BCC** in full; click again to fold them away. The time sits on the right, with a check once the mail went out.
3. Older mail folds to its band with the first line of the body. The newest mail and the newest received mail stay open. Click a folded band to open that mail.
4. Hover a card for its actions: **Reply**, **Reply all** and **Forward** on received mail; **Forward** and **Copy text** on mail sent by you, a colleague or an agent.

## Reply, reply all or forward an email

Email conversations answer like a mail client: every received mail carries its own reply buttons, and the composer grows into a full mail view when you use them.

![Mail composer opened from a Reply card action](/api/docs/assets/communication/mail-reply.png)
*Reply on a mail card grows the composer into a mail view: recipients, subject, signature and quoted history.*

1. Open an email conversation. On a received mail, hover the card and choose **Reply** (left arrow), **Reply all** (double arrow — shown only when more people were on the mail) or **Forward** (right arrow) in its action row.
2. The composer at the bottom grows into a mail view, with a mini thread view above it. **To** is prefilled from the mail you clicked (empty on a forward), **CC/BCC** opens extra recipient fields, and the subject is editable — `Re:` or `Fwd:` is set for you. **From** switches mailboxes when more than one can send.
3. Write your message. Clicking into a ready draft in the small composer opens this mail view with that text. Your signature sits in the letter under your text, fully visible, the way it will be sent. The three dots expand the quoted mail history in that same scroll. AI write help, dictation and the attachment button stay available.
4. Send with the button or **Ctrl+Enter**. The mail lands in the timeline as a mail card on the right with only your message, and the composer returns to its normal size. A short toast offers **Undo**; choosing it keeps the mail from going out and puts your text back as a mail draft.
5. **Esc** or the **X** in the corner closes the mail view without sending. Your draft is saved automatically — a **Mail draft** chip above the composer offers **Continue writing** or discards it with the bin icon. The draft survives thread switches and reloads; sending clears it.

## See and change what the AI does

![AI handling picker in the thread header](/api/docs/assets/communication/handling-picker.png)
*The header shows the AI handling mode and which layer it follows.*

1. Open a customer conversation. The header shows the **AI handling** mode with its icon: **Autonomous** or **Assisted** (purple), or **Manual** (gray). In the menu, the inherited mode carries a badge that says where it comes from, for example **Channel default**.
2. Pick another mode to set it for this conversation only, until it closes. The mode you would otherwise follow carries a badge such as **Channel default** or **Contact default**; choose it to remove the override again. Only an owner or admin can raise a conversation to Autonomous.
3. Choose **Take over** to set Manual and assign the conversation to you. **Hand back to AI** returns it to the inherited mode. Replying yourself on an autonomous conversation also takes it over.
4. In the composer, type `/manual`, `/assisted` or `/autonomous` (or `/handmatig`, `/geassisteerd`, `/autonoom`), optionally followed by a reason.
5. Every change appears in the timeline, for example **AI handling set to Assisted**. Actions within five minutes share one row (the same window as stacked chat bubbles); a later burst gets its own row with the clock time. Hover a pill for the exact moment. Rows in the list show the mode icon when a conversation or contact differs from its channel. When the customer asked for a person, the row shows **Asked for a person**, the thread shows a banner, and the conversation sorts first. It also appears in **For you**, even when it sits with All people. See [AI handling](/docs/inbox/inbox-ai).
6. Live work appears at the bottom of the timeline while the AI thinks or writes — the same place for customer replies and Ask turns. See the next section.

## Follow what an agent does

An agent turn reads like a chat: a few short messages, with one line between them for the work in between.

![Agent turn with activity lines between chat messages](/api/docs/assets/communication/agent-turn.png)
*Thinking and working lines sit between the agent's messages and fold up when done.*

1. While the agent thinks, a line with a brain icon reads **Thinking** with a running time. When the model shares its reasoning, click the line to read it as it streams. Short messages skip reasoning. While it works, the line shows the current action with the integration logo (or a knowledge or wrench icon); each new action replaces the previous one. A web search reads **Searching for …** with the site favicon when results arrive.
2. When the agent switches from thinking to working (or back), the line folds into **Thought for 3s** or **Worked for 12s · 4 actions**. Click it to see each action, its input and its result. **Thought for** only shows when there is reasoning to read.
3. **Typing...** means the agent is writing its next message. A blank line in its answer starts a new message, so a turn arrives as up to five short bubbles. Email stays one structured message.
4. Agent messages use chat formatting only: bold, italic, strikethrough and links. Headings and tables become plain lines.
5. Under an agent message, **Sent to the customer** or **Not delivered** shows only on customer channels (email, WhatsApp, website chat). Chats with agents and internal threads never show a delivery label.

## Review an AI-suggested reply

1. When the channel agent suggests a reply, the draft appears in the composer. The text glows purple for a couple of seconds so you can see it was generated. The timeline shows that action next to that agent's avatar: **Suggested a reply**. The first line of the timeline is **Conversation started by {name}**.
2. Edit the text if needed, then **Send** (or use the send menu for close / snooze). Sending resolves the decision and delivers the reply. An edited send is kept as an example: the next similar reply starts from that wording.
3. **Discard** on the restored-draft bar rejects the proposal without sending. Other decisions (platform, module, agenda, checkout) stay as cards titled **Waiting for your OK** with plain verb buttons — no tool names in the copy.

## Handle an outdated draft

A draft answers one customer message. When the customer writes again, a colleague replies from their own mailbox, or the same person continues on another channel, the old draft no longer fits.

![Outdated draft notice above the composer](/api/docs/assets/communication/stale-draft.png)
*The composer flags a draft written for an earlier message and offers a fresh proposal.*

1. Open the conversation. Above the composer a notice reads **Outdated draft** with the reason: the customer wrote again after this draft. The timeline line of the old proposal reads **Set aside: customer wrote again**, **Set aside: a teammate replied** or **Set aside: a newer conversation with this person**.
2. Choose **Propose again** to let the AI draft a reply to the latest message, or **Discard** to clear the text and start from scratch. A draft you never touched is not stored, so an unchanged AI proposal disappears on its own when it is set aside.
3. When the customer also wrote on another channel, a line above the composer reads **{name} also wrote 2 hours ago via WhatsApp** with **Open**. Each channel keeps its own conversation; the line tells you where the live thread is, and the AI keeps one proposal per person on the newest conversation.
4. The side panel lists **Other conversations** with this person, open ones first, each with its channel icon and **Proposal open** when an AI proposal waits there.
5. Closing a conversation or marking it as spam drops its unsent draft.

## Already handled outside Bokito

You called the customer, answered from a personal WhatsApp or settled it from another mailbox. Log it so the conversation stops asking for a reply.

1. Open the conversation. Choose **Already handled outside Bokito** in the arrow menu next to **Send** (it works with an empty composer), or open **What next** in the thread menu and pick **Handled elsewhere**.
2. Pick where it was handled: **Phone**, **WhatsApp**, **Other mailbox** or **Elsewhere**. Add what was agreed in one line if you like.
3. Keep **Also close the conversation** on to close it in the same step, or turn it off to leave it in Open with you as owner.
4. Choose **Log as handled**. The timeline shows **Handled by phone by {name}** with your note, the conversation is marked read, open AI proposals are set aside with reason **handled outside Bokito**, and the thread leaves **Your turn**.
5. A colleague's reply sent from their own Gmail or Outlook mailbox is logged on its own when that mailbox is connected; see [Channels](/docs/inbox/channels). Agents can log the same thing with the governed tool `mark_handled_externally`.

## Decide in the thread

![Decision card in a thread](/api/docs/assets/communication/decision-card.png)
*Decision cards appear in the timeline as chat bubbles.*

1. A decision bubble appears when an agent needs your judgment.
2. Read the proposal. When the card offers several concrete choices, each button keeps its own label (for example send vs cancel vs ask the customer). Approve, edit or decline. **Later** / **Not now** keeps the conversation in Open and marks it unread. The single **I'll handle it myself** button sets the conversation to Manual and assigns you.
3. Nothing customer-facing goes out until you answer, unless autonomy allows it. Approving **What next** (or the old Create task choice) plans a task on this conversation — a title and when — and shows it on [Agenda](/docs/ai/agenda). From the thread menu choose **What next** to plan a task or file a ticket. Choose **Add to project** in the same menu to link the thread to a project. See [Decisions](/docs/ai/decisions).

## Link a visitor to a contact

1. Open a website-chat thread. The header can show **+N earlier** when this person already wrote before — that opens the contact panel.
2. In the contact panel, choose **+ Contact**, type their email or phone number (and a name if you have one), then **Link**. Bokito links the chat to the existing contact with that address, or creates one. See [Link a conversation to a contact](/docs/inbox/contacts).
3. Unknown visitors show **Unknown chatter**. A saved person shows **Contact**. Mail from a workspace member shows **Teammate** instead (no Approve) — they are not treated as a customer contact. An unmatched sender has one **Contact** action in the side panel, plus **Mark as spam** (or **Not spam** when it already is). There is no second add-contact button, Mail, or Open contacts there. To block someone, use the thread menu (⋯) or the contact page. Unsaved contact notes stay highlighted until you save, and leaving the page asks you to confirm.

## Tag a conversation and file a ticket

1. Open a customer conversation. The side panel **This conversation** shows the AI summary when the channel agent has read the thread, then priority, look-again, tags and the ticket. Choose **Add tags** for free tags and action tags (action tags start a ticket flow); see [Action tags and tickets](/docs/ai/categories). On a closed conversation, the ⋯ menu offers **Use as example** so the next similar reply can learn from it.
2. Type with a soft `#`. Pick a free tag or an action tag (label **Action tag**). An unknown name asks whether to add it as a tag or **Make action tag**. When the flow has projects, pick one or **No project**.
3. The action-tag chip is locked on the conversation. Change it by replacing in the picker, or **Split** when a second request needs its own ticket. Free tags show a muted `#` and an **x** to remove.
4. Manage the list under **Settings** → **# Tags**: rename a tag, add a description agents read, pin a free tag to Communication, choose **Create flow** / **Open flow**, or delete it from every conversation.
5. To tag automatically, add an automation rule with the action **Add tags** under **Settings** → **Channels**. The rule tags matching conversations and the normal flow continues; the timeline shows a line such as **Tagged billing by rule**.
6. When a second request shows up in the same thread, choose **Split from here** on the message where it starts, so each conversation keeps one ticket.

## Find work by tag or project

Pinned free tags, action tags, and projects each get a row in the sidebar with their count of open conversations.

![Tags in the Communication sidebar](/api/docs/assets/communication/hashtags.png)
*Action tags, a pinned free tag, and a project, each with its open count.*

1. Under **Tags**, click a row to see the conversations with that tag. It expands into the same sub-views as a channel: **For you**, **Open**, **Unassigned** and **Closed**.
2. Under **Projects**, click a project to see the conversations filed on it.
3. Pin any tag with the pin under **Settings** → **# Tags** (free tags and action tags).
4. Choose which sub-view each row opens on under **Settings** → **Channels** → **Tags and Communication**.

## What to do next

Connect a mailbox under [Channels](/docs/inbox/channels). Open [Contacts](/docs/inbox/contacts) to see who is writing in.

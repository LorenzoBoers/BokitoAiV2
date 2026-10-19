---
title: How Communication works
intro: The hub for every conversation — customers and agents in one place.
description: Work customer email, chat and internal threads from Communication, including compose, notes and planning.
keywords: inbox, communication, messages, threads, email, chat, compose, plan, agenda item
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions,categories
---

# How Communication works

Communication is where the day happens. Customer mail, website chat, chats with company agents, and internal agent-run threads share one hub. The Bokito helper in the corner is not part of this list — those chats stay in that widget. Agent chats keep their own **Agents** folder in the sidebar, but they use the same queues and actions as the rest of Communication. Open it when something needs a reply or a decision. An agent answers in short chat messages, with a compact line between them that shows what it did. Click a face in the thread to open that agent, contact, or person.

## See when send needs you

1. Open **Communication**. When no mailbox or chat channel is ready to send, a banner links to **Channels**.
2. List rows show the AI category when there is no ticket yet, and a certainty percentage from 80% upward.

## Work the Open queue

Open is every open conversation, whether someone owns it or not. Background agent runs stay on the **Activity** swimlane under [Agents](/docs/ai/agents).

![Open queue in Communication](/api/docs/assets/communication/open-queue.png)
*Open lists every open conversation, including agent chats.*

1. Open **Communication**. You land on **Assigned to me** by default (the rail and start page use that queue unless you last left another). The help icon next to the title in the top bar opens the guide. **New conversation** sits at the top of the inner rail, left of the sidebar layout control. **All communication** is a folder: click it to expand **Assigned to me**, **Open** and **Unassigned** (plus **Scheduled** and **Spam**). That list includes chats with company agents alongside customer mail and website chat. Below it sit the **Folders**, **Flows**, **Channels**, **Chat with agents** and **Departments** sections — drag a section header to reorder, or use the layout control to reorder and hide. **Contacts** and **Settings** sit pinned at the bottom. A folder, channel, agent chat or flow has no Open or Closed child. Click the row and the list shows its open conversations.
2. Stay on **Assigned to me** for your work: conversations assigned to you, a question or draft addressed to you, and unread mentions. The badge counts only what you must do now; conversations you already answered stay in the list and do not count. The bell badge mirrors this count and opens **Assigned to me** from the top. An empty **Assigned to me** with no channel connected shows the channel marks and **Connect your first channel**, plus **Start a conversation** for work with colleagues and agents. The warning that no channel is ready to send appears only when the list already has conversations. Rows where you must act now sort first. The assignee chip is hidden when you are the owner. **Unassigned** holds conversations a team owns that nobody picked up yet, and those do not also sit in **Assigned to me**. Every custom department gets a folder under **Departments** (see [Team](/docs/getting-started/team)) that opens its open work, with **Unassigned** as the only child.
3. Scan the list. Each row shows the last real message, prefixed with **You:** when you sent it and **AI:** when an agent did. Next to **Filters**, the list-layout control switches **Compact list** and **Comfortable list**. Compact keeps assignee, ticket and hashtags on a bottom row that only appears when you hover, focus or select a conversation; Comfortable keeps that row visible. A follow-up from the same website visitor stays in that Open thread. Opening a conversation lands at the latest messages. A new inbound email opens at the start of that mail, not the signature. Use the search field at the top of the list. Matches in the current queue and filters stay at the top. Other matches sit under **Outside current filters**, dimmed, and still open when you select them. Then open **Filters** for **Unread** or **Pinned**, and under **Narrow by** choose assignee, priority or date (today, last 7 / 30 / 90 days on last activity). They apply on top of Assigned to me, Open or any other queue. Filters do not stick across folders. A **Needs decision** badge marks rows with an open card. Press **?** for inbox shortcuts: **J**/**K** move, **]**/**[** jump unread, **E** closes (Undo in the toast), **X** selects, **Shift-click** selects a range, **Cmd+A** selects loaded rows, **U** marks unread, **Shift+U** marks all loaded read when nothing is selected, **A** assigns to you, **Shift+A** opens the assignee list, **P** pins, **R** focuses the reply, **C** composes a new email, **N** starts a new conversation, **L** copies the link, **#** copies the thread id, **/** searches, **Esc** returns to the list (it does not leave the thread while a menu is open). Assistant chats use the same move, pin, unread, reply and search keys.
4. The **Channels** section lists only channels you have configured: each mailbox or Bokito address, **Website chat** when the widget channel is on, and WhatsApp after you connect it. When nothing is connected yet, **Add a channel** sits at the top of that list. Each mailbox shows its provider logo (Outlook, Gmail, SMTP or Bokito). Click a channel, agent or flow to see its open conversations (Website chat never mixes in mailbox mail). The list groups them under **Open conversations**. **Show closed** sits centered at the bottom, with the count, and opens the **Closed** group. When every conversation is closed, **Closed** is already open. An agent with no open or closed conversations opens **New conversation** with that agent as the recipient. The number on the sidebar row stays the open count. The Activity timeline lives on [Agents](/docs/ai/agents). A conversation can carry one label, which makes it a ticket, shown under **Ticket** and as a chip on the list row; see [Labels and tickets](/docs/ai/categories).
5. Pin what matters, choose **Assign** or **Assign to me**, or **Plan** to give it a date on [Agenda](/docs/ai/agenda) without hiding the thread from Open. After a reply, the arrow next to **Send** offers **Send and close**. Under **Settings**, then **Profile & security**, **Close email when I send** makes **Send** close email conversations for you; the menu then offers **Send and keep open**. Chat and WhatsApp stay as they are. **Close** (or **Send and close**) removes the conversation from the folder you are in and opens the next one — it does not jump you to **Closed**. **Mark loaded as read** clears unread on the conversations already in the list. To come back later, mark the conversation unread or plan it — it stays in Open and shows under **Scheduled** too.
6. Select several rows for bulk actions that fit the folder you are in. In **Open**, **Assigned to me** or **Unassigned** you get **Close**; in **Spam** you get **Not spam**. **Read**, **Pin**, **Assign**, **Mark as spam** (outside Spam), **Mark unread** and **Move to Bin** stay under the bar or **More actions** (Bin asks twice). On the **Pinned** filter the bar offers **Unpin**; on **Unread** it hides **Mark unread**. Shift-click a checkbox to take the range from the last selected row. Row actions (mark read or unread, pin, move to Bin) live on the row menu — the … button or a right-click on the row — and close or reopen sits on the row and the thread toolbar. **Spam** sits under All communication. Deleting a conversation moves it to the Bin; the toast offers **Undo** (or press Ctrl+Z) and you can still restore later from **Settings** → **Bin**. The command palette also jumps to Spam, Agents activity, New conversation, Assigned to me and Decisions, and can open a conversation or run by ID.

A closed conversation stays writable. Sending a reply reopens it and moves it back to Open. A customer reply in the same email thread does the same, so a late "thanks, one more thing" lands in Open instead of starting a new conversation. Spam still asks you to reopen first.

## Plan a conversation

A conversation with a date is an agenda item; with a repeat it is a recurring task. You plan it from the conversation itself and it shows on [Agenda](/docs/ai/agenda).

1. Open the conversation and choose **Plan** in the thread menu (or the **Plan** chip in the side panel).
2. Pick **One moment** or **Repeat** (for example **Every weekday** at 09:00), choose **For whom**, and optionally an **Agent** with a **Task for the agent**. Choose **Save**.
3. The row in the list shows the date. At that moment the conversation comes back unread for whoever you chose, or the agent writes in this same conversation, so every run stays in one history.
4. The side panel shows the next moment and the last run. Click that card to open the plan: change the date, or choose **Run now**, **Pause**, **Stop repeat** or **Clear date**. **Scheduled** under All communication lists every conversation with a date or repeat.
5. Start a fresh one from **New conversation** with **Agenda item**, or ask an agent: "send me an overview of open quotes every Monday".

## Hand a conversation to a person, agent or team

Every conversation has one owner: a person, an agent or a team. On an **Autonomous** channel the agent owns new conversations and answers them itself; on **Assisted** it picks them up, prepares a draft and then hands the conversation to the last person who handled it, else the contact's owner, else the channel's owner team. When the AI is on Manual, a new conversation goes straight to the contact's owner, else the owner team, else All people. The agent's avatar in the header marks an agent owner.

1. Choose **Assign to me** in the assignee menu on a team-owned conversation to make it yours. **Take over** in **AI handling** does the same and sets Manual. Adding a note also assigns you. It leaves **Unassigned** and shows up in your **Assigned to me**. **Unassigned** in that menu clears a person or agent owner back to the channel's owner team (or All people).
2. Choose **Assign** to open the picker with **People**, **Agents** and **Teams**. Each person, agent and team shows a corner status: green/amber/gray for people, purple when an agent is available or pulsing purple when it is working; teams roll that up from their members (a person available wins; otherwise a working agent, then away, then an available agent). Someone without Handle access on the channel shows **No access to this channel** and cannot be picked. The list and header use the same mark for the current owner.
3. Picking an agent or a team asks for an optional message. An agent starts right away and answers as an internal note. A team picks the conversation up the way it is set to (see [Team](/docs/getting-started/team)).
4. In a note, type `@` to mention a person, an agent or a team. Mentioning an agent switches the composer to **Ask {agent}**; the meta conversation starts when you send. Mentioning a team notifies its people, or lets its agent answer first when the team is set to **Agent first**.

While a person or team owns the conversation, the agent only drafts, even on an Autonomous channel. What happens after you reply follows the channel's handover rule (see [AI handling](/docs/inbox/inbox-ai#set-handovers-between-agent-and-people)): by default the agent owns the conversation again (on Assisted too: it waits for the customer and then prepares the next draft) and the timeline shows **Back with {agent}**; with **Stays with the person** you become the owner; with **Ask when sending** the send menu offers **Send and hand back to {agent}** and **Send and keep with me**. When the channel closes after a reply, the send button reads **Send and close** and the menu offers **Send and keep open**. When the agent hands a conversation to people, it leaves an internal note with the reason, and the timeline shows **The agent handed this conversation to people**.

## Start a new conversation

1. Choose **New conversation** at the top of the inner rail (left of the sidebar layout control). You land on a message to an agent: pick the agent, a teammate, **Note**, **Transcript**, or an installed channel with the arrows beside the mark or by swiping, type, and send. For a teammate, **Write with AI** sits next to the microphone. A channel shows the logo, then **Mail from** (or **WhatsApp from**), the channel name, and the address or number underneath. Typing in an email channel opens the mail composer with an empty To field. A note or transcript starts as a chat field and opens its form once you type. The transcript form records the meeting. The workspace lead opens first. Under the name, the agent's function shows in the agent's color. Who you email (a customer, a teammate, or a typed address) is chosen in the composer, not as a separate type. A mail or WhatsApp conversation is created only when you send. An unsent mail shows up as a **Mail draft** chip under that grid: **Continue writing** reopens it, the cross discards it. **Transcribe conversation** records a meeting with the microphone and saves the text as an internal note. **Make a note** does the same without recording. **Contacts** opens the contacts list. Under the field, small text reads **Powered by Bokito**, then buttons **Communication**, **Agenda**, and **Contacts** open those pages.
2. **Email**: the draft is the same mail composer used for replies. Pick **To** — typing shows matching contacts and teammates, on **CC** and **BCC** too; arrow keys and Enter pick a suggestion. An entry that is not an email address is flagged under the fields and blocks sending. Open **CC/BCC** when needed, set the subject and write above your signature. **From** sits in the composer header when more than one mailbox can send; the mailbox you send from is remembered for next time. Attachments, dictation and **Ctrl+Enter** work as in a reply, and the draft autosaves until you send. Hover **+** on a mailbox in the sidebar to start with that From already set. Typing a new address is fine; a contact is not required first.
3. **WhatsApp**: enter the number and the message. The message joins the existing conversation for that number, or starts one. **Ticket**: pick a label with a flow (`#name` on a flow), a project when that flow sits on projects (or **No project**), a subject, and an optional note. **Log ticket** opens the internal conversation immediately, already filed on that label. **Agent**: the lead is already selected; the arrows or a swipe switch to another company agent or a teammate (or use **+** on an agent row). A teammate opens a mail to that person. For an agent, sending creates the chat and places your text as the first bubble. The list title stays a placeholder until that first send, then becomes a short label from the intent — not the full message.
4. You can also start mail from a contact card or the command palette. Forward from a thread still opens the compose dialog.
5. An empty inbox still offers **New conversation**, **Install widget**, and the setup guide — website chat does not wait for email.

## Choose what you send (Reply / Ask AI / Note)

![Composer modes in Communication](/api/docs/assets/communication/composer-modes.png)
*One composer with three destinations: the customer, the AI, or the team.*

1. Open a conversation. Under the timeline the composer shows a mode chip: **Reply to {name}**, **Ask {agent}**, and **Note**.
2. **Reply** goes to the customer on the same channel they used. Placeholder text reminds you they will see it. On chat, Enter sends. Attach sits on the left. The microphone has no frame; while it is listening it joins Send, a live level meter sits just to its left, and the button shows a green microphone with a slash. Send sends now and the microphone again keeps the text. Reopening a conversation picks **Reply** when the last message you received is from the customer, and **Ask** (or **To {name}**) when it is from an agent or a teammate. Your own last line and internal notes do not decide the tab. **Note** opens only when you press it. An agent draft meant for the customer opens on **Reply** with that text. Unsent Reply text and unsent Ask or Note text are stored separately, so switching tabs does not overwrite the other draft. On email, the Reply chip opens the mail composer — on the newest customer mail, or without quoted history on a conversation you started yourself. Closing that mail view (the **X**, **Esc**, or a click in the thread) leaves the compact **Reply** field. Clicking or typing in that field opens the mail composer again. See the next section.
3. **Ask** talks only with the AI on this conversation (or starts an AI check-in). The customer sees nothing. The agent sees the labels on this conversation, labels inherited from the contact, the label and the folder. It can take a free label off this conversation when that label does not fit. It cannot remove a label that only comes from the contact, and it cannot delete a label from the workspace. The tab and send button show that agent’s mark (or a facepile when you tag more than one), including while **Reply** is selected. The outline turns purple when the focus includes an agent. Click **Ask {name}** to insert an `@` chip for the focused agent. Mentioning only teammates switches to **To {name}** — that sends a normal chat bubble to the teammate in this conversation (the customer still sees nothing). An open customer draft keeps focus on **Reply**. Switching to Ask or mentioning an agent does not open a meta conversation until you send. **Cancel** on an empty meta conversation removes it. A **Stop** control appears while the AI streams. Paste a screenshot or image into the composer (or use the paperclip) so the AI can see it on that turn.
4. **Note** is team-only and stays a dashed internal note. Use it for handoffs and durable context that must not leave the workspace. Messaging a teammate with `@` is not a note — it is an ordinary message in the thread.
5. On an AI chat (`assistant` channel) or an AI check-in, Reply is hidden — only Ask and Note stay, with **Note** after **Ask**. Slash verbs and `@` mentions still work.

## Work with the AI inside a customer conversation

**Ask** is a message in the group: the customer never sees it. **@agent** invites that agent and hands them the turn. They may hand it to another agent with `@`. A reply that does not hand it on puts the turn back with the people, with one line **The turn is back with you.** Tagging only a person does the same, and names the agent who was not addressed. **Both** / **allebei** with two or more agents lets each of them speak once, in the order you tagged them, and then they may pass the turn. A follow-up with no `@`, while an agent still holds the turn, continues with that agent. You are not pinged for every agent bubble while the turn is still moving. You are pinged when a customer writes, when someone `@`s you, or when the turn comes back, unless you already have the conversation open. Unread still counts for members who are not looking.

1. Switch the composer to **Ask {agent}** and send. A small line **{agent} · internal** marks where the session starts; the agent name links to the agent. The session opens on that first send — you do not start it by hand. Agent chats and team threads have no session: Ask talks on the thread itself.
2. Your question lands on the right, the agent answers on the left while it streams, exactly like an agent chat. A greeting gets a direct reply. When you ask it to do something, it says yes in one short line, then shows **Working** while it does that. **Thinking** appears only while it reasons before an explanation. Every session row carries a crossed-eye mark with the tooltip **Internal - not visible to the customer**.
3. To put an agent on the floor instead of a quiet Ask, type `@` in a **Note** (or reply) and pick the agent, then send. They join the participant row and the timeline shows their turn. Module specialists appear in the same pick list when that module is installed.
4. The agent answers briefly and does not narrate what it is about to read. When a customer reply is the obvious next step it drafts one right away: the draft opens in your composer and the **Suggested a reply** card in the timeline shows **In composer**. Edit, then send to the customer. When it only needs to leave context for the team, it posts an **Internal note** with an **AI** chip (purple dashed note) — that is not a draft and needs no approval.
5. A quiet Ask session closes itself when the agent is done, when you send a reply to the customer, or after about an hour without activity. There is no wrap-up card and no **End session** button. The exchange stays in the timeline as ordinary bubbles. A summary line **Session with {agent} · N messages · N actions · time** marks the session; click it for the short outcome and the actions.

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
5. **Esc**, the **X** in the corner, or a click in the thread closes the mail view without sending and leaves the compact **Reply** field. Click or type in that field to open the mail view again. Your draft is saved automatically — a **Mail draft** chip above the composer offers **Continue writing** or discards it with the bin icon. The draft survives thread switches and reloads; sending clears it.

## See and change what the AI does

![AI handling picker in the thread header](/api/docs/assets/communication/handling-picker.png)
*The header shows the AI handling mode and which layer it follows.*

1. Open a customer conversation. The header shows the **AI handling** mode with its icon: **Autonomous** or **Assisted** (purple), or **Manual** (gray). In the menu, the inherited mode carries a badge that says where it comes from, for example **Channel default**.
2. Pick another mode to set it for this conversation only, until it closes. The mode you would otherwise follow carries a badge such as **Channel default** or **Contact default**; choose it to remove the override again. Only an owner or admin can raise a conversation to Autonomous.
3. Choose **Take over** to set Manual and assign the conversation to you; this is a hard stop that survives your replies. **Hand back to AI** returns it to the inherited mode and makes the agent the owner again (on Autonomous and Assisted); only on a Manual channel does it go back to the channel team. Replying on an autonomous conversation does not take it over: the agent owns it again after your reply unless the channel's handover rule says otherwise.
4. In the composer, type `/manual`, `/assisted` or `/autonomous` (or `/handmatig`, `/geassisteerd`, `/autonoom`), optionally followed by a reason.
5. Every change appears in the timeline, for example **AI handling set to Assisted**. Actions within five minutes share one row (the same window as stacked chat bubbles); a later burst gets its own row with the clock time. Hover a timeline row for the exact moment. Rows in the list show the mode icon when a conversation or contact differs from its channel. When the customer asked for a person, the row shows **Asked for a person**, the thread shows a banner, and the conversation sorts first. It stays in **Unassigned** until someone picks it up. See [AI handling](/docs/inbox/inbox-ai).
6. Live work appears at the bottom of the timeline while the AI thinks or writes — the same place for customer replies and Ask turns. See the next section.

## Follow what an agent does

An agent turn reads like a chat: a few short messages, with one line between them for the work in between.

![Agent turn with activity lines between chat messages](/api/docs/assets/communication/agent-turn.png)
*Thinking and working lines sit between the agent's messages and fold up when done.*

1. While the agent thinks, a line with a brain icon reads **Thinking** with a running time. When the model shares its reasoning, click the line to read it as it streams. Short messages skip reasoning. While it works, the line shows the current action with the integration logo (or a knowledge or wrench icon); each new action replaces the previous one. A web search reads **Searching for …** with the site favicon when results arrive.
2. When the agent switches from thinking to working (or back), the line folds into **Thought for 3s** or **Worked for 12s · 4 actions**. Click it to see each action, its input and its result. **Thought for** only shows when there is reasoning to read.
3. Leave the conversation and come back: the same thinking and actions stay on the thread. The agent keeps working until it replies or you press **Stop**. If an action fails or times out, that result goes back to the agent so it can retry or try another approach. On longer work the agent checks in with a short status line so you are not left on thinking only.
4. **Typing...** means the agent is writing its next message. A blank line in its answer starts a new message, so a turn arrives as up to five short bubbles. Email stays one structured message.
5. Agent messages use chat formatting only: bold, italic, strikethrough and links. Headings and tables become plain lines.
6. Under an agent message, **Sent to the customer** or **Not delivered** shows only on customer channels (email, WhatsApp, website chat). Chats with agents and internal threads never show a delivery label.

## React to a message

Every timeline message can take a reaction — customer mail, teammate notes, agent replies, and decision cards alike. Reactions stack like LinkedIn: one emoji per person, counts when several people pick the same one. Like and Agree feed the learning loop (Usage average feedback); Not helpful and Frustrated count as negative. Agents can leave **Looking into it** via tools; people cannot pick that one.

1. Hover a message (or a mail card). A thumbs-up appears on the bubble. Click it to like. Stay on it to open the other reactions: Applause, Agree, Thinking, Facepalm, Not helpful.
2. The emoji sits on the message with a count when others react the same way. Hover the stack to see who reacted, or to pick a different one. Choose the same emoji again to clear yours.

## Review an AI-suggested reply

1. When the channel agent suggests a reply, the draft appears in the composer. The text glows purple for a couple of seconds so you can see it was generated. The timeline shows that action next to that agent's avatar: **Suggested a reply**. The first line of the timeline is **Conversation started by {name}**.
2. Edit the text if needed, then **Send** (or use the send menu to send and close). Sending resolves the decision and delivers the reply. An edited send is kept as an example: the next similar reply starts from that wording.
3. **Discard** on the restored-draft bar rejects the proposal without sending. Other decisions (platform, module, agenda, checkout) stay as cards titled **Waiting for your OK** with plain verb buttons — no tool names in the copy.

## Handle an outdated draft

A draft answers one customer message. When the customer writes again, a colleague replies from their own mailbox, or the same person continues on another channel, the old draft no longer fits.

![Outdated draft notice above the composer](/api/docs/assets/communication/stale-draft.png)
*The composer flags a draft written for an earlier message and offers a fresh proposal.*

1. Open the conversation. Above the composer a notice reads **Outdated draft** with the reason: the customer wrote again after this draft. The timeline line of the old proposal reads **Set aside: customer wrote again**, **Set aside: a teammate replied** or **Set aside: a newer conversation with this person**.
2. Choose **Propose again** to let the AI draft a reply to the latest message, or **Discard** to clear the text and start from scratch. A draft you never touched is not stored, so an unchanged AI proposal disappears on its own when it is set aside.
3. When the customer also wrote on another channel, a line above the composer reads **{name} also wrote 2 hours ago via WhatsApp** with **Open**. Each channel keeps its own conversation; the line tells you where the live thread is, and the AI keeps one proposal per person on the newest conversation.
4. The side panel lists **Other conversations** with this person, open ones first. Each row is one line: status dot, channel icon, subject and how long ago. Hover a row for the status, and **Proposal open** when an AI proposal waits there.
5. Closing a conversation or marking it as spam drops its unsent draft.

## Already handled outside Bokito

You called the customer, answered from a personal WhatsApp or settled it from another mailbox. Log it so the conversation stops asking for a reply.

1. Open the conversation. Choose **Already handled outside Bokito** in the arrow menu next to **Send** (it works with an empty composer).
2. Pick where it was handled: **Phone**, **WhatsApp**, **Other mailbox** or **Elsewhere**. Add what was agreed in one line if you like.
3. Keep **Also close the conversation** on to close it in the same step, or turn it off to leave it in Open with you as owner.
4. Choose **Log as handled**. The timeline shows **Handled by phone by {name}** with your note, the conversation is marked read, open AI proposals are set aside with reason **handled outside Bokito**, and the thread leaves **Your turn**.
5. A colleague's reply sent from their own Gmail or Outlook mailbox is logged on its own when that mailbox is connected; see [Channels](/docs/inbox/channels). Agents can log the same thing with the governed tool `mark_handled_externally`.

## Decide in the thread

![Decision card in a thread](/api/docs/assets/communication/decision-card.png)
*Decision cards appear in the timeline as chat bubbles.*

1. A decision bubble appears when an agent needs your judgment. In an agent chat the question text arrives first; the approval card lands under it with each action named by what it does (for example **Create calendar event: Standup** and the time in the subtitle), not only a bare tool id.
2. Read the proposal. When the card offers several concrete choices, each button keeps its own label (for example send vs cancel vs ask the customer). When several actions wait in one turn, one card lists every row — approve all, pick some, or reject. Approve, edit or decline. The cloud itself shows who approved or declined (you or a teammate) — you do not send a separate “Approved” / “Declined” chat message. **Later** / **Not now** keeps the conversation in Open and marks it unread. The single **I'll handle it myself** button sets the conversation to Manual and assigns you.
3. On approve, the linked action runs immediately. In agent and Ask chats the agent then confirms briefly (and can showcase what was created). Nothing customer-facing goes out until you answer, unless autonomy allows it. Approving **Plan** gives this conversation a date and shows it on [Agenda](/docs/ai/agenda). From the thread menu choose **Plan** to set a date or repeat yourself. Choose **Add to project** in the same menu to link the thread to a project. See [Decisions](/docs/ai/decisions).

## Link a visitor to a contact

1. Open a website-chat thread. The header can show **+N earlier** when this person already wrote before — that opens the contact panel.
2. In the contact panel, choose **+ Contact**, type their email or phone number (and a name if you have one), then **Link**. Bokito links the chat to the existing contact with that address, or creates one. See [Link a conversation to a contact](/docs/inbox/contacts).
3. Unknown visitors show **Unknown chatter**. A saved person shows **Contact**, with the company on that same line. Mail from a workspace member shows **Teammate** instead (no Approve) — they are not treated as a customer contact. An unmatched sender has one **Contact** action in the side panel, plus **Mark as spam** (or **Not spam** when it already is). There is no second add-contact button, Mail, or Open contacts there. To block someone, use the thread menu (⋯) or the contact page. Unsaved contact notes stay highlighted until you save, and leaving the page asks you to confirm.

## Tag a conversation and file a ticket

1. Open a customer conversation. The side panel **This conversation** shows the AI summary when the channel agent has read the thread, then the folder name (the full path is on the tooltip), priority, labels and the ticket. A label that has a flow uses the color and icon set on that label (soft fill, stronger icon and text). Without a flow the label stays plain. When this conversation owns a snapshot canvas, the same block shows its name, a compact preview and a link to that canvas. Choose **Add labels** for free labels and labels with a flow (labels with a flow start a ticket flow); see [Labels and tickets](/docs/ai/categories). On a closed conversation, the ⋯ menu offers **Use as example** so the next similar reply can learn from it.
2. Type with a soft `#`. Spaces, hyphens and underscores become `_`, so `mistral ai` is `#mistral_ai`. Matching rows are paths (`#acme / #facturen`), not a bare tag. One matching path: Enter takes it and sets every tag on that path. When the contact already has the parent tag, the leaf is enough and the row shows **via contact**. An unknown name asks whether to add it as a tag or **Attach a flow**. The conversation can appear in every folder whose path tags it carries. Tags inherited from the contact show as dashed chips you cannot remove here.
3. The flow label chip is locked on the conversation. Choosing another label asks you to replace it: the current label, a right arrow, and the new label. **Replace** files the new one. **Split** when a second request needs its own ticket. Free tags show a muted `#` and an **x** to remove.
4. Manage the list under **Settings** → **# Tags**: rename a tag, put it in a group, add a description agents read, pin it to Communication, choose **Create folder** or **Create flow** / **Open flow**, or delete it from every conversation. You can also ask an agent in chat (*add the tags #vip and #partner*): it proposes **Create hashtag #vip** and the rest as rows on one card you approve in the thread; see [Decisions](/docs/ai/decisions). Agents propose labels with a flow the same way, through Govern.
5. To tag automatically, add an automation rule with the action **Add tags** under **Settings** → **Channels**. The rule tags matching conversations and the normal flow continues; the timeline shows a line such as **Tagged billing by rule**.
6. When a second request shows up in the same thread, choose **Split from here** on the message where it starts, so each conversation keeps one ticket.

## Find work by folder or flow

The Communication rail splits place and flow. **Folders** is the saved map tree (AND tag filtersets). **Flows** lists labels with a flow that start a ticket. Nested maps show only the local `#` relative to the parent; the badge is how many open conversations carry that map's tags. A conversation can appear in more than one folder.

![Tags in the Communication sidebar](/api/docs/assets/communication/hashtags.png)
*Folders tree and Flows section in the Communication rail.*

1. Under **Folders**, click a map such as `#facturen` under `#acme` to see conversations that carry every tag in that map (including tags inherited from the contact). The same conversation also stays under broader maps. All maps appear in the rail, including empty ones. The gear opens the **Folders** hub.
2. Under **Flows**, click a label with a flow such as support to expand **Open** and **Closed**, then work that ticket queue. The gear opens **Flows** (`/workstreams`).
3. Pin a free tag (no map, no flow) if you still want it in the Folders section; otherwise free tags stay out of the rail.
4. Open the more-actions menu on a conversation and choose **File in folder** or **Close and file**. That adds the tags of the chosen path. With several conversations selected, **More actions** → **File in folder** does the same.
5. The thread header shows every matching map as `#` chips, such as `#acme · #facturen`. Canvas and docs live on the folder hub under **Folders**.
6. Choose which sub-view each row opens on under **Settings** → **Channels** → **Tags and Communication**.

## What to do next

Connect a mailbox under [Channels](/docs/inbox/channels). Open [Contacts](/docs/inbox/contacts) to see who is writing in.

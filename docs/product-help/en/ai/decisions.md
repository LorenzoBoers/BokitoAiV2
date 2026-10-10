---
title: Approve and decline decisions
intro: Agents ask inside the thread when a step needs your judgment. Every open approval lives in Communication under Decisions.
description: Approve, edit or decline decision cards in the thread, from the Decisions folder, Cockpit, or a notification.
keywords: decisions, approvals, decision requests, notifications, human in the loop, dismiss all, duplicate questions
sort: 20
related: communication,agent-runs,autonomy,govern
---

# Approve and decline decisions

A decision request is a message in the thread, and that is the only place you answer it. To see every conversation with an open card — customer and internal together — open **Decisions** in the Communication sidebar.

Automated mail (receipts, newsletters, no-reply senders) does not raise decisions. The agent notes those quietly on the thread. If tip cards piled up from earlier mail, open [Agents](/docs/ai/agents) and use **Clear tip cards**.

## Find a waiting decision

![A waiting decision in the thread](/api/docs/assets/decisions/approve.png)
*Open the thread from Decisions, Cockpit, or a notification.*

1. Open **Communication**, then **Decisions**. Cockpit **Awaiting decision** / **Needs attention** and the bell menu land on the same list. A **Needs decision** badge marks the rows.
2. Select a thread (the first match opens automatically) and scroll to the decision card. It shows the proposed action and why the agent stopped.
3. When nothing waits on you, Decisions shows an empty state with links back to the inbox and Agents.

## Approve an agent proposal in the chat

When you ask an agent to do something that needs your OK, its last message asks the question and the buttons sit right under that message. Agents can also show objects without asking — tags as inline chips in the text, and showcase cards under the prose — and only raise buttons when they need an answer.

![An agent proposal with a Bin item and buttons under the message](/api/docs/assets/decisions/inline-proposal.png)
*The item the agent wants to restore sits inside its message; the buttons sit under it.*

1. Read the agent's message. Tags such as `#klacht` (action tag) and `#storing` (tag) appear as chips in the text. Objects the proposal is about show under it as showcase cards: a conversation, Bin item, agenda item, file, image, teammate, agent, connection, module, help article, message, flow, project or contact. With an open proposal, select a card to choose that option; without a proposal, select a card to open it.
2. Choose a button under the message, for example **Approve** or an agent-written label. That choice applies **this time**. When the agent allows several picks, select the options (or cards) you want and choose **Confirm**. **Reject** declines. A choice that needs text opens a small field; type the answer and choose **Submit answer**.
3. On a chat with the agent, a plain **Yes** / **No** (or **Ja** / **Nee**) in **Ask** does the same as the matching Ja/Nee buttons when exactly one open card is that kind of choice. Multi-select and text answers still need the buttons. Several Ja/Nee cards at once also stay button-only.
4. When the action can teach the agent, a **Next time** line offers **You may do this yourself from now on** or **Always ask** (also under the more menu). That proposes a rule; it does not replace approving this card.
5. After you answer, your reply appears as your own bubble with the chosen label and any selected showcase cards. On chats with an agent, a short confirm follows when a tool already ran (for example `#tag is deleted`); Soft Yes with no other open cards lets the agent continue in the thread. The buttons fold into a short *Answered · time* line. A proposal the agent replaced with a newer one reads *Replaced by a newer proposal*.
6. While the agent is still working, *Preparing proposal...* shows that buttons are on the way.

## Approve, edit or decline

1. Read the proposal in context of the conversation. Reply drafts on customer conversations, check-ins and scheduled wakes keep their own card in the thread.
2. Cards use the action they need: **Approve**, **Reject**, **Edit**, **Escalate**, **Defer**, **Later**, **Close thread**, **What next** or **Keep open**. Suggested-reply cards from [AI handling](/docs/inbox/inbox-ai) use **Send**, **Edit** or **Escalate**.
3. A suggested chat reply can hold several short messages. The card lists them as **Message 1**, **Message 2** and so on. Choose **Remove message** on one you do not want, or **Edit** to rewrite them as one text; a blank line starts a new message. **Send** delivers them in order.
4. Hover an agent message: icons next to the bubble mark **Looks right** or **Not helpful**, and the speech-bubble icon (**Correct this**) teaches the agent. Hover an icon to see its label. Escalate sets the conversation to Manual and assigns you.

## Dismiss the same question in bulk

When a check-in or agent asked the same question many times (for example *Set up Google Sheets integration?* on every run), you do not have to decline each card.

1. Open **Communication**, then **Decisions**. Above the list, the banner **Same question, many cards** lists each question that waits two or more times, with its count.
2. Choose **Dismiss all** on a row. Every open card with that title is deferred and dropped from Decisions and the bell menu; nothing executes.
3. The agent treats a dismissal as a decline for that topic and does not raise it again for a while. Cards on a conversation stay visible in that thread as answered; the conversation itself stays open.
4. A question that is not about a conversation and has no action to execute is no longer raised: the agent writes it in its own channel instead. When an agent asks about a conversation it names the subject, and the card lands on that thread.

## Teach the agent for next time

1. On a card that asks before an action, the row **Next time:** offers three buttons. Under an agent's message, the same choices sit in the **More options** menu next to the buttons. When an earlier draft was set aside because the person continued elsewhere, the resolved line offers **Open active** to jump to that conversation.
2. **You may do this yourself from now on** proposes a rule that lets the agent do this on its own. **Always ask** proposes a rule that keeps asking. Both arrive as a card in the same conversation; confirm it there. Only an owner or admin can confirm a rule that lets an agent act on its own.
3. **Not sure yet** keeps the case as an example. After a few examples the agent proposes a rule from them.
4. Rules show on the agent under **Rules** (see [Agents](/docs/ai/agents)).

## Who gets the question

Each question goes to one addressee: the person or team named in the agent's **Ask questions to**, else the conversation owner, else whoever handed over the work, else the owner team. Someone who is away is skipped. When one person keeps answering questions on the same topic, Govern proposes a routing rule such as *Questions about invoices go to Lisa*; once accepted, those questions go to that person first.

## Answer from a notification

1. Choose the decision in the bell menu, or open the push notification on your phone. Both open Decisions on that thread and jump straight to the waiting card.
2. Read the card's source line: it names where the request came from — a project queue, an agent run, or a proposed workspace change — and links to it.
3. Answer in the thread. Assisted drafts still need a human send; only Autonomous conversations send on their own.
4. Under **Settings**, then **Notifications**, use the matrix. Each section (**Delivery**, **Conversations**, **Workspace**, **Digest**) has a master switch per column in the section header. A notice arrives only when both its tier and its event are on. Turn on **When a new message arrives on a conversation you or your team own** to hear about new mail. Turning **Push** on asks this browser for permission when needed; after sign-in Bokito can also offer a soft **Enable push** banner once.

## Hand work to a coding tool

When an agent proposes handing coding work to Cursor, Claude Managed Agents or Devin, you approve that Decision like any other. After approval, progress and follow-ups stay in the same thread — see [Hand work to a coding tool](/docs/developers/workbench).

## When agents ask

Workspace [autonomy posture](/docs/govern/autonomy) sets the default. On [Govern](/docs/govern/govern) **Policy**, each tool category is **Deny**, **Ask first** or **Allow**. **Ask first** creates the card you see in the thread. Per-agent overrides on the agent page win over the category.

Start with **Assisted**. Move steps you always approve toward **Allow**. Keep **Ask first** for the risky ones.

## What to do next

Structural workspace edits wait on Govern **Pending reviews**, not in the thread. Audit later under Govern **Recent audit**.

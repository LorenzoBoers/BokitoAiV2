---
title: Set Autonomy
intro: Choose whether the AI answers on its own, drafts for review, or stays quiet. One dial for the workspace; a channel or a single conversation may sit lower.
description: Configure Autonomy (Autonomous, Assisted, Manual), exceptions per channel, safeguards, handovers between agent and people, disclosure, reply language and send-as.
keywords: Autonomy, autonomous, assisted, manual, drafts, auto reply, safeguards, handover, owner, return to agent, bounce limit, close after reply, reopen, disclosure, reply language, send as, certainty, automated mail, automation rule, no reply needed
sort: 25
related: communication,contacts,channels,govern,autonomy,agents
---

# Set Autonomy

Autonomy is one setting with three modes: **Autonomous** (AI answers on its own), **Assisted** (AI drafts replies and suggests actions, a person sends) and **Manual** (no customer draft or send; the linked channel agent may still read the thread, set summary and priority, and file tags or tickets). You set it once with the Autonomy dial on Govern, and only set it lower where a channel or a single conversation should differ. Nothing goes above the dial. Without an **AI agent** on the channel there is no inbound interpretation or reply.

The same icons appear everywhere: a lightning bolt for Autonomous and a pen for Assisted (both purple), and a hand for Manual (gray). The dial is described in [Autonomy](/docs/govern/autonomy). Each agent has its own level too (see [Agents](/docs/ai/agents)): a conversation the agent handles never runs above it, and the picker says so.

## Set the workspace dial

![The Autonomy dial](/api/docs/assets/inbox-ai/workspace-default.png)
*Three cards: Manual, Assisted and Autonomous.*

1. Open **Settings**, then **Govern**, then **Policy**. Every setting on this page lives there.
2. Under **Autonomy**, pick **Manual**, **Assisted** or **Autonomous**. The change saves at once.
3. Turning on **Autonomous** asks **Turn on Autonomous?** first. Only an owner or admin can change the dial.
4. To pause autonomous replies for the whole workspace, set the dial to **Assisted**. Every conversation then drafts until you raise it again.

Start with **Assisted**. Bokito suggests Autonomous once at least 80% of 50 or more drafts go out unedited. On an Assisted channel, the Autonomy row shows how many of those 50 drafts were sent unchanged.

## Review exceptions

1. On the same page, open **Per channel**. It lists every channel and open conversation set below the dial, grouped by layer.
2. Each row shows its mode icon and name. Choose **Follow the default again** to remove the exception. A tripped circuit breaker shows **Resume autonomous** on the channel row.
3. Set new exceptions where you work: on the channel under [Channels](/docs/inbox/channels), or in the conversation header in [Communication](/docs/inbox/communication).

A conversation exception lasts until the conversation closes. Channel exceptions stay until you clear them.

## Set safeguards for autonomous replies

1. Open **Safeguards**. Each safeguard turns a single autonomous reply into a draft for review; it never sends more.
2. Set the **Certainty threshold** (1–10, from **permissive** to **strict**). Below that certainty, the reply becomes a draft.
3. Turn on **Review replies to new contacts** to draft instead of send while a contact awaits approval. Website chat visitors are exempt.
4. Turn on **Disclose AI replies** to add a short note to autonomous replies. Change the **Note text** or leave it empty for the default; the preview shows what customers see.
5. Under **Circuit breaker**, set **Autonomous replies per hour per channel** and **Negative signals per hour per channel**. A tripped channel runs Assisted until someone resumes it from **Per channel** or the channel.
6. Set the **Bounce limit**: how often per day a conversation may move between the agent and people. After that, people keep it until someone hands it back explicitly, and the thread shows a note from the agent. 0 turns the limit off.
7. Changes save automatically.

A flow can keep its tickets on review: turn on **Always review** on the flow page (see [Flows](/docs/ai/flows)). Replies on those tickets become a draft, even when the conversation is Autonomous.

The timeline shows a line such as **Drafted instead of sent** with the reason whenever a safeguard applies. The same line appears with **the agent does not own this conversation** when a person or team owns it (the agent then drafts for them) and with **a colleague is typing a reply** when someone is writing in the composer at that moment.

Replies follow the channel. Email gets one structured message. On WhatsApp and website chat the AI writes like a person in a chat: up to five short messages, sent in order with a short typing pause, and the AI note only on the first one. If one message fails to send, the rest wait. In **Assisted**, the draft card holds the same messages so you can remove or edit them before **Send** (see [Decisions](/docs/ai/decisions)).

## Set handovers between agent and people

Autonomy says what the agent may do; the owner says whose turn it is right now. The agent owns a conversation while it has the next step: on an **Autonomous** channel it answers new conversations itself; on **Assisted** it picks them up, gathers context, prepares a draft or choice card and then hands the conversation to a person (the timeline shows **Draft ready: {name} is up**). It also hands over when the customer asks for a person, when a safeguard or decision escalates, or when someone takes over. These rules decide what happens around that handover.

1. On the same page, open **Handovers between agent and people**.
2. Under **After a person replies**, pick **Return to the agent** (the agent owns the conversation again and picks up the customer's next message: it answers itself on Autonomous, drafts for you on Assisted; the default), **Stays with the person** (whoever replies becomes the owner and the agent drafts for them) or **Ask when sending** (the send menu in the conversation offers **Send and hand back to {agent}** and **Send and keep with me**).
3. Turn on **Close after an autonomous reply** to close a conversation as soon as a delivered autonomous reply goes out, or **Close after a person replies** to make **Send** close it by default; the send menu then offers **Send and keep open**. A new message from the contact reopens a closed conversation.
4. Under **Owner on reopen**, choose **Same owner** (the last owner gets the reopened conversation; a person who left the workspace falls back to the contact owner or the channel team) or **Route again** (the reopened conversation is routed like a new one).
5. Override every rule except the bounce limit per channel under [Channels](/docs/inbox/channels), section **Handovers**. A channel value shows the **Company default** badge until the channel picks its own rule.

When the agent hands a conversation to people, it picks the owner in this order: the person named by the agent or decision, a learned routing rule, the last person or team who handled the conversation, the owner of the contact (see [Contacts](/docs/inbox/contacts)), the channel's owner team, All people. The thread gets an internal note from the agent with the reason, and **Take over** always stays a hard stop until someone chooses **Hand back to AI**.

## Set reply and working language

1. Open **Language** on the same page, or set the organization working language under **Settings → General**.
2. **Reply language** is what the customer sees. **Automatic (match the customer)** mirrors the inbound language. You can pin Dutch, English, German, French or Spanish.
3. **Organization working language** (team language) is the language agents use when writing, thinking, and explaining for your team — operator chats, summaries, decisions, and thinking. It does not change the customer reply.
4. **Approved replies are sent as** is **The approving teammate** or **The AI agent**. That picks the signature and the From display name. On a single draft anyone can still switch **Send as**.
5. Under **Reply language per mailbox**, expand a mailbox to give it its own reply language. Rows with an override show a **Custom** badge.

## When the AI does not reply

- **Manual** is in effect somewhere in the chain, or a teammate took over the conversation.
- A person or team owns the conversation (for example after **Stays with the person**): the agent drafts for them instead of sending.
- The Autonomy dial sits on Assisted or Manual, or the flow of the ticket is on **Always review**.
- **Privacy** keeps AI away from message bodies; Autonomy then shows Manual.
- The channel's circuit breaker tripped after unusual activity; the channel runs Assisted until someone resumes it.
- The mailbox still needs setup or reconnect. The thread gets an **Internal note** pointing to **Settings → Channels** instead of a draft.

## See why a conversation runs this way

The **Why** button in the conversation header lists every reason in one place, each as a sentence that links to where you change it.

1. Open a conversation and click **Why** in the header.
2. The first line names the agent: who wrote the last reply, owns the conversation, or is addressed.
3. The next lines show the Autonomy setting and where it comes from (workspace, channel or this conversation), followed by everything that keeps it lower: the dial, Privacy, the breaker, the agent's own level or a flow on **Always review**.
4. Below that are the knowledge documents the last reply read, the folder the conversation sits in (and whether its label comes from the conversation, the contact or the company), and the flow with its current stage.
5. The last lines show where the work was delivered: replies per channel, the folder and its **Works in** place (a connection, canvas or the board), and a correction kept as an example.
6. Click a line to open that setting or place. Replies from before this panel existed show no documents.

## No reply needed

Not every mail wants an answer. Receipts, deploy notices and other automated mail get an action card instead of a draft, and a proposal is only kept while it still answers the latest message.

1. When the AI decides no reply is needed, the conversation shows an action card with **Close** and **Keep open** instead of a draft, and the composer opens on **Note**. The AI's one-line summary (for example **GitHub deploy succeeded**) is in the card. A model that explains itself first still ends in that card; explanation text is never shown as a draft.
2. Each read of a message ends in one card. Labels and other steps of that read sit in the card's activity line (**Worked for 3s · 3 actions**), not as separate lines. A newer read replaces an open card; the old one shrinks to **Replaced by a newer read**.
3. The people who own the conversation get one notification, after the read: **Draft ready**, **Needs a choice** or **No reply needed**, with the sender as title. No reply needed lands quietly in For you, with no pop-up or push. When the read takes longer than 20 seconds, the plain **New message from** notification goes out instead.
4. The AI keeps one reply proposal per person. When the same person also writes on another channel, the older conversation's proposal is set aside (**Set aside: a newer conversation with this person**) and the newest conversation carries the live one.
5. A proposal that no longer answers the latest message is set aside as well: when the customer writes again before you send (**customer wrote again**), when a colleague replied from their own mailbox (**a teammate replied**), or when someone logged **Already handled outside Bokito**. A run that finishes after a newer message arrived does not post its draft.
6. The composer tells you when a stored draft is outdated and offers **Propose again**; see [Communication](/docs/inbox/communication).
7. While you stay on the conversation and the agent finishes a draft, that text lands in the reply composer. The timeline shows **Suggested a reply**: open the chevron to read it, or choose **Use draft** / **In composer** to put it in the input again after you opened another chat. Team-only notes from the model never fill the customer draft.
8. On a mailbox with **Archive automated mail** turned on, that card is skipped: the thread closes on arrival and gets the `#automated` tag. Set it per mailbox under [Channels](/docs/inbox/channels).
9. When the third no-reply mail from the same sender arrives, the AI proposes an **Automation rule** for that sender as a card in the conversation (*Auto-close mail from newsletter@example.com?*). **Activate** turns the rule on under **Automation rules**; **Later** keeps it as a draft. An agent that proposes a rule on its own uses the same card, so rules never activate without a person.

The same mode decides who an unknown chatter is. When a visitor gives an email or phone number, **Autonomous** links the conversation to the matching contact (or creates one), **Assisted** links only verified addresses and asks you for the rest, and **Manual** leaves linking to you. See [Link a conversation to a contact](/docs/inbox/contacts).

## What to do next

Load [Knowledge](/docs/ai/knowledge) so drafts stay grounded. Set **Who answers** on [Channels](/docs/inbox/channels) when a channel should skip the workspace default agent — that is routing, not Autonomy.

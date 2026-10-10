---
title: Set AI handling
intro: Choose whether the AI answers on its own, drafts for review, or stays quiet — once for the workspace, with exceptions per channel, contact, or conversation.
description: Configure AI handling (Autonomous, Assisted, Manual), its layers, safeguards, disclosure, reply language and send-as.
keywords: ai handling, autonomous, assisted, manual, drafts, auto reply, safeguards, disclosure, reply language, send as, certainty, automated mail, automation rule, no reply needed
sort: 25
related: communication,contacts,channels,govern,autonomy,agents
---

# Set AI handling

AI handling is one setting with three modes: **Autonomous** (AI answers on its own), **Assisted** (AI drafts replies and suggests actions, a person sends) and **Manual** (no customer draft or send; the linked channel agent may still read the thread, set summary and priority, and file tags or tickets). You set it once for the workspace and only set it again where a channel, a contact or a single conversation should differ — the most specific setting wins. Without an **AI agent** on the channel there is no inbound interpretation or reply.

The same icons appear everywhere: a lightning bolt for Autonomous and a pen for Assisted (both purple), and a hand for Manual (gray). [Govern](/docs/govern/govern) sets the ceiling: nothing below it can be more autonomous than Govern allows. Each agent has its own ceiling too (see [Agents](/docs/ai/agents)): a conversation the agent handles never runs above it, and the picker says so.

## Set the workspace default

![Workspace default for AI handling](/api/docs/assets/inbox-ai/workspace-default.png)
*Three cards: Autonomous, Assisted and Manual.*

1. Open **Settings**, then **AI handling**.
2. Under **Workspace default**, pick **Autonomous**, **Assisted** or **Manual**. The change saves at once.
3. Turning on **Autonomous** shows a confirmation with how many open conversations follow this setting and how often drafts were sent unedited recently. Only an owner or admin can turn on Autonomous.
4. Under the cards, the **Ceiling** shows the Govern limit. Choose **Pause autonomous replies** to cap every conversation at Assisted in one step; **Allow autonomous replies** lifts that cap. Open **Govern ceiling** from the note when you need to change the workspace posture or Messaging allowance.

Start with **Assisted**. Bokito suggests Autonomous once at least 80% of 50 or more drafts go out unedited. On an Assisted channel, the AI handling row shows how many of those 50 drafts were sent unchanged.

## Review exceptions

1. On the same page, open **Exceptions**. It lists every channel, contact and open conversation that does not follow the workspace default, grouped by layer.
2. Each row shows its mode icon and name. Choose **Follow the default again** to remove the exception. A tripped circuit breaker shows **Resume autonomous** on the channel row.
3. Set new exceptions where you work: on the channel under [Channels](/docs/inbox/channels), on a contact under [Contacts](/docs/inbox/contacts), or in the conversation header in [Communication](/docs/inbox/communication).

A conversation exception lasts until the conversation closes. Channel and contact exceptions stay until you clear them.

## Set safeguards for autonomous replies

1. Open **Safeguards**. Each safeguard turns a single autonomous reply into a draft for review; it never sends more.
2. Set the **Certainty threshold** (1–10, from **permissive** to **strict**). Below that certainty, the reply becomes a draft.
3. Turn on **Review replies to new contacts** to draft instead of send while a contact awaits approval. Website chat visitors are exempt.
4. Turn on **Disclose AI replies** to add a short note to autonomous replies. Change the **Note text** or leave it empty for the default; the preview shows what customers see.
5. Under **Circuit breaker**, set **Autonomous replies per hour per channel** and **Negative signals per hour per channel**. A tripped channel runs Assisted until someone resumes it from Exceptions or the channel.
6. Changes save automatically. **Last modified** in the page header shows when the last save finished.

## Action tags that always need review

1. On the same page, open **Action tags that always need review**.
2. Turn **Always review** on for an action tag. Replies on a ticket with that tag become a draft, even when the conversation is Autonomous.
3. Turn it off (**May send**) when autonomous send is fine for that tag.

The timeline shows a line such as **Drafted instead of sent** with the reason whenever a safeguard applies.

Replies follow the channel. Email gets one structured message. On WhatsApp and website chat the AI writes like a person in a chat: up to five short messages, sent in order with a short typing pause, and the AI note only on the first one. If one message fails to send, the rest wait. In **Assisted**, the draft card holds the same messages so you can remove or edit them before **Send** (see [Decisions](/docs/ai/decisions)).

## Set reply and working language

1. Open **Language** on the same page, or set the organization working language under **Settings → General**.
2. **Reply language** is what the customer sees. **Automatic (match the customer)** mirrors the inbound language. You can pin Dutch, English, German, French or Spanish.
3. **Organization working language** (team language) is the language agents use when writing, thinking, and explaining for your team — operator chats, summaries, decisions, and thinking. It does not change the customer reply.
4. **Approved replies are sent as** is **The approving teammate** or **The AI agent**. That picks the signature and the From display name. On a single draft anyone can still switch **Send as**.
5. Under **Reply language per mailbox**, expand a mailbox to give it its own reply language. Rows with an override show a **Custom** badge.

## When the AI does not reply

- **Manual** is in effect somewhere in the chain, or a teammate took over the conversation.
- Govern caps conversations at Assisted (messaging set to ask) or Manual (messaging denied).
- **Privacy** keeps AI away from message bodies; AI handling then shows Manual.
- The channel's circuit breaker tripped after unusual activity; the channel runs Assisted until someone resumes it.
- The mailbox still needs setup or reconnect. The thread gets an **Internal note** pointing to **Settings → Channels** instead of a draft.

Hover the mode in the conversation header to see which layer decided and why.

## No reply needed

Not every mail wants an answer. Receipts, deploy notices and other automated mail get an action card instead of a draft, and a proposal is only kept while it still answers the latest message.

1. When the AI decides no reply is needed, the conversation shows an action card with **Close** and **Keep open** instead of a draft, and the composer opens on **Note**. The AI's one-line summary (for example **GitHub deploy succeeded**) is in the card. A model that explains itself first still ends in that card; explanation text is never shown as a draft.
2. The AI keeps one reply proposal per person. When the same person also writes on another channel, the older conversation's proposal is set aside (**Set aside: a newer conversation with this person**) and the newest conversation carries the live one.
3. A proposal that no longer answers the latest message is set aside as well: when the customer writes again before you send (**customer wrote again**), when a colleague replied from their own mailbox (**a teammate replied**), or when someone logged **Already handled outside Bokito**. A run that finishes after a newer message arrived does not post its draft.
4. The composer tells you when a stored draft is outdated and offers **Propose again**; see [Communication](/docs/inbox/communication).
5. While you stay on the conversation and the agent finishes a draft, that text lands in the reply composer. The timeline shows **Suggested a reply**: open the chevron to read it, or choose **Use draft** / **In composer** to put it in the input again after you opened another chat. Team-only notes from the model never fill the customer draft.
6. On a mailbox with **Archive automated mail** turned on, that card is skipped: the thread closes on arrival and gets the `#automated` tag. Set it per mailbox under [Channels](/docs/inbox/channels).
7. When the third no-reply mail from the same sender arrives, the AI proposes an **Automation rule** for that sender as a card in the conversation (*Auto-close mail from newsletter@example.com?*). **Activate** turns the rule on under **Automation rules**; **Later** keeps it as a draft. An agent that proposes a rule on its own uses the same card, so rules never activate without a person.

The same mode decides who an unknown chatter is. When a visitor gives an email or phone number, **Autonomous** links the conversation to the matching contact (or creates one), **Assisted** links only verified addresses and asks you for the rest, and **Manual** leaves linking to you. See [Link a conversation to a contact](/docs/inbox/contacts).

## What to do next

Load [Knowledge](/docs/ai/knowledge) so drafts stay grounded. Set **Who answers** on [Channels](/docs/inbox/channels) when a channel should skip the workspace default agent — that is routing, not AI handling.

---
title: Set AI handling
intro: Choose whether the AI answers on its own, drafts for review, or stays quiet — once for the workspace, with exceptions per channel, contact, or conversation.
description: Configure AI handling (Autonomous, Assisted, Manual), its layers, safeguards, disclosure, reply language and send-as.
keywords: ai handling, autonomous, assisted, manual, drafts, auto reply, safeguards, disclosure, reply language, send as, certainty
sort: 25
related: communication,contacts,channels,govern,autonomy,agents
---

# Set AI handling

AI handling is one setting with three modes: **Autonomous** (AI answers on its own), **Assisted** (AI drafts replies and suggests actions, a person sends) and **Manual** (AI stays quiet). You set it once for the workspace and only set it again where a channel, a contact or a single conversation should differ — the most specific setting wins.

The same icons appear everywhere: a lightning bolt for Autonomous and a pen for Assisted (both purple), and a hand for Manual (gray). [Govern](/docs/govern/govern) sets the ceiling: nothing below it can be more autonomous than Govern allows. Each agent has its own ceiling too (see [Agents](/docs/ai/agents)): a conversation the agent handles never runs above it, and the picker says so.

## Set the workspace default

![Workspace default for AI handling](/api/docs/assets/inbox-ai/workspace-default.png)
*Three cards: Autonomous, Assisted and Manual.*

1. Open **Settings**, then **AI replies**.
2. Under **Workspace default**, pick **Autonomous**, **Assisted** or **Manual**. The change saves at once.
3. Turning on **Autonomous** shows a confirmation with how many open conversations follow this setting and how often drafts were sent unedited recently. Only an owner or admin can turn on Autonomous.
4. If Govern caps conversations lower, the card shows the cap. Open Govern from the note under the cards to change it.

Start with **Assisted**. Bokito suggests Autonomous once at least 80% of 50 or more drafts go out unedited.

## Review exceptions

1. On the same page, open **Exceptions**. It lists every channel, contact and open conversation that does not follow the workspace default, grouped by layer.
2. Each row shows its mode icon and name. Choose **Follow the default again** to remove the exception.
3. Set new exceptions where you work: on the channel under [Channels](/docs/inbox/channels), on a contact under [Contacts](/docs/inbox/contacts), or in the conversation header in [Communication](/docs/inbox/communication).

A conversation exception lasts until the conversation closes. Channel and contact exceptions stay until you clear them.

## Set safeguards for autonomous replies

1. Open **Safeguards**. Each safeguard turns a single autonomous reply into a draft for review; it never sends more.
2. Set the **Certainty threshold** (1–10, from **permissive** to **strict**). Below that certainty, the reply becomes a draft.
3. Turn on **Review replies to new contacts** to draft instead of send while a contact awaits approval. Website chat visitors are exempt.
4. Turn on **Disclose AI replies** to add a short note to autonomous replies. Change the **Note text** or leave it empty for the default; the preview shows what customers see.
5. Choose **Save** in the bar at the bottom.

The timeline shows a line such as **Drafted instead of sent** with the reason whenever a safeguard applies.

Replies follow the channel. Email gets one structured message. On WhatsApp and website chat the AI writes like a person in a chat: up to five short messages, sent in order with a short typing pause, and the AI note only on the first one. If one message fails to send, the rest wait. In **Assisted**, the draft card holds the same messages so you can remove or edit them before **Send** (see [Decisions](/docs/ai/decisions)).

## Set reply and team language

1. Open **Language** on the same page.
2. **Reply language** is what the customer sees. **Automatic (match the customer)** mirrors the inbound language. You can pin Dutch, English, German, French or Spanish.
3. **Team language** is for notes to your team (summaries, no-reply explanations). It does not change the customer reply.
4. **Approved replies are sent as** is **The approving teammate** or **The AI agent**. That picks the signature and the From display name. On a single draft anyone can still switch **Send as**.
5. Under **Reply language per mailbox**, expand a mailbox to give it its own reply language. Rows with an override show a **Custom** badge.

## When the AI does not reply

- **Manual** is in effect somewhere in the chain, or a teammate took over the conversation.
- Govern caps conversations at Assisted (messaging set to ask) or Manual (messaging denied).
- **Privacy** keeps AI away from message bodies; AI handling then shows Manual.
- The channel's circuit breaker tripped after unusual activity; the channel runs Assisted until someone resumes it.
- The mailbox still needs setup or reconnect. The thread gets an **Internal note** pointing to **Settings → Channels** instead of a draft.

Hover the mode in the conversation header to see which layer decided and why.

The same mode decides who an unknown chatter is. When a visitor gives an email or phone number, **Autonomous** links the conversation to the matching contact (or creates one), **Assisted** links only verified addresses and asks you for the rest, and **Manual** leaves linking to you. See [Link a conversation to a contact](/docs/inbox/contacts).

## What to do next

Load [Knowledge](/docs/ai/knowledge) so drafts stay grounded. Set **Who answers** on [Channels](/docs/inbox/channels) when a channel should skip the workspace default agent — that is routing, not AI handling.

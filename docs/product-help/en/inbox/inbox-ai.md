---
title: Set Inbox AI
intro: Choose when the assistant drafts, sends, or stays quiet on each channel.
description: Configure Inbox AI modes, reply language, send-as and triage so customer drafts appear on your terms.
keywords: inbox ai, drafts, suggest, auto, reply language, send as, certainty
sort: 25
related: communication,autonomy,channels,agents
---

# Set Inbox AI

Inbox AI is the workspace rule for customer replies. Open **Settings**, then **AI reply settings**. This is not Govern: Govern is tools and autonomy; Inbox AI is whether a draft or a send happens when mail or chat arrives.

## Choose a mode per channel

![Inbox AI channel defaults](/api/docs/assets/inbox-ai/draft-mode.png)
*Pick Suggest, Reply automatically, or Off for email, website chat and WhatsApp.*

1. Open **Settings**, then **AI reply settings**.
2. Under **Channel defaults**, set Email, Website chat and WhatsApp separately.
3. Pick one of:
   - **Suggest replies** — the assistant writes a draft card. Your team sends, edits or escalates.
   - **Reply automatically** — the assistant answers on the channel. Take over a thread to pause it.
   - **Off** — people handle every message.
4. Choose **Save**. New inbound work follows the new rule; open threads keep what they already have.

Start with **Suggest replies** on email. Website chat often starts on **Reply automatically**.

## Set language and who sends

1. Stay on Inbox AI. Open the **Language** card.
2. **Reply language** is what the customer sees. **Automatic (match the customer)** mirrors the inbound language. You can pin Dutch, English, German, French or Spanish.
3. **Team language** is for notes to your team (summaries, no-reply explanations). It does not change the customer reply.
4. **Approved replies are sent as** is **The approving teammate** or **The AI agent**. That choice picks whose signature is appended. Anyone can still switch **Send as:** **You** or the agent on a single reply.

## Raise the triage bar

1. Open **Triage** on the same page.
2. Set the **Certainty threshold** (1–10). The scale is marked **permissive**, **balanced** and **strict**.
3. Below that score, triage never bumps a thread to high or urgent. Higher values mean fewer, more reliable priority changes.

## Override one mailbox

1. Connect a mailbox under [Channels](/docs/inbox/channels) first.
2. On Inbox AI, open **Per-mailbox override**.
3. Pick a mailbox and give it its own mode and reply language, or leave **Workspace default**.

## Review a draft before it goes out

1. Open the thread in [Communication](/docs/inbox/communication).
2. Read the suggestion. **Send**, **Edit**, or **Escalate**. Escalate pauses AI on that thread and assigns you.
3. **Take over from AI** also pauses the assistant so you can finish by hand. **Hand back to AI** resumes it.

Nothing customer-facing leaves on **Suggest replies** until you send, unless [Autonomy](/docs/govern/autonomy) later allows more.

## What to do next

Load [Knowledge](/docs/ai/knowledge) so drafts stay grounded. Connect a mailbox under [Channels](/docs/inbox/channels) if the override list is empty.

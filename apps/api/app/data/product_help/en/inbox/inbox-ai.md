---
title: Set Inbox AI
intro: Choose when the assistant drafts, sends, or stays quiet — with workspace defaults and optional mailbox exceptions.
description: Configure Inbox AI modes, reply language, send-as and triage so customer drafts appear on your terms.
keywords: inbox ai, drafts, suggest, auto, reply language, send as, certainty, mailbox exceptions
sort: 25
related: communication,autonomy,channels,agents
---

# Set Inbox AI

Inbox AI is the workspace rule for customer replies. Open **Settings**, then **AI reply settings**. This is not Govern: Govern is tools and autonomy; Inbox AI is whether a draft or a send happens when mail or chat arrives.

Workspace defaults apply first. A mailbox only differs when you set an exception under **Mailbox exceptions**.

## Choose a mode per channel

![Inbox AI channel defaults](/api/docs/assets/inbox-ai/draft-mode.png)
*Pick Suggest, Reply automatically, or Off for email, website chat and WhatsApp.*

1. Open **Settings**, then **AI reply settings**.
2. Under **Workspace defaults** → **How AI responds**, set Email, Website chat and WhatsApp separately.
3. Pick one of:
   - **Suggest replies** — the assistant writes a draft card. Your team sends, edits or escalates.
   - **Reply automatically** — the assistant answers on the channel. Take over a thread to pause it.
   - **Off** — people handle every message.
4. Choose **Save**. New inbound work follows the new rule; open threads keep what they already have.

Start with **Suggest replies** on email. Website chat often starts on **Reply automatically**. If any mailbox overrides email, the Email row shows how many differ.

## Set reply and team language

1. Stay on Inbox AI. Open **Language** under **Workspace defaults**.
2. **Reply language** is what the customer sees. **Automatic (match the customer)** mirrors the inbound language. You can pin Dutch, English, German, French or Spanish.
3. **Team language** is for notes to your team (summaries, no-reply explanations). It does not change the customer reply and has no per-mailbox override.

## Set sending and triage

1. Open **Sending and triage** on the same page.
2. **Approved replies are sent as** is **The approving teammate** or **The AI agent**. That choice picks whose signature is appended and whose name appears as the From display name (the mailbox address stays yours). On a single suggested reply anyone can still switch **Send as:** **You** or the agent. Agents can also set their own default under [Agents](/docs/ai/agents).
3. Set the **Certainty threshold** (1–10). The scale is marked **permissive**, **balanced** and **strict**. Below that score, triage never bumps a thread to high or urgent.

## Override one mailbox

1. Connect a mailbox under [Channels](/docs/inbox/channels) first.
2. On Inbox AI, open **Mailbox exceptions**. Every connected mailbox is listed with its effective mode and reply language.
3. Expand a row. Set mode and reply language, or leave **Workspace default**. Rows with an override show a **Custom** badge.

## Review a draft before it goes out

1. Open the thread in [Communication](/docs/inbox/communication).
2. Read the suggestion. The customer draft and any team **Internal note** stay separate. **Send**, **Edit**, or **Escalate**. Escalate pauses AI on that thread and assigns you.
3. **Take over from AI** also pauses the assistant so you can finish by hand. **Hand back to AI** resumes it.

Nothing customer-facing leaves on **Suggest replies** until you send, unless [Autonomy](/docs/govern/autonomy) later allows more.

## When the channel cannot send yet

If a mailbox still needs setup or reconnect (the same states that disable **Send** in the composer), Inbox AI does not invent a customer draft or auto-reply. The thread gets an **Internal note** that points you to finish setup under **Settings → Email & messages**. Fix the channel, then take over or hand the thread back to AI.

## What to do next

Load [Knowledge](/docs/ai/knowledge) so drafts stay grounded. Connect a mailbox under [Channels](/docs/inbox/channels) if the exceptions list is empty. Use **Who answers** on the same page only when a channel should skip the default agent — that is routing, not AI mode.

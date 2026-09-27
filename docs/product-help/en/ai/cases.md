---
title: How Signals work
intro: A case is typed intake on a conversation — one intent, one case, then a workstream or project if you bind it.
description: Manage signal types in Settings, bind types to workstreams, confirm a visitor when needed, and keep several signals on one conversation.
keywords: signals, cases, intake, conversation, workstream binding, verify, website chat
sort: 46
related: workstreams,communication,widget,projects,integrations
---

# How Signals work

A signal is a typed recognition on a conversation, not a separate inbox item. Signals stay on the conversation that produced them; manage their type catalog under **Settings** → **Signal types**. Every inbound message is read against this catalog before any reply is drafted, so recognition also happens when AI replies are paused.

Each type has an **Outcome**: **Label only** stamps the conversation for reporting, **Track in the queue** keeps accepted signals in the queue until someone closes them, and **Run a playbook** links accepted signals to a playbook. A certain read files the signal straight away; an unsure read becomes a confirm chip on the conversation, and a message that matches no type is counted under **What we missed** instead of inventing a type.

## Add an intake type

1. Open **Settings**, then **Signal types**.
2. Choose **New type**. Under **What it is**, enter a **Name** (for example Refund request) and a description of when it applies — and when it does not. Agents read that text to classify.
3. Under **What we do**, pick **Outcome**: **Label only**, **Track in the queue**, or **Run a playbook**. For playbook types, pick a **Playbook** and optional **Project**. Turn on **Start the playbook right away** when a new accepted signal should start a run without waiting.
4. Under **How it gets filed**, set **When the AI recognizes it** to **Ask customer**, **Ask operator**, **Auto**, or **Manual only**. Set **Audience** to **Customer**, **Internal**, or **Both**.
5. Choose **Add type**. Leave **Enabled** on; turn the switch off when agents should stop opening that type. Deleting a type that already has signals archives it instead of breaking conversation history.

## Bind a type to a workstream

1. Open a playbook, then the **About** card.
2. Under **Accepted intake types**, turn on the types this process should receive.
3. Prefer **Start the playbook right away** on the type when every accepted signal of that type should run. The run input is the signal, not the conversation.
4. The same list exists on a [project](/docs/ai/projects) Settings card when the type should land on that project instead.

## Open a case from website chat

1. A visitor describes something broken in the [website widget](/docs/inbox/widget). The agent calls **create_case** with type **Storing** (Bug report) and a certainty score.
2. If the type asks the visitor, the agent confirms first. If it asks the team, the visitor sees a short status line and you get a decision card in Communication.
3. When exactly one binding is set to auto-link, the case attaches to that workstream. Several bindings pause for you to choose.

## Confirm a visitor before billing data

1. On the Accounting module, turn on **Customer chat tools** when the widget may look up that visitor's own invoices after a short email link.
2. Install the **Factuurvraag** (Billing inquiry) intake type from the module **Intake types** list when you want that type in the workspace. The platform also seeds **Factuur/betaling** (Invoice / payment) for general invoice and payment threads.
3. The agent never says whether an account exists. The visitor gets a link, confirms, and the conversation stays open.

## Confirm or add signals on a conversation

1. Open a conversation in **Communication**. Under **This conversation**, review the signals the system found.
2. An unsure read reads as "Looks like Billing question — confirm?". Choose **Confirm** to turn it into work, or **Dismiss** when the read was wrong. Nothing routes and no playbook starts before you confirm.
3. Choose **Add a signal** (or **Add {{type}}** for a known type) when a second intent appears in the same conversation.
4. Each signal keeps its own status and playbook or project link. Keep distinct intents as distinct signals.

## Turn a missed pattern into a type

1. Open **Settings**, then **Signal types**, and read the **What we missed** card. It lists requests that kept arriving without a matching type, with how often each was seen.
2. Set **Offer a new type after** to how many sightings you want before a pattern shows up as ready.
3. Choose **Make it a type** to create it with the suggested name and description, then set its outcome. Choose **Not a type** to drop it. Agents never create a type themselves.
4. Under **Who may accept signals**, set **Accepting a signal** to **Owners and admins only** or **Anyone in the workspace**. Members can always add a signal they spot themselves.

## What to do next

Set the **Signals** posture on [Govern](/docs/govern/govern) if agents should stop filing intake. Schedule recurring work on the [Agenda](/docs/ai/agenda).

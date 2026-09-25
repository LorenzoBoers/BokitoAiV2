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

Each type has an **Outcome**: **Label only** records the recognition, **Track** keeps it visible on the conversation, and **Run a playbook** routes it into a bound workstream. A certain read files the signal straight away; an unsure read becomes a confirm chip on the conversation, and a message that matches no type is counted under **What we missed** instead of inventing a type.

## Add an intake type

1. Open **Settings**, then **Signal types**.
2. Choose **New type**, give it a name (for example Billing question), and pick **Outcome**: Label only, Track, or Run a playbook.
3. Describe precisely when the type applies — agents follow that description when they classify incoming messages, so also say when it does not apply.
4. Leave the type on. Turn the switch off when agents should stop opening that type.
5. For playbook types, select the workstream that should run, and pick a **Project** when every signal of this type belongs to the same project. Deleting a type that already has signals archives it instead of breaking conversation history.

## Bind a type to a workstream

1. Open a workstream, then the **About** card.
2. Under **Accepted intake types**, turn on the types this process should receive.
3. For a workstream, turn on **Start a run when linked** when a new case should start a run. The run input kind is case, not the conversation.
4. The same list exists on a [project](/docs/ai/projects) Orchestration card when the type should land on that project instead.

## Open a case from website chat

1. A visitor describes a bug in the [website widget](/docs/inbox/widget). The agent calls **create_case** with type **Bug report** and a certainty score.
2. If the type asks the visitor, the agent confirms first. If it asks the team, the visitor sees a short status line and you get a decision card in Messages.
3. When exactly one binding is set to auto-link, the case attaches to that workstream. Several bindings pause for you to choose.

## Confirm a visitor before billing data

1. On the Accounting module, turn on **Customer chat tools** when the widget may look up that visitor's own invoices after a short email link.
2. Install the **Billing inquiry** intake type from the module **Intake types** list when you want that type in the workspace.
3. The agent never says whether an account exists. The visitor gets a link, confirms, and the conversation stays open.

## Confirm or add signals on a conversation

1. Open a conversation in **Communication**. Under **This conversation**, review the signals the system found.
2. An unsure read reads as "Looks like Billing question — confirm?". Choose **Confirm** to turn it into work, or **Dismiss** when the read was wrong. Nothing routes and no playbook starts before you confirm.
3. Choose **Add what we missed** when a second intent appears in the same conversation.
4. Each signal keeps its own status and playbook or project link. Keep distinct intents as distinct signals.

## Turn a missed pattern into a type

1. Open **Settings**, then **Signal types**, and read the **What we missed** card. It lists requests that kept arriving without a matching type, with how often each was seen.
2. Set **Offer a new type after** to how many sightings you want before a pattern shows up as ready.
3. Choose **Make it a type** to create it with the suggested name and description, then set its outcome. Choose **Not a type** to drop it. Agents never create a type themselves.
4. Use **Accepting a signal** on the same page to decide who may confirm a proposed signal: owners and admins only, or anyone in the workspace. Members can always add a signal they spot themselves.

## What to do next

Set the **Signals** posture on [Govern](/docs/govern/govern) if agents should stop filing intake. Schedule recurring work on the [Agenda](/docs/ai/agenda).

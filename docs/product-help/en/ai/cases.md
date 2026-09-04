---
title: How Cases works
intro: A case is typed intake on a conversation — one intent, one case, then a workstream or project if you bind it.
description: Label work that lands in chat, bind types to workstreams, confirm a visitor when needed, and keep several cases on one thread.
keywords: cases, intake, signal, workstream binding, verify, website chat
sort: 46
related: workstreams,communication,widget,projects,integrations
---

# How Cases works

A case is a labelled piece of work on a conversation, not the conversation itself. Open **Workstreams** to manage types, bind them on a workstream or project, and watch them appear in the conversation side panel in [Messages](/docs/inbox/communication).

## Add an intake type

1. Open **Workstreams**.
2. Under **Intake types**, type a name (for example Billing question) and choose **Add type**.
3. Leave the type on. Turn the switch off when agents should stop opening that type.
4. Bind it on a workstream or project next — a type with no binding stays on the conversation.

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

## Keep several cases on one thread

1. Open a conversation in **Messages**. The side panel lists **Cases**.
2. Choose **Add Bug report** or **Add Feature request** when a second intent appears in the same chat.
3. Each case keeps its own status and workstream link. Do not dump two issues into one case.

## What to do next

Set the **Cases** slider on [Govern](/docs/govern/govern) if agents should stop opening intake. Schedule recurring work on the [Agenda](/docs/ai/agenda).

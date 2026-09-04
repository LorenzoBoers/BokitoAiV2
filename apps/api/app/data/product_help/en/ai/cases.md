---
title: How Cases works
intro: A case is typed intake on a conversation — one intent, one case, then a workstream or project if you bind it.
description: Manage intake types and the case queue on the Cases page, bind types to workstreams, confirm a visitor when needed, and keep several cases on one thread.
keywords: cases, intake, signal, queue, workstream binding, verify, website chat
sort: 46
related: workstreams,communication,widget,projects,integrations
---

# How Cases works

A case is a labelled piece of work on a conversation, not the conversation itself. The **Cases** page in the sidebar (under Control) holds the queue of open cases and the catalog of intake types. Cases replace the old conversation tags: agents classify inbound messages against your type catalog and open a case instead of a tag.

## Work the case queue

1. Open **Cases**. The **Queue** tab lists every case with its type, title, conversation subject, age and status.
2. Use the status pills — **Needs you**, **Open**, **Waiting**, **Linked** and **Done** — to focus on what needs a decision first. The search field matches title, summary and type name; type chips narrow to one intake type.
3. Click a row for the detail panel: change the status, edit the title or summary, or link the case to a workstream or project.
4. Choose **Open thread** to jump to the conversation in [Messages](/docs/inbox/communication). Closing a case never closes the conversation — they live independently.
5. Move through rows with **J**/**K** and open one with **Enter**.

## Add an intake type

1. Open **Cases**, then the **Types** tab.
2. Choose **New type** and give it a name (for example Billing question).
3. Describe precisely when the type applies — agents follow that description when they classify incoming messages, so also say when it does not apply.
4. Leave the type on. Turn the switch off when agents should stop opening that type.
5. Bind it on a workstream or project next — a type with no binding stays on the conversation as a status label only.

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

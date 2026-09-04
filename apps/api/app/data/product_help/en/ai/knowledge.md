---
title: How Knowledge works
intro: Markdown the workspace owns across organization, project, and agent scopes. This is the brief agents carry.
description: Browse Knowledge as a hub for org, project, and agent docs, edit in Write or Markdown mode, and publish customer help articles.
keywords: knowledge, docs, voice, memory, skills, help center, grounding, project documentation
sort: 30
related: agents,communication,projects,workstreams
---

# How Knowledge works

Knowledge is what agents read on every run. Open **Knowledge** to manage organization, project, and agent-scoped documents in one hub — not a private wiki.

## Pick a scope

![Knowledge page](/api/docs/assets/knowledge/add-doc.png)
*Filter by workspace, project, or agent name — each chip is a real entity.*

1. Open **Knowledge**.
2. Click your **workspace name** (default), a **project name**, or an **agent name** in the chip row. Creating a document in that scope stores it on the same `WorkspaceDoc` table Project Documentation uses.

Organization still groups kinds:

- **Voice** — how you sound. Tone, phrases to use or avoid.
- **Memory** — long-term facts the workspace should remember. Agents update this as they learn.
- **Skills** — procedures: how to refund, how to escalate, how to book.
- **Docs** — reference pages (pricing, policy, product facts). Only this kind can be published to a help center.
- **Project docs** — documents scoped to a project (also editable on the project's Documentation tab).
- **Check-ins** — recurring heartbeat checklists. Agents write here when a scheduled check finds something.
- **Daily notes** — short logs agents keep. You read them; you rarely author them.

Memory, check-ins and daily notes are AI-maintained. Edit them when a fact is wrong; do not treat them as a second wiki.

## Add or edit a document

1. Open **Knowledge**. An empty library offers **Create first document** and a drop zone for a PDF or Word file. Use **Search knowledge** (Enter or **Search**) when the list is long, or **Clear search** to browse again. Kind chips filter the sidebar.
2. Choose **New document**, type a title (the path is generated), then **Add**. Or use **Upload a document (PDF, Word, text)**.
3. Choose **Edit**. The editor opens in **Write** (WYSIWYG) by default; switch to **Markdown** for the raw source. Content always saves as markdown.
4. **Save** or press Ctrl/Cmd+S. Leaving with unsaved edits asks you to confirm. Click the document path to copy it. **Publish** asks if the article should appear on the public help site. **Delete document** removes a page you no longer want.

Active queue requests linked to a document show as subtle chips under the title. Request status lives on the queue item, not on the document.

## Work per section

A document is a page built from `##` sections; each section is the atomic unit agents read, search, and edit — one topic, roughly 150 to 400 words.

1. Open a document and expand **Sections**. Each section shows its heading, content, and a status chip: **Draft**, **Review**, or **Final**.
2. Edit one section without touching the rest of the page. Add a section for a new topic instead of growing an existing one.
3. Set the status per section. A section an agent writes during a workstream run moves to **Review**; approving the run's gate promotes it to **Final**. Only set **Final** yourself when you verified the content.

## Ground a draft

1. Add the pages your team already uses: pricing, policies, product facts.
2. Open a thread in [Communication](/docs/inbox/communication).
3. Drafts improve once a handful of documents exist. Inbox AI still follows [Inbox AI](/docs/inbox/inbox-ai); Knowledge only grounds the wording.

## Publish customer help

1. Open a **Docs** article.
2. Choose **Publish**. Confirm the public help site prompt.
3. Share the help URL with customers. Unpublish when the article should leave the public site.

## What to do next

Keep project-specific docs on the [Projects](/docs/ai/projects) Documentation tab — they appear under Knowledge when you click that project name. Point agents at Skills and Memory so replies stay grounded.

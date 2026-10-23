---
title: How Knowledge works
intro: Markdown the workspace owns across organization, folder, and agent scopes. This is the brief agents carry.
description: Browse Knowledge as a hub for org, folder, and agent docs, edit in Write or Markdown mode, and publish customer help articles.
keywords: knowledge, docs, voice, memory, skills, help center, grounding, folder documentation
sort: 30
related: agents,communication,folders,flows
---

# How Knowledge works

Knowledge is what agents read on every run. Open **Knowledge** to manage organization, folder, and agent-scoped documents in one hub — not a private wiki.

## Pick a scope

![Knowledge page](/api/docs/assets/knowledge/add-doc.png)
*Each chip is a real entity, labeled Platform, Folder, or Agent.*

1. Open **Knowledge**.
2. Click your **workspace name** (default, marked **Platform**), a **folder name**, or an **agent name**. Creating a document in that scope stores it on the same `WorkspaceDoc` table Folder Documentation uses.
3. With a folder or agent selected, **Open folder** or **Open agent** appears under the chips and takes you to that folder page or agent page, so documentation and the work it belongs to stay one click apart.

The sidebar groups documents by the kinds that are actually present — for example Voice, Memory, Skills, Docs, Check-ins, or Daily notes when those exist. Empty kinds stay hidden. Memory, check-ins and daily notes are AI-maintained: edit them when a fact is wrong; do not treat them as a second wiki.

## Add or edit a document

1. Open **Knowledge**. An empty library offers **Create first document** and a drop zone for a PDF or Word file. Use **Search knowledge** (Enter or **Search**) when the list is long, or **Clear search** to browse again.
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
3. Drafts improve once a handful of documents exist. Whether drafts appear still follows [Autonomy](/docs/inbox/inbox-ai); Knowledge only grounds the wording.

## See the platform skills

1. Under **Platform skills**, Knowledge lists the skills that come with Bokito, such as **Labels**, each with a lock.
2. Hover a skill to read what it covers. Agents use it when their work calls for it, for example when they label conversations.
3. Platform skills apply to every workspace. You cannot open or edit them; add your own conventions as a **Skill** document instead.

## Publish customer help

Customer help articles live in Knowledge, not under a separate **Help center** settings page (that sidebar link redirects here).

1. Open a **Docs** article.
2. Choose **Publish**. Confirm the public help site prompt.
3. Share the help URL with customers. Unpublish when the article should leave the public site.

## Review a draft lesson

A draft lesson is a section an agent took from a correction, a customer reply or a finished turn. It applies to the whole workspace. Labels decide when it ranks first. It becomes final when you confirm it, or when the same lesson shows up in a second conversation on the same label.

1. Open Knowledge and choose the **Draft lessons** chip.
2. Read the heading, the label and how many conversations support it. Open the conversation it came from.
3. Set the section to **Final** when the rule is right, or choose not to keep it on the card in that conversation.

## What to do next

Keep folder-specific docs on the department's folder tab ([Workforce](/docs/getting-started/team)) — they appear under Knowledge when you click that name (the chip still reads **Folder**). Point agents at Skills and Memory so replies stay grounded.

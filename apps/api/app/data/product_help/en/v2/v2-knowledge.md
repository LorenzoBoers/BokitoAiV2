---
title: Knowledge in V2
intro: Documents, skills and memory the agents read; indexed the moment you save.
description: Add V2 knowledge documents in Markdown, pick a kind such as skill or snippet, search what agents can see, and let agents maintain documents themselves under policy.
keywords: v2, knowledge, documents, skill, persona, memory, snippet, search, markdown, rag
sort: 50
related: v2-work,v2-communication,v2-developers
---

# Knowledge in V2

**Knowledge** is what agents read before they answer: policies, prices, procedures, tone of voice. Documents are Markdown, indexed for agents as soon as they are saved, and also available to MCP clients as resources.

## Add a document

1. Open **Knowledge** and press **New document**.
2. Fill in **Title**. **Path** is optional and defaults to a slug of the title.
3. Pick a **Kind**: **Document** for facts and procedures, **Skill** for how an agent should do one task, **Persona** for tone of voice, **Snippet** for reusable text, **Memory** for what agents learned.
4. Write the **Body** in Markdown and save.
5. The document is **Published** and indexed. Agents use it in the next reply.

## Find what agents can see

1. Type in **Search knowledge**.
2. Filter on kind with **All** or one of the kinds.
3. Open a hit to read the document exactly as an agent reads it.
4. Documents tagged **Maintained by agents** were written or updated by an agent through the `write_doc` tool under policy; edit them like any other document.

## Documents from modules

Installing a module adds its skill documents, for example how to answer an invoice question with the connected ledger. They are tagged with the module name and disabled again when the module is uninstalled.

## What to do next

- Give the default agent a persona and see the difference in the next thread: [/docs/v2/v2-work](/docs/v2/v2-work)
- Read documents from an MCP client as `bokito://docs/{path}`: [/docs/v2/v2-developers](/docs/v2/v2-developers)

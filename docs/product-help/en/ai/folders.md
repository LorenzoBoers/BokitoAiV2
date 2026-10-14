---
title: How Folders works
intro: A folder is a saved tag filter — conversations that carry every tag in the set land here, with canvas, docs and boards on the same hub.
description: Create maps as AND tag filtersets, nest by adding tags, open matching conversations, and keep canvas and docs on the folder hub.
keywords: folders, maps, tags, filterset, canvas, tickets, flows, boards, documentation, communication, nest
sort: 40
related: workstreams,categories,agenda,knowledge,communication
---

# How Folders works

A folder is a saved set of tags. A conversation matches when it has **every** tag in that set (including tags inherited from the contact). The same conversation can appear in several folders; narrower sets nest under broader ones in the rail. Open **Folders** for the hub: conversations, tickets, canvas, docs and files. There is no per-folder agent, budget or repository.

## Create or open a folder

![Projects list](/api/docs/assets/folders/project.png)
*Each card is a tag set (for example `#2026 · #facturen`) with open work.*

1. Open **Folders**. The left menu shows the derived tree (narrower maps under broader ones). Choose **New folder**, then pick or create the tags that define the filter — there is no separate name.
2. While you pick tags, the dialog shows the full filterset and whether the new map **comes under** an existing broader map.
3. Open a card. You land on **Overview**. Admins change the tag set in place (broader tags stay locked when the map already sits under another). Members can read; they cannot delete.

## Create a narrower map under this one

1. Open a folder, then choose **New folder**.
2. Tags from the open map stay required (locked). Add one or more **extra tags** — those extras are what the tree row shows under the parent.
3. Confirm. Conversations match only when they carry every tag of the new set. The map appears under the broader one in Folders and in Communication **What**.

## Nest a map under a broader one

1. On **Folders**, drag a map over the **right half** of another row (or use **Nest** in the folder menu). The **left half** of the tree only changes order among siblings.
2. Read the preview: the result filterset and which broader map it will sit under. If the maps shared no tags, confirm the warning — matching conversations must then also carry the broader tags.
3. Confirm **Nest**. Use **Undo** on the toast, or Ctrl/Cmd+Z, to reverse the last nest, reorder, unnest, or tag move.

## Move a map or tag to the top level

1. On **Folders**, drag a nested map (or a single tag chip) onto the **Top level** zone that appears above the tree.
2. A nested map drops its broader tags and sits next to the other root maps. A tag leaves the source filterset; if no top-level map exists for that tag alone, Bokito creates one.
3. Use **Undo** on the toast, or Ctrl/Cmd+Z, if you need to reverse it.

## Move a single tag between maps

1. On **Folders**, hover a tag in a tree row — it gets a pill so you see it is separate from the others on that row.
2. Drag that tag onto another folder (or its **Nest** zone), or onto **Top level**. The tag leaves the source filterset and joins the target. A folder always keeps at least one tag.
3. Use **Undo** on the toast, or Ctrl/Cmd+Z, if you need to reverse it.

## Read the Overview

1. The header shows the full filter tags (`#2026 · #facturen`). Tree rows show only the tags that are new versus the parent. **Open in Communication** jumps to the same filter in the Communication rail.
2. Hover a tree row for the full set and **Under:** the broader map.
3. **Recent conversations** lists matches; **All conversations** opens the Conversations tab. Canvas, docs and files stay on this hub when you use them.

## See conversations in a folder

1. Open the **Conversations** tab, or use **Folders** in Communication. Empty maps stay hidden in the rail until they have open work or you pin them.
2. Each row is a conversation that carries every tag of this map. Filing a conversation into a map adds those tags.
3. Contact tags apply automatically (shown as inherited); they are not copied onto the thread.

## Move a ticket on a board

![Flow boards on a project](/api/docs/assets/folders/boards.png)
*One board per flow on the folder, with that flow's stages as columns.*

1. Open the **Tickets** tab when flows are linked to this folder.
2. Drag a card to another column to change the stage. Click a card to open it in [Communication](/docs/inbox/communication).
3. Flows stay the action-tag axis; a folder only filters which tickets you see. See [Flows](/docs/ai/workstreams) and [Action tags](/docs/ai/categories).

## Ask an agent to write a canvas

1. Open the **Canvas** tab and choose **Add canvas**. Pick the agent who will own it.
2. That opens a conversation: the agent asks what you want to see, proposes a short plan (title, widgets, refresh), then builds the snapshot and sets the refresh cadence. Keep talking in that thread to change it. Workspace canvases also live on Overview **Canvas**.

## Track documentation

1. Open the **Documentation** tab for docs scoped to this folder. Create or edit like Knowledge; agents only change project docs inside a [flow](/docs/ai/workstreams) run.
2. Choose **Open in Knowledge hub** to edit the same document under Knowledge.

## Agenda and the rail

1. In Communication and Agenda **What**, maps share one derived `#` tree with the same local labels and full-set tooltips as Folders.
2. Pin a row to keep it visible; hide empty ones with the row menu. Agenda filters by the selected map's tags. Clear the chip in the header to see everything again.

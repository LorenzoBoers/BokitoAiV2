---
title: How Folders works
intro: A folder is a named place in your tree with optional label rules — matching conversations land here, with canvas, docs and boards on the same hub.
description: Create named folders, nest them freely, set label rules for membership, file conversations, and keep canvas and docs on the folder hub.
keywords: folders, maps, labels, tags, filterset, canvas, tickets, flows, boards, documentation, communication, nest
sort: 40
related: workstreams,categories,agenda,knowledge,communication
---

# How Folders works

A folder has a **name** and a place in a free tree. Optional **labels** decide which conversations match: one of those labels on the conversation is enough. Nesting only changes the tree — labels stay the same. Open **Folders** for the hub: conversations, tickets, canvas, docs and files. There is no per-folder agent, budget or repository.

## Create or open a folder

![Projects list](/api/docs/assets/folders/project.png)
*Each card is a folder with open work.*

1. Open **Folders**. The left menu shows the tree. Choose **New folder**, give it a name, and optionally pick labels that define membership.
2. Confirm. The folder appears in the tree at the root (or under a parent if you chose one).
3. Open a card. You land on **Overview**. Admins hover the folder name: it becomes a pill with a pencil, and a click renames the folder. Labels sit in one field beside the name; **+** adds labels, and the cross on a pill removes it. Members can read; they cannot delete.

## Nest a folder under another

1. On **Folders**, drag a folder. The list stays put. A line shows where it will land: move up or down to change the place, further right to nest one level deeper, further left to move up a level. Release to move it. **New folder** (the plus next to search) creates a folder at the top.
2. Drop when it sits where you want. Labels do not change — only the tree position does.
3. Use **Undo** on the toast, or Ctrl/Cmd+Z, to reverse the last nest, reorder, or unnest.

## Move a folder to the top level

1. On **Folders**, drag a nested folder further left until it sits at the level you want. Far enough left, it becomes a top-level folder.
2. The folder sits among the other root folders. Its labels stay the same.
3. Use **Undo** on the toast, or Ctrl/Cmd+Z, if you need to reverse it.

## Move a single label between folders

1. On **Folders**, hover a label in a tree row — it gets a pill so you see it is separate from the others on that row.
2. Drag that label onto another folder, or onto **Top level**. The label leaves the source set and joins the target.
3. Use **Undo** on the toast, or Ctrl/Cmd+Z, if you need to reverse it.

## File a conversation in a folder

1. Open the conversation in [Communication](/docs/inbox/communication).
2. Use **File in folder** (or close-and-file) and pick the folder. Bokito applies that folder's labels to the thread.
3. The conversation then matches that folder (and any others whose labels it also carries).

## Read the Overview

1. The header shows the folder name and the label field with its pills beside it. **Open in Communication** jumps to the same scope in the Communication rail.
2. Hover a tree row for the labels and **Under:** the parent folder when nested.
3. **Flows** shows each board that already has a ticket on a conversation in this folder (or a folder under it) — stages as columns, tickets as cards. Drag a card to change stage, or open the **Tickets** tab for the same board. **Recent conversations** lists the matches; **All conversations** opens the Conversations tab. What an agent did stays in that conversation. Canvas, docs and files stay on this hub when you use them.

## See conversations in a folder

1. Open the **Conversations** tab, or use **Folders** in Communication. All maps appear in the rail, including empty ones.
2. Each row matches this folder or a folder nested under it (by labels or by filed home). Filing a conversation into a map adds those labels.
3. Contact labels apply automatically (shown as inherited); they are not copied onto the thread.

## Move a ticket on a board

![Flow boards on a project](/api/docs/assets/folders/boards.png)
*One board per flow on the folder, with that flow's stages as columns.*

1. Open the folder on **Overview**, or the **Tickets** tab.
2. Drag a card to another column to change the stage. Click a card to open it in [Communication](/docs/inbox/communication).
3. Flows stay the flow label axis; the folder only shows flows that already have matching tickets here. See [Flows](/docs/ai/workstreams) and [Labels with a flow](/docs/ai/categories).

## Ask an agent to write a canvas

1. Open the **Canvas** tab and choose **Add canvas**. Pick the agent who will own it.
2. That opens a conversation: the agent asks what you want to see, proposes a short plan (title, widgets, refresh), then builds the snapshot and sets the refresh cadence. Keep talking in that thread to change it. On the canvas toolbar the owner agent shows as avatar and name next to the last-updated time and refresh period; use the refresh icon, or delete via the **⋯** menu. Workspace canvases also live on Overview **Canvas**.

## Track documentation

1. Open the **Documentation** tab for docs scoped to this folder. Create or edit like Knowledge; agents only change project docs inside a [flow](/docs/ai/workstreams) run.
2. Choose **Open in Knowledge hub** to edit the same document under Knowledge.

## Agenda and the rail

1. In Communication and Agenda **What**, maps share one `#` tree with the same structure as Folders.
2. Counts and filters follow the folder subtree you select.

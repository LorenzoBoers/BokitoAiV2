---
title: How Folders works
intro: A folder is a named place in your tree with optional label rules — matching conversations land here, with canvas, docs and boards on the same hub.
description: Create named folders, nest them freely, set label rules for membership, file conversations, and keep canvas and docs on the folder hub.
keywords: folders, maps, labels, tags, filterset, works in, general, canvas, tickets, flows, boards, documentation, communication, nest
sort: 40
related: flows,categories,agenda,knowledge,communication
---

# How Folders works

A folder has a **name** and a place in a free tree. Optional **labels** decide which conversations match: one of those labels on the conversation is enough. Nesting only changes the tree — labels stay the same. Open **Folders** for the hub: conversations, tickets, canvas, docs and files. There is no per-folder agent, budget or repository.

## Create or open a folder

![Folders list](/api/docs/assets/folders/project.png)
*Each card is a folder with open work.*

1. Open **Folders**. The left menu shows the tree. Choose **New folder**, give it a name, and optionally pick labels that define membership.
2. Confirm. The folder appears in the tree at the root (or under a parent if you chose one). Its card counts open and closed conversations in the folder and the folders under it, the same number as on the Communication rail. A folder without a name shows the labels that set it apart from its parent, or **Unnamed folder**.
3. Open a card. You land on **Today**. Admins hover the folder name: it becomes a pill with a pencil, and a click renames the folder. Labels sit in one field beside the name; **+** adds labels, and the cross on a pill removes it. Members can read; they cannot delete.

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

## Read Today

1. The header shows the folder name and the label field with its pills beside it. **Open in Communication** jumps to the same scope in the Communication rail. **Who works here** names the department the folder belongs to, marked **Home department of this folder**, and every department with open tickets in it or its subfolders. Choose one to open its department page.
2. Hover a tree row for the labels and **Under:** the parent folder when nested.
3. **Flows** shows each board that already has a ticket on a conversation in this folder (or a folder under it) — stages as columns, tickets as cards. Drag a card to change stage, or open the **Tickets** tab for the same board. **Recent conversations** lists the matches; **All conversations** opens the Conversations tab. What an agent did stays in that conversation. Canvas, docs and files stay on this hub when you use them.

## Add a place to Works in

**Works in** sits at the top of **Today** and lists every place where work from this folder lands: the board and files (in Bokito, once they hold something), each canvas (in Bokito), and connections or file folders outside Bokito.

1. Open the folder. Each card shows its name and whether it lives in **Bokito** or is a **Connection**; a click opens it.
2. Admins choose **Add to Works in** and pick **Canvas**, **Connection** or **File folder**.
3. For a canvas, give it a name; for a connection, pick one of the active connections; for a file folder, give a name and the URL or folder id. Choose **Add**.
4. A connection or file folder leaves Works in with the bin icon on its card. Work that has no folder lands in the folder **General**; installing the Accounting module creates the folder **Administration** with its connection, or a canvas **Figures** when none is connected yet.
5. When an agent writes through a connection, updates a canvas, or a coding tool finishes a pull request for this folder, the conversation shows **Delivered in {folder} › {place}**; a click opens that place. A connection that sits in no folder delivers nothing and shows up as an issue instead.

## See conversations in a folder

1. Open the **Conversations** tab, or use **Folders** in Communication. All maps appear in the rail, including empty ones.
2. Each row matches this folder or a folder nested under it (by labels or by filed home). Filing a conversation into a map adds those labels.
3. Contact labels apply automatically (shown as inherited); they are not copied onto the thread.

## Move a ticket on a board

![Flow boards on a folder](/api/docs/assets/folders/boards.png)
*One board per flow on the folder, with that flow's stages as columns.*

1. Open the folder on **Today**, or the **Tickets** tab.
2. Drag a card to another column to change the stage. Click a card to open it in [Communication](/docs/inbox/communication).
3. Flows stay the flow label axis; the folder only shows flows that already have matching tickets here. See [Flows](/docs/ai/flows) and [Labels with a flow](/docs/ai/categories).

## Ask an agent to write a canvas

1. Open the **Canvas** tab and choose **Add canvas**. Pick the agent who will own it.
2. That opens a conversation: the agent asks what you want to see, proposes a short plan (title, widgets, refresh), then builds the snapshot and sets the refresh cadence. Keep talking in that thread to change it. Above the canvas the owner agent shows as avatar and name next to the last-updated time and refresh period. The canvas sits in a window: its title bar names the kind and version and holds **Preview** / **Code**, copy, download, refresh, and the **⋯** menu with **Delete**. Every canvas lives in a folder; it also shows under **Works in**. Only a **Dashboard** has a refresh period.

## Keep more than a dashboard on a canvas

A canvas belongs to its conversation. The folder of that conversation is where the canvas shows on the Canvas tab (including subfolders). That conversation can hold several canvases. The agent picks the kind: **Document** (a report in Markdown), **Diagram** (a Mermaid flow), **Drawing** (an SVG, which may include a picture stored in Bokito), **Image** (a generated picture kept with the conversation), **Code** (a script you can download), **Email** (a letter with subject and body), or **Sheet** (a table). Logo and colours stay in Settings. A short answer stays in the chat.

1. In the canvas conversation, ask for the piece, for example a diagram, a picture to keep, or a table.
2. Open the **Canvas** tab, or the window under the agent's reply. The title bar shows the kind. Every kind uses the same window; the expand icon opens the canvas beside the conversation. The conversation stays on the left, the canvas fills the right, and the divider between them can be dragged. Close returns to the conversation.
3. Use the download icon in the title bar. A document downloads as Markdown, a diagram as Mermaid, a drawing as SVG, code as its file type. On a sheet, choose **CSV**, **Excel**, or **Google Sheets**. CSV and Excel download a file. Google Sheets creates a spreadsheet in the connected Google Drive and opens it. Connect Google Drive under Connections when that export asks for it.
4. Change it in that same conversation. The canvas does not get a second conversation.

## Track documentation

1. Open the **Documentation** tab for docs scoped to this folder. Create or edit like Knowledge; agents only change folder docs inside a [flow](/docs/ai/flows) run.
2. Choose **Open in Knowledge hub** to edit the same document under Knowledge.

## Keep a content calendar for a client

Planned posts are items in the client's folder, and Bokito keeps a Google Sheet in step with them.

1. Connect **Google Drive** under [Connections](/docs/integrations/integrations). In the folder, add the client's sheet to **Works in** as a **Spreadsheet**. Bokito writes to the tab **Kalender**.
2. Ask an agent to plan the posts, or let a `#maandcontent` ticket do it. Each post becomes an item with a date, channel, caption and image.
3. When a post is added, changed or moves on, the sheet gets the whole calendar again: date, channel, caption, image, status and title. Edits in the sheet are not read back.
4. On a workspace set to **Manual**, the sheet only updates when you ask for it in a conversation.

## Plan posts on a content calendar

A client folder holds its posts as items, and Bokito keeps a Google Sheet in step with them.

1. Connect **Google Drive** under [Connections](/docs/integrations/integrations). In a conversation, ask an agent to add the Google Sheet of the content calendar to the folder, for example: **Add this sheet as the content calendar of Klanten/Studio Veluwe** with the sheet link. It shows in **Works in** as a **Spreadsheet**. Bokito writes to the tab **Kalender** unless you name another tab.
2. An agent on a content ticket adds each post as an item in the folder, with date, channel, caption and image.
3. Each time a post is added, changed or moved, the sheet is rewritten with every post of the folder: date, channel, title, caption, image and status.
4. With the workspace on Manual, the sheet only changes when you ask an agent to update it. Publishing stays with a person.

## Agenda and the rail

1. In Communication and Agenda **What**, maps share one `#` tree with the same structure as Folders.
2. Counts and filters follow the folder subtree you select.

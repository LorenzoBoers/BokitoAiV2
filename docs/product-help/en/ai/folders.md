---
title: How Folders works
intro: A folder is a container in your tree. It lists the subfolders, conversations, images, files and canvases that belong there.
description: Create named folders, nest them freely, set label rules for membership, and find what is inside with search, type tabs and a label filter.
keywords: folders, maps, labels, tags, filterset, search, canvases, files, images, conversations, nest
sort: 40
related: flows,categories,agenda,knowledge,communication
---

# How Folders works

A folder has a **name** and a place in a free tree. Optional **labels** decide which conversations match: one of those labels on the conversation is enough. Nesting only changes the tree — labels stay the same. The folder page lists what is inside: subfolders, conversations, images, files and every canvas kind. Flow boards, the agenda, Works in and folder docs live on the department's folder tab. See [Workforce](/docs/getting-started/team).

## Create or open a folder

![Folders list](/api/docs/assets/folders/project.png)
*Each card is a folder with open work.*

1. Open **Folders**. The left menu shows the tree. Choose **New folder**, give it a name, and optionally pick labels that define membership.
2. Confirm. The folder appears in the tree at the root (or under a parent if you chose one). Its card counts open and closed conversations in the folder and the folders under it, the same number as on the Communication rail. A folder without a name shows the labels that set it apart from its parent, or **Unnamed folder**.
3. Open a card. Admins hover the folder name: it becomes a pill with a pencil, and a click renames the folder. Labels sit in one field beside the name; **+** adds labels, and the cross on a pill removes it. Members can read; they cannot delete. **Open in Grid** and the more menu (copy id, nest, delete) stay in the header.

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

## Find something in a folder

1. Open the folder. The search field above the list matches a conversation subject or contact, a file name, or a canvas title.
2. **All (n)** lists subfolders first, then everything else by last activity. A count above 99 shows as **99+**. Other tabs appear only when that kind is present: **Conversations**, **Images**, **Files**, **Folders**, and one tab per canvas kind (Sheet, Dashboard, Document, and the rest).
3. Open a row. A conversation opens in Communication, in this folder. A canvas opens on this page. Under a canvas title the row names the kind, for example **Diagram**, so it does not look like the conversation that shares that name. An image or file opens its file, with a **Conversation** link back to the thread it came from. **Load more** fetches the next page.

## Filter by label

1. Choose **Labels**. The menu lists only labels that occur on conversations in this folder.
2. Tick one or more. The list keeps items whose conversation carries every ticked label. Images, files and canvases follow the conversation they belong to.
3. Clear a tick to widen the list again.

## Switch rows, cards and sheet

1. Next to search, choose **Rows**, **Cards** or **Sheet**. Rows are one list with the name, labels and time in fixed columns. Cards are a grid; images show a larger preview. Sheet is a table with kind, details, channel, status, labels and when it was updated.
2. The choice stays in the address bar and is remembered the next time you open a folder.
3. Admins see **New folder** with the subfolders. That creates a folder underneath this one.

## Ask an agent to write a canvas

1. Open a canvas from the folder list, then choose **Add canvas** in the viewer. Pick the agent who will own it. New places where work lands (a connection or a file folder) are added on the department's folder tab, under **Works in**. See [Workforce](/docs/getting-started/team).
2. That opens a conversation: the agent asks what you want to see, proposes a short plan (title, widgets, refresh), then builds the snapshot and sets the refresh cadence. Keep talking in that thread to change it. A dashboard is the picture: charts, stats and tables. The agent does not paste that into the chat. It picks a recipe that fits the question (overview, trend, breakdown, comparison or report). A dashboard opens with a heading that states the finding, then a row of key figures with their change, target or status, then the chart that explains it, and the detail table last. Bokito arranges the columns itself, so a dashboard looks the same in the side panel and full screen.
3. Tap a figure, or the title of a chart, pie or table, to show the read that produced it and the time. When the figure is one you typed, it says **This message**. The figure is underlined. **More actions** on a dashboard copies or downloads those figures as text. The title bar names the kind, the owner, when it was updated, and the folder. When the conversation is not in a folder, it says **Not in a folder**. Beside the conversation, **Update** puts a sentence in the message field so you can ask the agent to change the canvas. **More actions** holds download, copy, **Show source** and **Delete**. A sheet shows the row count and lines number columns up on the right. On the folder page the owner and the time sit above the window, and **Open conversation** sits on the right. **Refresh** is in **More actions**. **Back to folder** returns to the list. Only a **Dashboard** has a refresh period.

## Keep more than a dashboard on a canvas

A canvas belongs to its conversation. The folder of that conversation is where the canvas shows in the list (including subfolders). That conversation can hold several canvases. The agent picks the kind: **Document** (a report in Markdown), **Diagram** (a Mermaid flow), **Drawing** (an SVG, which may include a picture stored in Bokito), **Image** (a generated picture kept with the conversation), **Code** (a script you can download), **Email** (a letter with subject and body), **Sheet** (a table), or **Design** (frames you drag and resize). Logo and colours stay in Settings. A short answer stays in the chat. Every edit keeps the previous version, for every kind.

1. In the canvas conversation, ask for the piece, for example a diagram, a picture to keep, or a table.
2. Open the canvas from the folder list, or click the card under the agent's reply. The title bar shows the kind. The conversation stays on the left, the canvas fills the right, and the divider between them can be dragged. **Update** fills the message field. **More actions** includes **Delete**, which moves the canvas to the Bin and stops its Agenda refresh. Close returns to the conversation.
3. Download lives in **More actions**. A document downloads as Markdown, a diagram as Mermaid, a drawing as SVG, code as its file type. On a sheet, choose **CSV**, **Excel**, or **Google Sheets**. CSV and Excel download a file. Google Sheets creates a spreadsheet in the connected Google Drive and opens it. Connect Google Drive under Connections when that export asks for it.
4. Change it in that same conversation. The canvas does not get a second conversation. **More actions** shows **Versions**. The current version sits at the top. Choose an earlier version to bring it back; that becomes the newest version, and the number keeps climbing.
5. On a **Design**, drag a frame by its grip and resize it from the edges. Type the title and the text on the frame. **Update** on the frame puts a sentence in the message field about that frame. Or ask the agent in the conversation; each edit is a version again.

## Keep a content calendar for a client

Planned posts are items in the client's folder, and Bokito keeps a Google Sheet in step with them.

1. Connect **Google Drive** under [Connections](/docs/integrations/integrations). In the folder, add the client's sheet to **Works in** as a **Spreadsheet**. Bokito writes to the tab **Kalender**.
2. Ask an agent to plan the posts, or let a `maandcontent` ticket do it. Each post becomes an item with a date, channel, caption and image.
3. When a post is added, changed or moves on, the sheet gets the whole calendar again: date, channel, caption, image, status and title. Edits in the sheet are not read back.
4. On a workspace set to **Manual**, the sheet only updates when you ask for it in a conversation.

## Plan posts on a content calendar

A client folder holds its posts as items, and Bokito keeps a Google Sheet in step with them.

1. Connect **Google Drive** under [Connections](/docs/integrations/integrations). In a conversation, ask an agent to add the Google Sheet of the content calendar to the folder, for example: **Add this sheet as the content calendar of Klanten/Studio Veluwe** with the sheet link. It shows in **Works in** as a **Spreadsheet**. Bokito writes to the tab **Kalender** unless you name another tab.
2. An agent on a content ticket adds each post as an item in the folder, with date, channel, caption and image.
3. Each time a post is added, changed or moved, the sheet is rewritten with every post of the folder: date, channel, title, caption, image and status.
4. With the workspace on Manual, the sheet only changes when you ask an agent to update it. Publishing stays with a person.

## Agenda and the rail

1. In Communication and Agenda **What**, maps share one label tree with the same structure as Folders.
2. Counts and filters follow the folder subtree you select.

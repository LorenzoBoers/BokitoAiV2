---
title: Connect channels
intro: Bring customer mail and other inboxes into Communication.
description: Add channels in one list, create a Bokito address, connect Gmail, Outlook, SMTP/IMAP or WhatsApp, read each channel's state and checks, and pause or remove a channel.
keywords: channels, gmail, outlook, smtp, imap, mailbox, bokito address, relay, channel state, routing, signature, pause channel
sort: 20
related: communication,inbox-ai,widget,integrations
---

# Connect channels

Channels are how customers reach the workspace. Open **Settings**, then **Channels**. Every channel — mailbox, Bokito address, website chat, WhatsApp, Slack — is one row with its name, how AI handles it, and one state. Click a row to open its settings: the same **Status**, **General** and **Manage** sections for every channel, plus one section with what only that kind has. A new workspace starts with the website chat only, so add an email channel before you expect mail.

## Add a channel

![Channel settings with an opened channel](/api/docs/assets/channels/mailbox-status.png)
*Each row shows the AI handling mode and state; the opened row shows Status, General, the kind section and Manage.*

1. Open **Settings**, then **Channels**.
2. Choose **Add channel**.
3. Pick **Email**, **WhatsApp Business**, **Website chat**, or **Slack workspace**. **Email** opens a second step with **Gmail**, **Outlook**, **SMTP / IMAP** and **Bokito address**.
4. Finish the form for that choice. The new row appears in the **Channels** list.

## Connect SMTP / IMAP

Use this when your provider has no Gmail or Outlook OAuth card (for example Hostinger, cPanel, or a custom domain mailbox).

1. Choose **Add channel**, then **Email**, then **SMTP / IMAP**.
2. Under **Mailbox login**, enter **Email address** and **Password** (prefer an app password). Open **Username differs from email address** only when the login name is different.
3. Under **Provider**, pick a preset (**Gmail**, **Outlook / Microsoft 365**, **Yahoo**, **iCloud**, **Zoho**) to fill hosts and ports, or **Custom** for your own hosting. Bokito may suggest a preset from the email domain.
4. Check **Incoming mail (IMAP)** (server, port, encryption), then optionally **Outgoing mail uses the same server as incoming**, then **Outgoing mail (SMTP)** (server, port, encryption). Open **Need help finding server settings?** for ports and firewall tips.
5. Under **How far back should we sync?**, pick **7**, **30** (recommended), **90**, or **1 year**.
6. Choose **Connect and sync**. Bokito logs in to IMAP and SMTP, imports that history, and only then shows the row in **Channels** as **Active**. Replies send through SMTP from this address.

If connect fails with a network error, outbound ports 993, 587 or 465 may be blocked on the server that runs the API. A failed first sync does not leave a half-connected row.

## Create a Bokito address

1. Choose **Add channel**, then **Email**, then **Bokito address**.
2. Type a **Prefix** of 3 to 24 characters, letters, digits and hyphens only. The preview under **Your address becomes** shows the full address, for example `support-acme@in.bokito.ai`.
3. Watch the counter: a workspace can have three addresses at most. Names such as `postmaster` and `noreply` are reserved.
4. Choose **Create address**, then **Copy**.
5. Share the address, or forward mail to it from your existing mailbox. Inbound mail lands in [Communication](/docs/inbox/communication) and replies go out from this address.

A Bokito address receives and sends; it has no sync, so it shows no folders or last sync time.

## Connect Gmail or Outlook

1. Choose **Add channel**, then **Email**.
2. Choose **Gmail** or **Outlook**.
3. Pick **How far back should we sync?** (**7**, **30** recommended, **90**, or **1 year**), then **Continue with Gmail** or **Continue with Outlook**.
4. Sign in at the provider. Bokito runs the first sync before the channel shows as **Active** — success only means install finished.
5. Back in the list, click the mailbox row. The **Mailbox** section holds **Folders**, **Signature**, **Primary sender**, **History** and **Connection**. Day-to-day sync runs automatically; **Retry sync** appears on the row only when a mailbox has a sync problem.

If the state badge reads **Action needed**, choose **Reconnect** (or fix settings and retry) before you try to send.

## Rename a channel

1. Open **Channels**.
2. Click the channel row, then choose **Edit** next to **Name** under **General**.
3. Type a short display name (for example **Support**) and choose **Save name**. Leave the field empty to use the address again.
4. The name appears in the Channels list, in the Communication sidebar, and on the reply tab when you send from that mailbox.

Do not screenshot or copy OAuth secrets from connected accounts.

## Read a channel's state and checks

Setup, Connections, Channels and the reply composer all use the same channel status. A calendar login alone does not count as a send-ready mailbox — Connections then shows that the agenda is synced while mail is not ready yet.

1. Look at the state on the right of the row: **Active**, **Setup required**, **Connecting**, **Degraded**, **Action needed**, **Paused** or **Error**. **Connecting** is only for an install still in progress — after a successful connect you see **Active**.
2. When a channel needs a human, the row shows one repair button next to the state: **Reconnect**, **Retry sync** or **Resume**. A yellow notice above the list counts channels that still need setup, and the first of them opens automatically.
3. Click the row and read **Status**. Each check is one line, for example **Sign-in**, **Synced folders**, **Last sync**, **Sync errors** for a mailbox, or **Incoming mail**, **Outgoing mail** and **Mail received** for a Bokito address.
4. For a mailbox, **History** in the **Mailbox** section is for later backfills after reconnect. How far back on first install is chosen during **Add channel**.

## Pause or remove a channel

1. Click the channel row and scroll to **Manage**.
2. Choose **Pause** next to **Pause channel**. A paused channel receives and sends nothing new; conversations and settings stay. A paused mailbox also stops being the primary sender.
3. The row then reads **Paused** with a **Resume** button. Choose **Resume** to receive and send again.
4. Choose **Remove** next to **Remove channel** to disconnect it for good. Existing conversations stay in Communication. The website chat can be paused but not removed.

In Communication, a thread that cannot send yet shows **Finish channel setup** when a channel exists but is not ready, or **Connect a mailbox** when none is linked. The setup guide marks the channel step done only when a mailbox can send or receive.

## Set a signature and default agent

1. Click a mailbox or Bokito address row, then choose **Edit** next to **Signature**. Outbound mail from that address appends it. After send, Communication shows that same signature in the thread bubble (what the customer received).
2. Under **General**, pick an **Agent** to send a channel's new conversations to a specific agent. Without one, the workspace default agent handles new threads. **Channel access** in the same section sets who may **View** or **Handle** the channel (people, teams, and agents). Owners and admins always handle every channel.
3. Choose **Make primary sender** next to **Primary sender** if you have several email channels. Inbox automations are managed once under **Automation rules**, not as a second set of per-mailbox routing rules.

## Set AI handling per channel

1. The row shows the channel's current mode (**Autonomous**, **Assisted** or **Manual**) with its icon. Click the row and open **AI handling** under **General**. The mode marked **Company default** is what the channel follows when it has no own setting; choose it to clear an override.
2. Pick **Autonomous**, **Assisted** or **Manual** for every conversation on this channel. Choose **Follow the workspace default** to remove it. Only an owner or admin can turn on Autonomous.
3. A **Paused** badge means the circuit breaker tripped after unusual activity and the channel runs Assisted. Choose **Resume autonomous** or **Keep assisted** from the same menu.

Contacts and single conversations can still differ from the channel. See [AI handling](/docs/inbox/inbox-ai).

## Connect WhatsApp

1. Choose **Add channel**, then **WhatsApp Business**. Marketplace cards for the app also send you here.
2. WhatsApp is a guided setup: **Prepare in Meta** (app, number, Phone number ID, permanent System User token), then **Paste in Bokito** (display name, Phone number ID, optional WABA ID, access token) and **Connect number**. The Phone number ID is a long number from Meta → WhatsApp → API Setup — not your phone number.
3. After connecting, Bokito shows **Webhook URL** and **Verify token**. Paste those in Meta under WhatsApp → Configuration, subscribe to **messages**, and send a test message. Temporary Meta tokens expire after 24 hours.
4. Website chat is the [Chat widget](/docs/inbox/widget); its **Website chat** section links to **Look and texts**, **Office hours** and **Installation**. After you connect, these channels appear in the Communication sidebar.

## Save replies the team can reuse

1. Scroll to **Saved replies** on the same page (or open `#saved-replies` from the composer).
2. Create a title and body, or save a draft from the composer in a thread.
3. Anyone can insert a saved reply while answering in Communication.

## Choose default sub-views, folders and tags

1. Scroll to **Folders and tags** on the same page.
2. Every channel and agent folder in Communication has the same sub-views: **For you**, **Open**, **Unassigned** and **Closed**. Sub-views appear only after you click the folder. Pick the **Default sub-view** a folder opens on, and override it per channel or assistant below.
3. Under **Folders**, save a filter on project, category, tag and stage as a folder in the Communication sidebar. Under **Tags**, keep the workspace tag list that agents and rules pick from. See [Communication](/docs/inbox/communication).
4. The category of a conversation is not a tag; manage categories under **Settings** → **Signal types**. See [Categories and tickets](/docs/ai/cases).

## What to do next

Set whether the AI answers, drafts or stays quiet under [AI handling](/docs/inbox/inbox-ai). Open Communication and wait for the first thread.

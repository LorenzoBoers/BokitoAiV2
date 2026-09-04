---
title: Connect channels
intro: Bring customer mail and other inboxes into Communication.
description: Add channels in one list, create a Bokito address, connect Gmail, Outlook, SMTP/IMAP or WhatsApp, and read each channel's state and checks.
keywords: channels, gmail, outlook, smtp, imap, mailbox, bokito address, relay, channel state, routing, signature
sort: 20
related: communication,inbox-ai,widget,integrations
---

# Connect channels

Channels are how customers reach the workspace. Open **Settings**, then **Email & messages**. Every channel — mailbox, Bokito address, website chat, WhatsApp — is one row in the **Channels** list with the same state, capabilities and checks. A new workspace starts with the website chat only, so add an email channel before you expect mail.

## Add a channel

![Channel settings with the channel list](/api/docs/assets/channels/mailbox-status.png)
*Every channel is one row with a state badge, capability chips and its own checks.*

1. Open **Settings**, then **Email & messages**.
2. Choose **Add channel**.
3. Pick **Email**, **WhatsApp Business**, or **Website chat**. **Email** opens a second step with **Gmail**, **Outlook**, **SMTP / IMAP** and **Bokito address**.
4. Finish the form for that choice. The new row appears in the **Channels** list.

## Connect SMTP / IMAP

Use this when your provider has no Gmail or Outlook OAuth card (for example Hostinger, cPanel, or a custom domain mailbox).

1. Choose **Add channel**, then **Email**, then **SMTP / IMAP**.
2. Under **Mailbox login**, enter **Email address** and **Password** (prefer an app password). Open **Username differs from email address** only when the login name is different.
3. Under **Provider**, pick a preset (**Gmail**, **Outlook / Microsoft 365**, **Yahoo**, **iCloud**, **Zoho**) to fill hosts and ports, or **Custom** for your own hosting. Bokito may suggest a preset from the email domain.
4. Check **Incoming mail (IMAP)** (server, port, encryption), then optionally **Outgoing mail uses the same server as incoming**, then **Outgoing mail (SMTP)** (server, port, encryption). Open **Need help finding server settings?** for ports and firewall tips.
5. Choose **Connect and verify**. Bokito logs in to IMAP and SMTP; on success the row appears in **Channels** and Inbox mail syncs into Communication. Replies send through SMTP from this address.

If verify fails with a network error, outbound ports 993, 587 or 465 may be blocked on the server that runs the API or workers.

## Create a Bokito address

1. Choose **Add channel**, then **Email**, then **Bokito address**.
2. Type a **Prefix** of 3 to 24 characters, letters, digits and hyphens only. The preview under **Your address becomes** shows the full address, for example `support-acme@in.bokito.ai`.
3. Watch the counter: a workspace can have three addresses at most. Names such as `postmaster` and `noreply` are reserved.
4. Choose **Create address**, then **Copy**.
5. Share the address, or forward mail to it from your existing mailbox. Inbound mail lands in [Communication](/docs/inbox/communication) and replies go out from this address.

A Bokito address receives and sends; it has no sync, so it shows no folders or last sync time.

## Connect Gmail or Outlook

1. Choose **Add channel**, then **Email**.
2. Choose **Gmail** or **Outlook** to open the provider's sign-in prompt.
3. Back in the list, open the row menu for **Sync now**, **Folders**, **Signature**, **Routing**, **Make primary sender**, or **Remove**.
4. If the state badge reads **Action needed**, choose **Reconnect** before you try to send.

Do not screenshot or copy OAuth secrets from connected accounts.

## Read a channel's state and checks

1. Look at the state badge on the row: **Active**, **Setup required**, **Connecting**, **Degraded**, **Action needed**, **Paused** or **Error**.
2. When any channel still needs setup, a yellow notice appears above the list. Channels in **Setup required**, **Action needed** or **Error** open their **Checks** panel automatically.
3. The chips next to the badge show what the channel can do: **Receive**, **Send**, **Sync**. A channel can show **Send** and still be blocked until every required check is OK.
4. Click the arrow at the start of the row to open **Checks**. Each check is one line, for example **Sign-in**, **Synced folders**, **Last sync**, **Sync errors** for a mailbox, or **Incoming mail**, **Outgoing mail** and **Mail received** for a Bokito address.
5. For a mailbox, **History** in the same panel sets how far back mail is backfilled when it (re)connects.
6. Use the toggle to pause a channel. A paused channel keeps its history but receives nothing new.

In Communication, a thread that cannot send yet shows **Finish channel setup** when a channel exists but is not ready, or **Connect a mailbox** when none is linked.

## Set a signature and routing

1. Open the row menu of a mailbox, then **Signature**. Outbound mail from that mailbox appends it. After send, Communication shows that same signature in the thread bubble (what the customer received).
2. Open **Routing**. The page is **Routing rules**. Choose **Add rule**. Rules run top to bottom; the first match wins. Drag to reorder.
3. Set **Condition type** to **Sender domain**, **Subject contains** or **Mailbox**, then **Assign to** a person (or **Do not assign**) and optional **Labels**. Turn **Rule is active** on.
4. Use the **Agent** column on the row to send a channel's new conversations to a specific agent. Without a route the **default agent** handles new threads. Set one email channel as **Primary** if you have several.

## Connect WhatsApp

1. Choose **Add channel**, then **WhatsApp Business**. Marketplace cards for the app also send you here.
2. WhatsApp is a guided setup: **Prepare in Meta** (app, number, Phone number ID, permanent System User token), then **Paste in Bokito** (display name, Phone number ID, optional WABA ID, access token) and **Connect number**. The Phone number ID is a long number from Meta → WhatsApp → API Setup — not your phone number.
3. After connecting, Bokito shows **Webhook URL** and **Verify token**. Paste those in Meta under WhatsApp → Configuration, subscribe to **messages**, and send a test message. Temporary Meta tokens expire after 24 hours.
4. Website chat is the [Chat widget](/docs/inbox/widget); its row opens the widget settings. After you connect, these channels appear in the Communication sidebar.

## Save replies the team can reuse

1. Scroll to **Saved replies** on the same page (or open `#saved-replies` from the composer).
2. Create a title and body, or save a draft from the composer in a thread.
3. Anyone can insert a saved reply while answering in Communication.

## Choose default sub-views

1. Scroll to **Folders** on the same page.
2. Every channel and agent folder in Communication has the same sub-views: **Open**, **Mine**, **Unassigned** and **Closed**. Sub-views appear only after you click the folder. Pick the **Default sub-view** a folder opens on, and override it per channel or assistant below.
3. Classifying conversations no longer happens with tags here: intake types live on the [Cases page](/docs/ai/cases), and a conversation shows its cases in the side panel.

## What to do next

Set when drafts appear under [Inbox AI](/docs/inbox/inbox-ai). Open Communication and wait for the first thread.

---
title: Connect channels
intro: Bring customer mail and other inboxes into Communication.
description: Use the built-in Bokito address or connect Gmail and Outlook, then add signatures, routing and saved replies.
keywords: channels, gmail, outlook, mailbox, bokito address, routing, signature
sort: 20
related: communication,inbox-ai,widget,integrations
---

# Connect channels

Channels are how customers reach the workspace. Open **Settings**, then **Email & messages**. Every workspace already has a Bokito address; add Gmail or Outlook when you want mail to leave from your own domain.

## Use the Bokito address

1. Open **Settings**, then **Email & messages**.
2. At the top, copy **Your Bokito address**. It is built in and ready to receive.
3. Share it, or forward from an existing mailbox. Inbound mail lands in [Communication](/docs/inbox/communication). Replies go out from this address.

Do not screenshot or copy OAuth secrets from connected accounts.

## Connect Gmail or Outlook

![Channel settings with mailboxes](/api/docs/assets/channels/mailbox-status.png)
*Mailbox status, sync and routing live on Email & messages.*

1. Choose **Connect mailbox** and start **Gmail** or **Outlook**.
2. Finish the account prompt. Wait for inbound mail to appear as threads.
3. Open the row menu for **Sync now**, **Folders**, **Signature**, **Routing**, **Make primary**, or **Remove**. Outlook **Folders** opens **Select folders to sync**.
4. If status is expired or needs auth, reconnect before you try to send.

The built-in Bokito address does not need sync or reconnect. Connected mailboxes show last sync time.

## Set a signature and routing

1. Stay on Email & messages. Open the mailbox menu, then **Signature**. Outbound mail from that mailbox appends it.
2. Open **Routing**. The page is **Routing rules**. Choose **Add rule**. Rules run top to bottom; the first match wins. Drag to reorder.
3. Set **Condition type** to **Sender domain**, **Subject contains** or **Mailbox**, then **Assign to** a person (or **Do not assign**) and optional **Labels**. Turn **Rule is active** on.
4. Scroll to **Channel routing** (separate from mailbox rules). Choose **Add route**, pick the channel, optional account, priority and agent. **Pause** a route without deleting it. Without a route the **lead agent** handles new threads. Set one mailbox as **Primary** if you have several.

## Save replies the team can reuse

1. Scroll to **Saved replies** on the same page (or open `#saved-replies` from the composer).
2. Create a title and body, or save a draft from the composer in a thread.
3. Anyone can insert a saved reply while answering in Communication.

## Connect WhatsApp or Slack

1. Stay on Email & messages. Scroll to **WhatsApp** or **Slack**. Marketplace cards for these apps also send you here.
2. For WhatsApp, choose **Connect WhatsApp**. Enter **Phone number ID** and **Access token** (a permanent System User token), then **Connect number**. Copy **Webhook URL** and **Verify token** into the Meta App Dashboard under WhatsApp, Configuration. Temporary Meta tokens expire after 24 hours.
3. For Slack, choose **Connect Slack**. Enter **Bot token** and **Signing secret**, then **Connect workspace**. Copy **Events URL** and **Interactivity URL** into your Slack app. Decision cards can arrive there with **Approve** and **Deny**.
4. Website chat is the [Chat widget](/docs/inbox/widget). After you connect, those channels appear in the Communication sidebar.

## What to do next

Set when drafts appear under [Inbox AI](/docs/inbox/inbox-ai). Open Communication and wait for the first thread.

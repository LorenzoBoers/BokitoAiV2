---
title: Install the website widget
intro: Put Bokito chat on your site so visitors land in Communication next to email.
description: Install the Bokito chat widget, set Look and Voice and hours, and show help articles next to chat.
keywords: widget, website chat, livechat, install, appearance, office hours
sort: 40
related: channels,communication,widget-embed
---

# Install the website widget

The widget is a small script on your site. Visitors chat with your assistant. Those threads appear in Communication. Open **Settings**, then **Chat widget**.

## Copy the embed snippet

![Website chat installation](/api/docs/assets/widget/installation.png)
*Copy the snippet from Install.*

1. Open **Settings**, then **Chat widget**, then **Install**.
2. Copy **Widget for website visitors** for a public site. Copy **Assistant for signed-in users** only when the widget sits inside your own product and visitors are logged in. Use **Copy** on the snippet.
3. Paste it on a staging page first. Send a test message and confirm the thread in [Communication](/docs/inbox/communication).

Developers can follow the [embed reference](/docs/developers/widget-embed).

## Set Look

1. Open **Look** on the same page.
2. Set **Handling agent** — that agent answers new widget conversations. The widget name follows this agent unless you set **Assistant name**.
3. Under **Welcome messages**, set **Welcome title** and **Welcome subtitle**. Under **Colors**, pick **Accent**. **Widget icon** follows Branding unless you upload an override. Under **What visitors see**, turn modules **Home**, **Messages**, **Help** or **Tools** on or off. Choose **Save changes** and reload the staging page. Leaving with unsaved Look changes asks you to confirm.

## Set Voice, hours and the pre-chat form

1. Open **Voice & hours**. Under **Voice**, fill **Tone**, **Do** and **Do not**, then **Save changes**. The model itself is set on the agent page.
2. Under **Availability**, set **Office hours** with **From**, **Until** and **Timezone**, plus **Offline message**. Choose **Save availability**. Outside those hours the widget shows the offline message. Visitors can still leave a message.
3. Turn on **Pre-chat form** when you want a name and email before the first message. Those visitors become real [contacts](/docs/inbox/contacts) instead of anonymous website visitors.

## Show your help articles

1. Publish Knowledge docs of kind **Docs** from [Knowledge](/docs/ai/knowledge) with **Publish**.
2. On Chat widget, open **Look**. Under **What visitors see**, turn on the **Help** module.
3. Visitors then see your articles next to chat. The public `/help/{workspace}` site is yours, not Bokito product help.

## What to do next

Connect a [mailbox](/docs/inbox/channels) so chat and email share one hub. Set when the widget answers under [Inbox AI](/docs/inbox/inbox-ai) (website chat is often **Reply automatically**).

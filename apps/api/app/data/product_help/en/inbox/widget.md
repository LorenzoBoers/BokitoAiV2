---
title: Install the website widget
intro: Put Bokito chat on your site so visitors land in Communication next to email.
description: Install the Bokito chat widget, set Look and Voice, live handoff by availability, continuing on WhatsApp, and help articles next to chat.
keywords: widget, website chat, livechat, install, appearance, availability, live handoff, whatsapp
sort: 40
related: channels,communication,widget-embed,categories,assistant
---

# Install the website widget

The widget is a small script on your site. Visitors chat with your assistant. Those threads appear in Communication. Open **Settings**, then **Channels**, then the **Website chat** row. Each website-chat channel has its own look, hours and snippet — add another **Website chat** from **Add channel** when a second site needs its own embed.

## Copy the embed snippet

![Website chat installation](/api/docs/assets/widget/installation.png)
*Copy the snippet from Install.*

1. Open **Settings**, then **Channels**, then the **Website chat** row, then **Install**.
2. Copy **Widget for website visitors** for a public site. Copy **Assistant for signed-in users** only when the widget sits inside your own product and visitors are logged in. Use **Copy** on the snippet. The snippet includes `data-channel-id` so this site uses this channel.
3. If Install warns that the snippet uses a local development URL (`localhost` or `127.0.0.1`), paste it only for local tests. For a live website, open this channel on your production workspace and copy the snippet there.
4. Paste it on a staging page first. Send a test message and confirm the thread in [Communication](/docs/inbox/communication).

Developers can follow the [embed reference](/docs/developers/widget-embed).

## Set Look

1. Open **Look** on the same page.
2. Set **Handling agent** — that agent answers new widget conversations. New workspaces default to **Front desk** (the customer-facing agent). The widget name follows this agent unless you set **Assistant name**.
3. Under **Welcome messages**, set **Welcome title** and **Welcome subtitle**. Under **Colors**, pick **Accent**. **Widget icon** follows Branding unless you upload an override. Under **What visitors see**, turn modules **Home**, **Messages**, **Help** or **Tools** on or off. Changes save automatically (**Last modified** shows in the header). Reload the staging page to see the live widget.

The chat itself uses the same bubble design as [Communication](/docs/inbox/communication): messages from the same author within five minutes stack into one group, the first bubble of a group carries the avatar and name, and the last one carries the time. Assistant replies show the agent avatar with an **AI** chip; a reply from a colleague shows a **Team** chip instead, so visitors can see who answered.

## Set Voice, live handoff and the pre-chat form

1. Open **Voice & hours**. Under **Voice**, fill **Tone**, **Do** and **Do not** — they save automatically. The model itself is set on the agent page.
2. Under **Availability**, **Live handoff** shows **Someone is available** or **Nobody available**. There are no fixed hours: a visitor can ask for a person when someone with Handle access on the widget is available (see [Team](/docs/getting-started/team) for **Away**). Otherwise the agent says so and offers an email follow-up, a callback, or continuing on WhatsApp.
3. Turn on **Pre-chat form** when you want a name and email before the first message. Those visitors become real [contacts](/docs/inbox/contacts) instead of anonymous website visitors.
4. In the chat composer, visitors can dictate with the microphone when the browser supports speech recognition (same pattern on the website widget and the in-app assistant): hold to talk or click to start; while listening the button shows a green glow and animated wave bars, with a check on hover to confirm. Commit/dedupe rules and wave geometry are shared via `@bokito/shared` with the Messages composer.
5. Visitors can send another message while the assistant is still replying. The widget stops the unfinished answer, keeps both visitor messages on screen, and starts a new reply that covers them together. Typing alone does not stop the assistant — only Send or Stop does. After Send, the message box stays focused so the next line is ready.

The website widget follows the visitor's system light or dark setting. There is no theme switcher in the widget. Preview Light and Dark on this page only to check contrast.

## Continue on WhatsApp

When nobody is available, the agent can move the chat to WhatsApp so the visitor does not wait on the website.

1. Connect a WhatsApp channel first (see [Channels](/docs/inbox/channels)).
2. Open **Voice & hours**. Under **Availability**, switch on **Continue on WhatsApp** and choose the **WhatsApp channel**. Fill **WhatsApp number** only when the page asks for it; after the first WhatsApp message the channel knows its own number. Choose **Save availability**.
3. When a visitor asks for a person and nobody is available, the agent offers a WhatsApp link with the message already filled in. The visitor only presses send.
4. That message starts a WhatsApp conversation linked to the same contact and owner. It opens with a short summary, waits for a person, and the website chat closes with **Continued on WhatsApp**.

A link works once and for seven days. A WhatsApp message without a valid link starts a normal conversation.

## Show your help articles

1. Publish Knowledge docs of kind **Docs** from [Knowledge](/docs/ai/knowledge) with **Publish**.
2. On the website-chat channel, open **Look**. Under **What visitors see**, turn on the **Help** module.
3. Visitors then see your articles next to chat. The public `/help/{workspace}` site is yours, not Bokito product help.

## What to do next

Connect a [mailbox](/docs/inbox/channels) so chat and email share one hub. Set when the widget answers under [AI handling](/docs/inbox/inbox-ai) (website chat is often **Autonomous**). With **Disclose AI replies** on, autonomous answers show a short note under the bubble. A request recognized in chat becomes a [ticket](/docs/ai/categories) on the conversation, not a second inbox.

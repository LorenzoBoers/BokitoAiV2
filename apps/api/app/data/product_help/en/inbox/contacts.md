---
title: How Contacts works
intro: A shared address book built from real conversations.
description: Open people and companies from any thread, add a contact, start outbound mail, and approve or block senders.
keywords: contacts, crm, customers, companies, new contact, contact owner, account manager
sort: 30
related: communication,channels,widget
---

# How Contacts works

Everyone who writes in with a real name or address lands here. Open Contacts to recognize a person, or open them from a thread so you do not leave the conversation.

## Open a contact from a thread

![Contacts page](/api/docs/assets/contacts/contact-card.png)
*Everyone who writes in lands here.*

1. Open a thread in [Communication](/docs/inbox/communication).
2. For a known person, click their name in the side panel or the thread header to open their contact.
3. Read their history, last-seen and other conversations, then jump back to the open work. The list spans channels: someone who chats on the website and also emails from the same address shows one combined history, each row marked with its channel icon.

Unknown website visitors stay in the conversation as **Website visitor**. They have no **Profile** and are not listed under Contacts until they fill the widget [pre-chat form](/docs/inbox/widget) or you [link the conversation](#link-a-conversation-to-a-contact).

## Link a conversation to a contact

![Link form in the contact panel](/api/docs/assets/contacts/link-conversation.png)
*Link an unknown chatter by email or phone number.*

1. Open a website chat or WhatsApp thread with an unknown person and choose **+ Contact** in the contact panel.
2. Type their email address or phone number, optionally a name, then **Link**. When the address belongs to a contact, the thread joins that person; otherwise Bokito creates the contact. When more than one contact matches, pick the right one from the list.
3. The visitor stays as an identity of the person: their earlier chats move along, and the contact page lists it under **Also reachable at**. Nothing is overwritten. An owner or admin can choose **Detach** there to make an identity a separate contact again.
4. A thread linked from an unconfirmed address shows **Claimed**; after the visitor confirms an email link it shows **Verified**. Personal data such as invoices stays behind **Verified**.

The AI links on its own when a visitor gives an address. **Assisted** links only verified addresses and asks you for the rest with a decision card; **Autonomous** also links claimed addresses and creates new contacts; **Manual** leaves it to you. Merging two known contacts always needs an owner or admin. See [AI handling](/docs/inbox/inbox-ai).

## Add a person or start mail

1. Open **Contacts**. Search by name, address or company. Filter status with **All**, **Approved**, **Pending** or **Blocked**.
2. Choose **New contact**. **Email address** is required. Add **Full name**, optional **Company**, then **Create contact**.
3. On the **Profile**, add **Title**, **Phone** and **Notes**, then **Save changes**. **Open conversation** jumps to the latest thread. Start **Write email** so outbound mail is already addressed. **Delete** unlinks the person; conversations stay.

## Group people and companies

1. On Contacts, switch **People** and **Companies**.
2. Companies appear automatically from business email domains (not free hosts such as Gmail). Link a person so related threads stay together.
3. Use **Group contacts by company** to backfill companies on older addresses that never received one. From a thread without a saved person, choose **Contact** in the side panel, enter the address, then **Link**. **Mark as spam** is next to that button.

## Approve or block a sender

1. Open the contact on **Contacts**. Status can be **Approved**, **Pending** or **Blocked**.
2. Choose **Approve** for an address you want in the book.
3. Choose **Block** for a sender that should drop out of Communication. New messages from them are dropped. From a conversation you can also open the thread menu (⋯) and choose **Block** with their name.

## Set AI handling for one contact

![AI handling on a contact](/api/docs/assets/contacts/contact-handling.png)
*A contact can follow the channel or have its own mode.*

1. Open the contact on Contacts, or open the side panel in a conversation with them.
2. Find **AI handling** under the contact details. It shows the current mode. Open the menu to see what it follows: the inherited mode carries a badge such as **Channel default**.
3. Pick **Autonomous**, **Assisted** or **Manual** to apply it to every conversation with this person. Choose the mode marked **Channel default** to remove it.
4. On Contacts, filter the list with the **Any AI handling** menu to find contacts with **Custom AI handling** or a specific mode. Rows with their own mode show its icon.

A single conversation can still differ from the contact. See [AI handling](/docs/inbox/inbox-ai).

## Give a contact a fixed owner

1. Open the contact on Contacts, or open the side panel in a conversation with them. Find **Owner** under **AI handling**.
2. Pick a person or a team from the menu; **No fixed owner** clears it.
3. New conversations from this contact go to that owner when the AI is silent (Manual). On Autonomous or Assisted the agent picks the conversation up first and hands it to the contact owner as soon as a person is needed, before it falls back to the channel team.

Account managers and key accounts are the usual case: the agent handles the routine mail and the owner gets everything the agent cannot finish. See [Handovers](/docs/inbox/inbox-ai#set-handovers-between-agent-and-people).

## What to do next

Connect [email](/docs/inbox/channels) or the [website widget](/docs/inbox/widget) so contacts appear on their own.

---
title: Privacy and security
intro: Retention, data subject requests, and AI data use live under Trust and privacy.
description: Configure one workspace retention period, control whether AI may use message bodies, and export or erase personal data for a subject email.
keywords: privacy, security, retention, GDPR, AVG, DSAR, export, erase, trust, subprocessors
sort: 40
related: govern,autonomy,communication
---

# Privacy and security

Owners and admins manage retention and data subject requests under **Settings**, then **Trust & privacy**. Legal drafts live in the repo under `docs/legal` and need counsel review before production use with customer data.

## Open Trust and privacy

1. Open **Settings**.
2. Under **Govern**, choose **Trust & privacy**.
3. Under **Legal documents**, open **Data processing agreement**, **Privacy notice**, **Subprocessors** or **Security overview** when you need the operator drafts. Then use the retention and data subject sections below.

## Set retention and AI body use

1. Open **Retention and AI**. Set **Workspace retention (days)** (default 365). One period applies to messages, calendar events, and audit data across this workspace.
2. Older eligible data is purged by the retention job; thread shells can remain.
3. Toggle **Allow AI to use message bodies**. When off, inbox AI drafts that need full bodies stay disabled; metadata-only flows may still run.
4. Leave the field to save. Changes apply to this workspace only.

## Export or erase a data subject

1. Under **Data subject requests**, enter the **Data subject email**.
2. Choose **Export personal data** to download a JSON package for that address in this workspace.
3. Or choose **Erase personal data** and confirm the scrub of contacts, message bodies, and matching calendar attendees. This cannot be undone.
4. Full workspace wipe remains under workspace delete. Account delete is separate from subject erase.

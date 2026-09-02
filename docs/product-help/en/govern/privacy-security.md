---
title: Privacy and security
intro: Retention, data subject requests, and AI data use live under Trust and privacy.
description: Configure message and calendar retention, control whether AI may use message bodies, and export or erase personal data for a subject email.
keywords: privacy, security, retention, GDPR, AVG, DSAR, export, erase, trust, subprocessors
sort: 40
related: govern,autonomy,communication
---

# Privacy and security

Owners and admins manage retention and data subject requests under **Settings**, then **Trust & privacy**. Legal drafts live in the repo under `docs/legal` and need counsel review before production use with customer data.

## Open Trust and privacy

1. Open **Settings**.
2. Under **Govern**, choose **Trust & privacy**.
3. Review the legal document links, then the retention and data subject sections.

## Set retention and AI body use

1. Set **Message retention (days)** (default 365). Older message bodies are purged on a daily job; thread shells can remain.
2. Set **Calendar retention (days)** (default 365) for synced calendar events.
3. Toggle **Allow AI to use message bodies**. When off, inbox AI that needs full bodies stays disabled.
4. Leave a field to save. Changes apply to this workspace only.

## Export or erase a data subject

1. Enter the person's email under **Data subject requests**.
2. Choose **Export personal data** to download a JSON package for that address in this workspace.
3. Or choose **Erase personal data**, confirm, and scrub matching contacts, message bodies, and calendar attendees.
4. Full workspace wipe remains under workspace delete. Account delete is separate from subject erase.

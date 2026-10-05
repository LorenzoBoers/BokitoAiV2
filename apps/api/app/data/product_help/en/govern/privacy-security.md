---
title: Privacy and security
intro: Retention, data region, data subject requests, and AI data use live under Data & privacy.
description: Configure one workspace retention period, choose where AI may process data, control whether AI may use message bodies, and export or erase personal data for a subject email.
keywords: privacy, security, retention, GDPR, AVG, DSAR, export, erase, data region, EU, subprocessors
sort: 40
related: govern,autonomy,communication,models
---

# Privacy and security

Owners and admins manage retention, data region, and data subject requests under **Settings**, then **Data & privacy**. Legal drafts live in the repo under `docs/legal` and need counsel review before production use with customer data.

## Open Data & privacy

1. Open **Settings**.
2. Under **Govern**, choose **Data & privacy**.
3. Under **Legal documents**, open **Data processing agreement**, **Privacy notice**, **Subprocessors** or **Security overview** when you need the operator drafts. Then use the retention, data processing, and data subject sections below.

## Set retention and AI body use

1. Open **Retention and AI**. Set **Workspace retention (days)** (default 365). One period applies to messages, calendar events, and audit data across this workspace.
2. Older eligible data is purged by the retention job; thread shells can remain.
3. Toggle **Allow AI to use message bodies**. When off, AI handling shows Manual on every conversation and no drafts are written; metadata-only flows may still run.
4. Leave the field to save. Changes apply to this workspace only.

## Allow or block non-EU models

![Data processing](/api/docs/assets/privacy-security/data-region.png)
*Bokito AI stays on EU-hosted models until you allow a transfer.*

1. On **Data & privacy**, open **Data processing**. Bokito AI runs on EU-hosted infrastructure by default.
2. Toggle **Allow non-EU platform models**. The switch is off by default. While it is off, an agent that points at a non-EU platform model runs on Bokito AI instead.
3. Turn the switch on only when your data processing agreement covers that transfer. Owners and admins can change it; your own provider keys are never redirected.
4. If active agents already point at non-EU models, the page lists those slugs. Knowledge embeddings still run on a US-hosted model until an EU alternative ships.

## Export or erase a data subject

1. Under **Data subject requests**, enter the **Data subject email**.
2. Choose **Export personal data** to download a JSON package for that address in this workspace.
3. Or choose **Erase personal data** and confirm the scrub of contacts, message bodies, and matching calendar attendees. Matching Bin items for that address are purged. This cannot be undone.
4. Full workspace wipe: owners use **Settings → General → Delete workspace**. Platform support can also delete a tenant from **Ops** (type the slug to confirm). Account delete is separate from subject erase.

## Restore or permanently delete from the Bin

Operator deletes (conversations, projects, canvases, knowledge, contacts, playbooks, triggers, teams, rules) move to the **Bin**, not straight to gone. Agent deactivate and mailbox archive stay outside the Bin.

1. Open **Settings**. At the bottom of the sidebar, above **Help**, choose **Bin**.
2. Filter by type or search the title. Each row shows who deleted it and **Purge on** the date it will be removed.
3. Choose **Restore** to bring the item and its children back. If a slug is taken, Bokito appends `-restored`. Each row shows who deleted the item and when it will be purged.
4. Choose **Delete permanently** for one item, or **Empty Bin** (type `empty`) to purge all. The footer states how many days items are kept (platform default 60).
5. New mail on a binned conversation restores that conversation instead of opening a duplicate.

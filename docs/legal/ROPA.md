# Records of processing (RoPA) — Article 30

**Status:** `draft` — internal; requires FG/counsel review.  
**Version:** 0.1 · **Last updated:** 2026-09-01

## A. Bokito as processor (customer workspaces)

| Item | Content |
|---|---|
| Purposes | Provide Bokito SaaS: messaging hub, agents, agenda, modules |
| Categories of subjects | Controller’s customers, staff, suppliers (controller-defined) |
| Categories of data | Identity, contact, message bodies, attachments metadata, calendar, audit |
| Recipients | Sub-processors (see SUBPROCESSORS.md); controller’s authorised users |
| Transfers | Per sub-processor safeguards |
| Retention | Messages/calendar default 365d (tenant override); audit policy 730d soft |
| Security | MFA/SSO optional, RBAC, tenant isolation, credential encryption, TLS, audit |

## B. Bokito as controller (platform accounts)

| Item | Content |
|---|---|
| Purposes | Accounts, billing, support, security |
| Categories | Users, staff admins |
| Data | Email, name, auth secrets (hashed/encrypted), memberships |
| Retention | Account lifetime; anonymise on delete-account |
| Recipients | Hosting, mail delivery, Sentry |

Update this register when adding integrations that store new personal data categories.

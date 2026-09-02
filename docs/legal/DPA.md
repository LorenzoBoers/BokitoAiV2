# Data Processing Agreement (Verwerkersovereenkomst)

**Status:** `draft` — requires counsel review before production use with customer personal data.  
**Version:** 0.1 · **Last updated:** 2026-09-01

This template is intended as Bokito B.V. (or the contracting entity) acting as **processor** for the customer (**controller**) under Article 28 GDPR / AVG.

## 1. Subject, duration, nature and purpose

- **Subject:** Provision of the Bokito AI operations platform (inbox, agents, agenda, modules).
- **Nature:** Hosting, storage, retrieval, structuring, AI-assisted drafting/triage, and transmission of personal data on documented instructions of the controller.
- **Purpose:** Enable the controller to operate customer communications and AI-assisted workflows.
- **Duration:** Term of the subscription / MSA plus deletion or return period in section 8.

## 2. Categories of data subjects and data

Typical categories (controller-defined): customers, prospects, employees, suppliers.  
Typical data: names, email addresses, phone numbers, message content, calendar attendees, account identifiers. Special categories only if the controller uploads them (not solicited by Bokito).

## 3. Instructions

The processor processes personal data only on documented instructions of the controller, including via product configuration (workspace settings, Govern posture, channel connections), unless required by Union or Member State law.

## 4. Confidentiality

Persons authorised to process personal data are bound by confidentiality (employment, contract, or statutory obligation).

## 5. Security (Article 32)

Technical and organisational measures include: TLS in transit, access control (RBAC, optional MFA/SSO), tenant isolation, audit logging of consequential actions, encryption of selected secrets and OAuth credentials at rest, rate limiting, webhook signing. Details: Security & Privacy page / `docs/legal/INCIDENT-RESPONSE.md`.

## 6. Sub-processors

Controller authorises engagement of sub-processors listed in `docs/legal/SUBPROCESSORS.md` (and the in-product Trust page). Bokito will notify of material changes; controller may object on reasonable grounds within the notice period stated in the commercial agreement.

## 7. Assistance

Processor assists the controller with data subject requests (access, erasure, portability), security, DPIA, and breach notification, via product tools (`/settings/trust`) and support channels.

## 8. Deletion or return

On end of services, processor deletes or returns personal data at controller choice, except where retention is required by law. Workspace deletion purges tenant-scoped data. Subject-level erase and retention TTLs are available in-product.

## 9. Audits

Controller may request information reasonably necessary to demonstrate Article 28 compliance and, under agreed conditions, conduct audits (or appoint an independent auditor) no more than once per year, at controller cost, with reasonable notice.

## 10. International transfers

Where personal data is transferred outside the EEA, appropriate safeguards (SCCs, adequacy, or EU–US Data Privacy Framework where applicable) apply as described in SUBPROCESSORS.

## Counsel gate

Until status is `approved`, this document is for internal pilots and engineering reference only.

# Incident response — personal data breach

**Status:** `draft` — requires counsel/ops ownership.  
**Version:** 0.1 · **Last updated:** 2026-09-01

## Goal

Detect, contain, and notify personal data breaches within **72 hours** to the Autoriteit Persoonsgegevens when required, and inform affected customers (controllers) without undue delay.

## Severity

| Level | Examples | Actions |
|---|---|---|
| Sev-1 | DB dump, OAuth token theft, ransomware | Immediate containment; AP + customer notify path |
| Sev-2 | Limited account takeover, misdirected export | Contain; assess notification duty |
| Sev-3 | Attempted intrusion blocked | Log; no notification unless required |

## Playbook

1. **Detect** — alerts (Sentry, host monitoring, customer report, staff access anomaly).
2. **Contain** — rotate `CREDENTIALS_FERNET_KEY` / JWT / OAuth client secrets as needed; revoke sessions; disconnect compromised mailboxes; take host offline if required.
3. **Assess** — categories of data, number of subjects, likelihood of risk to rights.
4. **Notify** — if risk to individuals: AP within 72h; controllers ASAP with facts, measures, contact.
5. **Remediate** — patch, force password/2FA, customer guidance.
6. **Post-mortem** — within 10 business days; update DPIA/RoPA if needed.

## Contacts (fill before production)

- Privacy lead: TBD  
- On-call engineering: TBD  
- Counsel: TBD  
- AP portal: https://autoriteitpersoonsgegevens.nl/

## Evidence to preserve

AuditEvent rows, access logs, StaffAccessLog, deployment versions, timeline of containment.

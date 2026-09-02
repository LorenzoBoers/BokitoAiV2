# ISO 27001 / SOC 2 prep checklist

**Status:** `draft` — preparation only. Formal audit is a separate project and budget.

This maps Bokito controls to common trust criteria. It does **not** claim certification.

| Area | Product / process control | Gap / next step |
|---|---|---|
| Access control | Auth, roles (owner/admin/member), MFA path | Enforce MFA org-wide policy |
| Encryption at rest (secrets) | `CREDENTIALS_FERNET_KEY` for OAuth blobs | Field-level body encryption not in v1 |
| Encryption in transit | TLS at edge | Confirm hosting TLS and HSTS |
| Logging / audit | `AuditEvent`, Govern history, privacy export/erase events | Retention policy for audit (soft 730d) |
| Change management | Govern drafts + apply modes | Document release checklist |
| Incident response | [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) | Tabletop exercise with counsel |
| Vendor management | [SUBPROCESSORS.md](SUBPROCESSORS.md) | Signed DPAs with each subprocessor |
| Privacy | Trust UI, DSAR export/erase, retention purge | Counsel-approved DPA/privacy |
| AI transparency | Widget/assistant disclosure, AI Act class doc | Keep HITL mapping current |
| Staff access | [STAFF-ACCESS-REVIEW.md](STAFF-ACCESS-REVIEW.md) | Quarterly reviews |
| Backup / restore | Hosting provider backups | Document RPO/RTO |
| Vulnerability mgmt | Dependency updates, Sentry | Scheduled SCA + patch SLAs |

## Exit for “prep done”

- [ ] Counsel-approved DPA + privacy
- [ ] Credentials encryption + retention + DSAR demonstrated in prod
- [ ] Incident runbook exercised once
- [ ] Subprocessor DPAs filed
- [ ] This checklist signed by eng + ops owners

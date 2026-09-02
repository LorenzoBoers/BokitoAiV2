# Security and privacy (customer summary)

**Status:** `draft` — engineering summary for trust pages. Counsel must approve before marketing claims.

Bokito is a **processor** for SMB customers who use the product as controller of their customer and employee data. Model providers, hosting, email delivery, and error tracking act as **subprocessors** (see [SUBPROCESSORS.md](SUBPROCESSORS.md)).

## Highlights

- **Authentication:** Workspace membership and role checks on API routes; session tokens; MFA supported on accounts.
- **Secrets:** OAuth and integration credentials are stored encrypted at rest with a dedicated Fernet key (`CREDENTIALS_FERNET_KEY`), separate from JWT signing.
- **Governed autonomy:** Tenant Autonomy Posture and Govern drafts control what agents may change; decisions can stay inline in threads.
- **Audit:** Structural and privacy actions emit audit events.
- **Retention:** Default 365 days for messages and calendar events; owners/admins configure under **Settings → Trust & privacy**.
- **Data subject assistance:** Owners/admins can export or scrub data for a subject email in the workspace.
- **AI transparency:** Website widget and assistant surfaces disclose that the visitor chats with AI; humans can take over.
- **LLM use:** Workspace toggle controls whether message bodies may be sent to model providers.

## Incident contact

Report suspected incidents to your Bokito account contact and follow [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) for the 72-hour path.

## Documents

- [DPA.md](DPA.md) — processing agreement template
- [PRIVACY.md](PRIVACY.md) — privacy notice draft
- [AI-ACT-CLASSIFICATION.md](AI-ACT-CLASSIFICATION.md) — limited-risk deployer sketch
- [KEY-ROTATION.md](KEY-ROTATION.md) — key rotation runbook

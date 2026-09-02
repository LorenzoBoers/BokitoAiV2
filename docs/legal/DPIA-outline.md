# DPIA outline — AI + mail + administration

**Status:** `draft` — screening complete; full DPIA to be finished with FG/counsel.  
**Version:** 0.1 · **Last updated:** 2026-09-01

## Screening (why a DPIA is likely required)

- Systematic processing of customer communications (email bodies) at scale.
- AI inference on personal data (triage, draft, compaction).
- Potential for automated suggestions affecting how humans treat individuals (mitigated by Govern / decisions).

## Description of processing

Ingest mail/chat → store threads → optional LLM calls → human or approved agent actions → audit/learning.

## Necessity and proportionality

Purpose: SMB operational efficiency. Alternatives: human-only inbox (higher cost). Minimisation: retention TTLs, optional `llm_may_use_message_bodies=false`, mute AI per thread.

## Risks to rights and freedoms

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Unauthorised access to mailboxes | Med | High | Encrypt OAuth tokens, MFA, RBAC, tenant isolation |
| LLM provider exposure | Med | High | DPA/SCCs, BYOK, body toggle, Sentry scrub |
| Over-retention | Med | Med | 365d default retention job |
| Incorrect AI suggestion acted on | Med | Med | Autonomy posture, ask/allow/deny, decision cards |
| Incomplete erasure | Med | Med | Subject erase API + workspace wipe |

## Residual risk and decision

Proceed with processing after implementing Phase 0–1 mitigations; counsel/FG to sign off full DPIA before broad MKB production.

## Review

Revisit on material feature change (new high-risk AI use, new sub-processor, Annex III use case).

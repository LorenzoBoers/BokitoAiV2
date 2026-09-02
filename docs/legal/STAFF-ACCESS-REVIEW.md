# Staff tenant access review

**Status:** `draft`

Staff can enter customer tenants for support. Access must stay least-privilege, time-bound, and reviewable.

## Controls already in product

- Staff enter flows leave `StaffAccessLog` entries (who, which tenant, when).
- Prefer owner/admin customer actions for DSAR; staff only when the customer cannot act.

## Quarterly review checklist

1. Export recent `StaffAccessLog` rows (last 90 days).
2. Confirm each access had a ticket or customer request.
3. Flag open-ended or repeated access without ticket; revoke staff roles if unused.
4. Confirm MFA is on for all staff accounts.
5. Confirm production secrets (`CREDENTIALS_FERNET_KEY`, JWT, DB) are not shared in chat or tickets.
6. File the review under internal compliance (date, reviewer, findings).

## Escalation

Unexpected staff access → treat as security incident per [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md).

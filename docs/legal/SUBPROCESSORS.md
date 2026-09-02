# Sub-processors

**Status:** `draft` — requires counsel review.  
**Version:** 0.1 · **Last updated:** 2026-09-01

Bokito may engage the following sub-processors to deliver the service. Customers are notified of material changes per the DPA.

| Sub-processor | Purpose | Typical data | Region / transfer notes |
|---|---|---|---|
| Hosting provider (e.g. Hostinger / VPS) | Application + database hosting | All tenant data at rest | Configure for EU where possible |
| Anthropic | LLM inference (platform keys) | Prompt/context may include message content | US / SCCs or DPF as applicable; BYOK alternative |
| OpenAI | LLM / embeddings (platform or BYOK) | Prompt/context, embeddings | US / SCCs or DPF; BYOK alternative |
| Google | Gmail / Google Calendar OAuth | Tokens, mailbox/calendar sync | Google terms + SCCs/DPF |
| Microsoft | Outlook / Calendar / Entra SSO | Tokens, mailbox/calendar, identity | Microsoft terms + SCCs/DPF |
| Sentry | Error monitoring | Stack traces; PII scrubbing enabled (`send_default_pii=False`) | Per Sentry DPA |
| Resend / SMTP provider | Transactional email | Recipient email, invite/reset content | Per provider DPA |
| Cloudflare (if used) | DNS / proxy | IP, request metadata | Per Cloudflare terms |

## Customer BYOK

When a tenant connects their own LLM provider keys, that provider is engaged under the tenant’s instruction; Bokito still processes prompts in transit through the platform.

## Change policy

Material additions or replacements: update this file and the Trust page; notify customers with at least 14 days notice where the DPA requires it (counsel to confirm period).

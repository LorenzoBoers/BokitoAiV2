# Bokito Company Documentation

Last updated: May 2026

English handbook for the Bokito platform: products, tenancy, infrastructure, and business rules. For the living agent knowledge log (often Dutch, incremental), see [`BOKITO_KNOWLEDGE.md`](../../BOKITO_KNOWLEDGE.md) at the repo root.

## Audience

- Engineers onboarding to the monorepo
- Operators deploying runtime, Cloudflare, and Xano static hosting
- Internal product staff using the **`bokito`** tenant (`https://bokito.bokito.ai`, dev: `http://bokito.localhost:5174`)

## Conventions

- **Language:** English throughout this folder.
- **Facts over speculation:** Roadmap and stub areas are labeled explicitly.
- **Deep dives:** Portal navigation, API routes, and integrations have dedicated docs under `apps/dashboard/docs/` and `xano-patches/`; this handbook summarizes and links rather than duplicating them.
- **No emojis** in documentation copy (workspace policy).

## Table of contents

| Doc | Summary |
|-----|---------|
| [01 – Platform overview](01-platform-overview.md) | What Bokito is, four apps, tech stack, repo layout |
| [02 – Tenant and hosting](02-tenant-and-hosting.md) | Multi-tenancy, `bokito` tenant, auth, Cloudflare workers, troubleshooting |
| [03 – Dashboard product](03-dashboard-product.md) | Portal navigation, modules, i18n, frontend API pattern |
| [04 – Workspace and projects](04-workspace-and-projects.md) | Workspace hub, project cockpit, tenant-wide documentation |
| [05 – Workforce and agents](05-workforce-and-agents.md) | Agent orchestration, runtime worker, runs, crons |
| [06 – Integrations](06-integrations.md) | Marketplace, OAuth, MCP, provider catalog |
| [07 – Inbox and communication](07-inbox-and-communication.md) | Inbox queues, email sync, assistant settings |
| [08 – Chat widget and mobile](08-chat-widget-and-mobile.md) | Embed contract, SSE streaming, mobile app |
| [09 – Infrastructure and deploy](09-infrastructure-and-deploy.md) | VPS runtime, `deploy.ps1`, DNS, env vars |
| [10 – Data model and APIs](10-data-model-and-apis.md) | Xano API groups, tenant tables, workspace docs schema |
| [11 – Business rules and glossary](11-business-rules-and-glossary.md) | Isolation, RBAC, SOPs, terminology, roadmap |

## Related documentation (outside this folder)

| Path | Purpose |
|------|---------|
| [`apps/dashboard/docs/NAVIGATION.md`](../../apps/dashboard/docs/NAVIGATION.md) | Portal IA, rail, sidebars, redirects |
| [`apps/dashboard/docs/API.md`](../../apps/dashboard/docs/API.md) | Frontend API env and route pattern |
| [`apps/dashboard/docs/INTEGRATIONS.md`](../../apps/dashboard/docs/INTEGRATIONS.md) | Integrations developer checklist |
| [`apps/chat-widget/MULTI_TENANT_BACKEND_CONTRACT.md`](../../apps/chat-widget/MULTI_TENANT_BACKEND_CONTRACT.md) | Widget tenant auth contract |
| [`docs/phase-0-infrastructure.md`](../phase-0-infrastructure.md) | VPS setup checklist |
| [`xano-patches/v1/CRONS.md`](../../xano-patches/v1/CRONS.md) | Scheduled tasks |
| [`xano-patches/v1/VERIFICATION.md`](../../xano-patches/v1/VERIFICATION.md) | Platform verification checklist |
| [`xano-patches/v1-platform-tables.md`](../../xano-patches/v1-platform-tables.md) | V1 platform tables |

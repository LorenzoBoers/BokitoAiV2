# EU AI Act — classification sketch

**Status:** `draft` — requires counsel review.  
**Version:** 0.1 · **Last updated:** 2026-09-01

## Role

Bokito is primarily a **deployer** of AI systems that call third-party GPAI models via API. Bokito is **not** a GPAI model provider.

## Risk tier (current product)

| System | Intended use | Tentative tier | Notes |
|---|---|---|---|
| Website chat widget / assistant | Customer Q&A and capture | Limited-risk | Transparency disclosure required |
| Email triage / draft | Operator-facing suggestions | Limited / minimal | Human oversight via suggest mode + Govern |
| Accounting propose→approve | Financial draft actions | Not Annex III by default | Writes gated; HITL required |
| Credit scoring / HR recruitment / biometrics | Not offered | N/A | Prohibited / high-risk — do not build |

## Deployer obligations mapping

| Obligation | Product evidence |
|---|---|
| Transparency (chatbot) | Widget + assistant AI disclosure copy |
| Human oversight | Autonomy Posture, DecisionRequest, PlatformChange, tool allowances |
| Logging | AuditEvent, SignalEvent, Govern audit |
| Instructions / use limits | Acceptable use below; Govern deny lists |

## Acceptable use / prohibited practices

**Allowed:** assisted customer communication, scheduling, knowledge Q&A, bookkeeping proposals with approval.  
**Prohibited on the platform:** social scoring of natural persons, real-time remote biometric identification, untargeted facial scrapes, exploitative manipulative AI, and any Annex III high-risk use without a separate conformity programme.

## Article 25 note

Do not rebrand or substantially modify third-party high-risk systems under the Bokito name without legal review.

# Onboarding Experience — Component POCs & Jira Boards

Dummy/placeholder names for demo purposes — swap in real team members before using internally.

| Component / Surface | POC | Role | Jira Board |
|---|---|---|---|
| NEON UI (React/TypeScript) | Kevin Park | Tech Lead, NEON UI | `NEON` |
| Onboarding Service (orchestration layer) | Priyanka Iyer | Orchestration Lead | `OBSVC` |
| Field-level caching layer | Priyanka Iyer | Orchestration Lead (owns caching within Onboarding Service) | `OBSVC` |
| Real-time risk streaming endpoint | Dana Whitfield (Risk) + Priyanka Iyer (Onboarding Service) | Joint owners — endpoint lives in Onboarding Service, consumed by Risk | `RISK` / `OBSVC` |
| Payroll integration | Priya Raman | Payroll Pool Lead | `PAYROLL` |
| Payments integration | Jordan Lee | Payments Pool Lead | `PMTS` |
| Lending integration | Sam Okafor | Lending Pool Lead | `LEND` |
| BillPay integration | Maria Chen | BillPay Pool Lead | `BILLPAY` |
| B2B integration | Arjun Mehta | B2B Pool Lead | `B2B` |
| Prefill / Prove integration | Wei Zhang | Prefill Integration Lead | `PREFILL` |
| RTB & legacy TRON support | Noah Bennett | RTB & Legacy Lead | `TRON` |
| Native (iOS/Android) SDK onboarding | *No POC assigned yet* | Planned surface — not staffed | — |
| Conversational onboarding | *No POC assigned yet* | Planned surface — not staffed | — |

## External team dependencies (outside Onboarding Experience)

These are partner orgs, not staffing pools on this team — anything that trips these triggers needs a cross-team ask, not just internal scoping.

| External Team | POC | When to loop them in |
|---|---|---|
| Identity | Rina Bhatt (Identity partner liaison) | Anything touching identity verification, KYC, document upload, or the Prove integration |
| Risk | Dana Whitfield (Risk partner liaison — distinct from the Risk *product surface* pool above) | Anything touching fraud checks, risk decisioning, or real-time risk streaming behavior |
| Compliance / Legal | Owen Fletcher (Compliance partner liaison) | Anything with a regulatory deadline, required disclosure, or consent-flow change (e.g. Amex-style consent requirements) |
| Security | Layla Haddad (Security partner liaison) | Anything touching auth, PII handling, or new data collection/storage |
| Data | Chris Nolan (Data partner liaison) | Anything requiring new tracking/analytics events or changes to how onboarding data is stored/queried |

## Escalation path

For anything cross-surface (touches 2+ internal component rows above), loop in Apurva (EM, Onboarding Experience) directly rather than picking one POC — cross-surface asks need roadmap-level sequencing, not just a single team's sign-off. For anything touching an external team dependency above, loop in that team's POC *in addition to* the internal POC — don't scope external-facing work without them at the table.

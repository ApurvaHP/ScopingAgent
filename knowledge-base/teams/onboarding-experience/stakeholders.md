# Onboarding Experience — Leadership & Stakeholder Map

Dummy/placeholder names for demo purposes — swap in real names before using internally.

## Reporting & escalation chain

| Role | Name | When to loop in |
|---|---|---|
| Engineering Manager (this role) | Apurva Hosagavi Puttaraju | Any cross-surface ask, anything P0/P1, anything requiring roadmap re-sequencing |
| Skip-level / Director | Marcus Webb | P0 asks with exec visibility, anything requiring budget or headcount, escalations Apurva can't resolve at her level |
| Principal Engineer (platform-wide) | Sanjay Kapoor | Architectural decisions with cross-team blast radius beyond Onboarding Experience |
| Product Lead, Onboarding | Elena Vasquez | Any ask reshaping the product roadmap itself, not just a single feature |

## Cross-functional executive stakeholders

| Function | Name | Why they'd care |
|---|---|---|
| VP, Payments & Money Movement | Grace Lindqvist | Anything touching Payments, Lending, or BillPay integration surfaces at scale |
| VP, Risk & Trust | Malik Osei | Anything touching fraud, compliance, or identity verification with real financial exposure |
| Head of Product, Platform | Renata Silva | Anything affecting the extensibility contract other product teams rely on |

## Escalation guidance

- **P0 + cross-surface**: loop in Apurva + the relevant external-team POC (see `pocs.md`) same day.
- **P0 + exec visibility** (compliance deadline, revenue-critical, customer-facing incident): loop in Marcus Webb within 24 hours, not after the fact.
- **Architectural precedent-setting decisions** (new state management pattern, new caching strategy, anything that becomes "the way NEON does X" for other teams): loop in Sanjay Kapoor before committing, even if the immediate ask is small.
- **Roadmap tradeoffs** (this ask means something else slips): loop in Elena Vasquez — an EM shouldn't make that call unilaterally.

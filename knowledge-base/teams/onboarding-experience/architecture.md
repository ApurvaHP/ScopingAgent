# NEON & Onboarding Service — Architecture Summary

**Platform**: NEON (React/TypeScript UI) + Onboarding Service (dedicated backend-for-frontend / orchestration layer). Replaced the legacy TRON platform, which was schema-driven via a Camunda DMN-table UI Orchestrator — any new interaction required a schema change plus a code change on both frontend and backend.

**Extensibility contract**: NEON exposes a props-based contract that lets invoking product teams customize their onboarding flow without forking shared code or touching the platform team's codebase. This cut new-team integration time from 2 weeks to 3 days.

**Caching**: Field-level, server-managed caching with backend deep merge. Every field change is cached instantly — no data loss on browser close, and it enables real-time field streaming to Risk (cut risk-decision latency from ~20s to ~8s).

**State management**: Intentionally minimal — local React state plus a server-written React Context. No Redux (TRON's global-store approach caused hard-to-trace event loops).

**Known integration surfaces today**: Payroll, Payments, Lending, BillPay, B2B, Risk. Each of these already has a signed integration contract with NEON and a dedicated comms channel.

**Not yet built**: native (iOS/Android) SDK onboarding, conversational onboarding, and external partner onboarding are all on the extensibility roadmap but have no committed engineering time yet — they were designed for, not built for, in the current architecture.

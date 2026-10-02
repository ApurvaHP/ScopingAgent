# Scoping Agent

A small live demo tool: paste in a raw ask/feature request and it scores it against an Impact / Scope / Size prioritization framework, returning a Now / Fast-Follow / Decline verdict with reasoning, a priority (P0–P3), confidence level, and — for anything worth pursuing — technical scoping, suggested owners, strategic questions, and a text-based prototype outline.

Grounded in a real, team-scoped knowledge base under `knowledge-base/teams/<team-id>/`:

- `team.json` — staffing pools and capacity
- `roadmap.json` — what's shipped and planned
- `architecture.md` — the system's real shape
- `decisions.json` — past triage calls, used for precedent-matching (the tool surfaces the closest past decision to the current ask)
- `pocs.md` — internal component owners + Jira boards, and external team dependencies (Identity, Risk, Compliance, Security)
- `stakeholders.md` — the reporting/escalation chain and exec stakeholders, used to auto-flag when an ask needs escalation and to whom
- `metrics.md` — the metrics the team actually tracks, used to tell you which metric an ask should move (or flag that it doesn't map to one)

The UI shows exactly which knowledge-base files were retrieved and a preview of what was pulled, so it's visibly grounded, not a black box.

## This is an agent, not a single prompt

Earlier versions of this tool made one LLM call with one fixed prompt — that's a workflow, not an agent. This version runs an actual multi-turn tool-use loop where the model decides what to do, not the code:

1. **Playbook routing** — the model's first move, every time, is to classify the ask and pick one of several specialized "playbooks" (Compliance/Legal, Platform/Architecture, Cross-Team Dependency, Product Feature, General). That playbook's specific guidance — different weighting on verdict, escalation, and questions — gets injected into its own context before it does anything else. This is the literal answer to "can it pick the right prompt for the situation": it does, out loud, as its first tool call.
2. **Optional research tools** — `search_alternate_precedent` (re-search the decisions log with different phrasing) and `lookup_external_component` (check a component/team it isn't confident about) are available but not mandatory; the model decides for itself whether it needs another look before finalizing.
3. **`request_clarification`** — when an ask is genuinely too thin to score responsibly (see the last example chip below), the agent stops and asks a clarifying question back instead of guessing. Answer it in the UI and it re-triages with the added detail.
4. **`finalize_triage`** — always the last step; this is what actually produces the result, delivered as structured tool input rather than parsed-from-text JSON (more reliable than the old "please return valid JSON" approach).

Every step is logged to an `agentTrace` and rendered in the UI under "Agent Reasoning Trace" — so in a live demo you can point at the actual sequence of decisions the model made, not just the final answer. There are no real external tool integrations (no live Jira/Slack calls) — the two research tools operate on the same local knowledge-base data already loaded — but the key agentic property holds regardless: the model chooses which tool to call and when it's done, the code doesn't script the sequence for it.

The offline fallback mirrors this shape deterministically (a keyword-based playbook classifier, a rule-based clarification trigger, the same trace format) so the UI behaves identically whether the live model or the fallback produced the answer.

**Team-portable by design**: which team's knowledge base gets loaded is controlled by the `TEAM_ID` env var (defaults to `onboarding-experience`). Point it at another team's folder under `knowledge-base/teams/` and the tool reasons from that team's context instead — no code changes. See `knowledge-base/teams/README.md` for how to onboard a new team.

Built for a live interview demo — has a deterministic offline fallback scorer so it never visibly breaks if the Claude API call fails mid-demo. The fallback reads the same knowledge base and mirrors the live model's reasoning: component-matching, staffing-pool-aware sizing, precedent-matching, metric-alignment, and escalation logic — not just a degraded stub.

To change the context the tool reasons from, just edit the files in `knowledge-base/teams/<team-id>/` — no code changes needed.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel (same pattern as your other tools)

1. Push this folder to a GitHub repo (or run `npx vercel` directly from this folder).
2. In the Vercel project settings, add an environment variable `ANTHROPIC_API_KEY` with your key.
3. Deploy. No other config needed — it's a standard Next.js app.

If `ANTHROPIC_API_KEY` is not set, the app still works: it silently uses the offline fallback scorer (a simple keyword-based heuristic) instead of failing. The UI shows an "offline fallback scorer" tag when that path is used, so you always know which mode produced a result — worth knowing before a live demo, but harmless either way.

## Demo tips

- The example chips on the page are pre-loaded asks spanning all three verdicts (Now, Fast-Follow, Decline) and a mix of compliance/revenue/vague asks — good for showing the range quickly without typing live.
- If you want a guaranteed offline demo (no network dependency at all), just don't set `ANTHROPIC_API_KEY` in that deployment — it'll always use the fallback scorer, which is fast and consistent.
- The result card's left border is color-coded by priority (P0 red, P1 amber, P2 blue, backlog gray) — visible at a glance even before reading anything.
- Each triage is added to a session history rail on the right; click a past entry to revisit it without re-running it — useful if you want to show 2-3 asks back to back and then compare.
- "Copy summary" on the result card copies a plain-text version of the full output — handy for pasting into a follow-up Slack message or ticket after the demo.
- Sections below the top-line verdict (Technical Scoping, Build Estimate, Who To Work With, Strategic Questions, Prototype Outline, What Was Retrieved, Agent Reasoning Trace) are collapsible — the highest-signal ones start open, the rest start collapsed so the card doesn't overwhelm on first look.
- The last example chip ("Someone on the team suggested we look into improving onboarding somehow") is deliberately vague — use it to show the `request_clarification` path live: the agent stops and asks a question back instead of guessing, and you can answer inline to re-triage.
- The "Lens: ..." tag at the top of each result is the playbook the agent picked for that ask — a good thing to point at when asked whether it's "just one prompt."

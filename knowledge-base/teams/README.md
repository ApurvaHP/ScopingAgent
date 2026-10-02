# Adding another team

The Scoping Agent isn't hardcoded to one team — it reads whichever folder `TEAM_ID` points at.

To onboard a new team:

1. Copy `onboarding-experience/` to `<your-team-id>/`.
2. Fill in your own `team.json` (staffing), `roadmap.json` (what's shipped/planned), `architecture.md` (your system's real shape), `decisions.json` (past triage calls, if any exist — start empty if not), `pocs.md` (component owners + external dependencies), `stakeholders.md` (your escalation chain), and `metrics.md` (what you actually measure).
3. Set the environment variable `TEAM_ID=<your-team-id>` in your deployment.
4. Redeploy. No code changes needed — the API reads the folder name from the env var at request time.

If `TEAM_ID` isn't set, it defaults to `onboarding-experience` (the demo team used to build this).

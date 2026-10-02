import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

const KB_FILE_LIST = ["team.json", "roadmap.json", "architecture.md", "decisions.json", "pocs.md", "stakeholders.md", "metrics.md"];

function loadKnowledgeBase() {
  const teamId = process.env.TEAM_ID || "onboarding-experience";
  const kbDir = path.join(process.cwd(), "knowledge-base", "teams", teamId);
  const team = JSON.parse(fs.readFileSync(path.join(kbDir, "team.json"), "utf-8"));
  const roadmap = JSON.parse(fs.readFileSync(path.join(kbDir, "roadmap.json"), "utf-8"));
  const architecture = fs.readFileSync(path.join(kbDir, "architecture.md"), "utf-8");
  const decisions = JSON.parse(fs.readFileSync(path.join(kbDir, "decisions.json"), "utf-8"));
  const pocs = fs.readFileSync(path.join(kbDir, "pocs.md"), "utf-8");
  const stakeholders = fs.readFileSync(path.join(kbDir, "stakeholders.md"), "utf-8");
  const metrics = fs.readFileSync(path.join(kbDir, "metrics.md"), "utf-8");
  return { teamId, team, roadmap, architecture, decisions, pocs, stakeholders, metrics };
}

// Simple word-overlap similarity — good enough to surface "closest precedent" for a demo-scale
// decisions log without needing embeddings/a vector store.
function findClosestPrecedent(ask, decisions) {
  const askWords = new Set(ask.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  let best = null;
  let bestScore = 0;
  for (const d of decisions) {
    const dWords = new Set(d.ask.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const overlap = [...askWords].filter((w) => dWords.has(w)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = d;
    }
  }
  return bestScore >= 2 ? { ...best, matchStrength: bestScore } : null;
}

// Slice caps here used to truncate every markdown KB file well before its end — architecture.md,
// pocs.md, stakeholders.md, and metrics.md are all under 3KB, but each cap cut off 35-45% of the
// file, and in every case the truncated part was the guidance/escalation-table section at the
// bottom, not filler. That's what let the model invent a Legal contact instead of using the real
// one (Owen Fletcher) sitting just past the old cutoff. These files are small — just send them
// whole rather than guessing a safe slice length.
function summarizeKB(kb) {
  const shipped = kb.roadmap.filter((r) => r.status === "Shipped").map((r) => r.name);
  const planned = kb.roadmap.filter((r) => r.status === "Planned").map((r) => r.name);
  return {
    team: `Team: ${kb.team.teamName}, ${kb.team.teamSize} engineers across ${kb.team.staffingPools.length} staffing pools (${kb.team.staffingPools.map((p) => `${p.pool}: ${p.count}`).join(", ")}). ${kb.team.capacityNote} ${kb.team.sprintCadence || ""} ${kb.team.aiDevelopmentStream || ""}`,
    roadmap: `Shipped in FY26: ${shipped.join(", ")}. Planned but not yet staffed: ${planned.join(", ")}.`,
    architecture: kb.architecture,
    decisions: `Past triage calls on record: ${kb.decisions.map((d) => `[${d.date}] "${d.ask}" → ${d.verdict} (${d.reason})`).join(" | ")}`,
    pocs: kb.pocs,
    stakeholders: kb.stakeholders,
    metrics: kb.metrics,
  };
}

// Mirrors knowledge-base/pocs.md for the offline fallback path (no markdown parsing needed —
// this is the same POC data, kept in sync by hand since it's small and demo-scoped).
const POC_MAP = {
  "neon ui": { poc: "Kevin Park", role: "Tech Lead, NEON UI", jira: "NEON" },
  "onboarding service": { poc: "Priyanka Iyer", role: "Orchestration Lead", jira: "OBSVC" },
  "caching": { poc: "Priyanka Iyer", role: "Orchestration Lead (owns caching)", jira: "OBSVC" },
  "risk streaming": { poc: "Dana Whitfield + Priyanka Iyer", role: "Joint owners — Risk / Onboarding Service", jira: "RISK / OBSVC" },
  payroll: { poc: "Priya Raman", role: "Payroll Pool Lead", jira: "PAYROLL" },
  payments: { poc: "Jordan Lee", role: "Payments Pool Lead", jira: "PMTS" },
  lending: { poc: "Sam Okafor", role: "Lending Pool Lead", jira: "LEND" },
  billpay: { poc: "Maria Chen", role: "BillPay Pool Lead", jira: "BILLPAY" },
  b2b: { poc: "Arjun Mehta", role: "B2B Pool Lead", jira: "B2B" },
  risk: { poc: "Dana Whitfield", role: "Risk Pool Lead", jira: "RISK" },
};

// External partner-org dependencies — mirrors the "External team dependencies" table in pocs.md.
// Distinct from POC_MAP above: these are orgs OUTSIDE Onboarding Experience, triggered by keyword.
const EXTERNAL_DEPENDENCIES = [
  { team: "Identity", poc: "Rina Bhatt", triggers: ["identity", "kyc", "document upload", "prove", "verification"] },
  { team: "Risk", poc: "Dana Whitfield (Risk partner liaison)", triggers: ["risk", "fraud", "decision latency"] },
  { team: "Compliance / Legal", poc: "Owen Fletcher", triggers: ["compliance", "legal", "regulat", "consent", "disclosure"] },
  { team: "Security", poc: "Layla Haddad", triggers: ["security", "auth", "pii", "data collection", "data storage"] },
  { team: "Data", poc: "Chris Nolan", triggers: ["tracking", "analytics", "data storage", "reporting"] },
];

function findExternalDependencies(text) {
  return EXTERNAL_DEPENDENCIES.filter((dep) => dep.triggers.some((t) => text.includes(t))).map((dep) => ({
    team: dep.team,
    poc: dep.poc,
    why: `Ask references "${dep.triggers.find((t) => text.includes(t))}" — this is ${dep.team}'s domain, not Onboarding Experience's.`,
  }));
}

// Shared priority model — used by both the live LLM path (as a consistency check)
// and the offline fallback, so priority logic never depends on the model being reachable.
function derivePriority(impact, verdict) {
  if (verdict === "Decline") return { priority: "P3 / Backlog", reasoning: "Declined — not entering the roadmap, so no active priority." };
  if (impact === "High" && verdict === "Now") return { priority: "P0", reasoning: "High impact and cleared to start now — treat as top-of-queue." };
  if (impact === "High") return { priority: "P1", reasoning: "High impact but not yet clear to start (scope/size blocking) — high priority once unblocked." };
  if (impact === "Medium" && verdict === "Now") return { priority: "P1", reasoning: "Real impact and ready to go — sequence behind any active P0s." };
  if (impact === "Medium") return { priority: "P2", reasoning: "Real but not urgent — reasonable to batch with other Fast-Follow work." };
  return { priority: "P2", reasoning: "Low impact but cheap enough to be worth a slot — bottom of the active queue, not the backlog." };
}

// ============ AGENTIC TOOL-USE LAYER ============
// This is what makes the triage step an agent loop rather than a single-shot prompt: the model is
// given tools and decides for itself, turn by turn, whether it has enough to finalize, whether it
// should dig for a better precedent match, whether an ask needs a human clarification instead of a
// guess, and only concludes by explicitly calling finalize_triage. There are no real external
// integrations here (no live Jira/Slack) — the two research tools operate on the same local
// knowledge-base data already loaded, but the key agentic property holds: the MODEL chooses which
// tool to call and when it's done, the code doesn't hard-script the sequence.
const FINALIZE_SCHEMA = {
  type: "object",
  properties: {
    impact: { type: "object", properties: { score: { type: "string", enum: ["Low", "Medium", "High"] }, reasoning: { type: "string" } }, required: ["score", "reasoning"] },
    scope: { type: "object", properties: { score: { type: "string", enum: ["Unclear", "Partial", "Clear"] }, reasoning: { type: "string" } }, required: ["score", "reasoning"] },
    size: { type: "object", properties: { score: { type: "string", enum: ["Small", "Medium", "Large"] }, reasoning: { type: "string" } }, required: ["score", "reasoning"] },
    verdict: { type: "string", enum: ["Now", "Fast-Follow", "Decline"] },
    verdictReasoning: { type: "string", description: "1-2 sentences, pragmatic EM voice, referencing precedent where relevant" },
    confidence: { type: "object", properties: { level: { type: "string", enum: ["Low", "Medium", "High"] }, reasoning: { type: "string" } } },
    priority: { type: "object", properties: { level: { type: "string", enum: ["P0", "P1", "P2", "P3 / Backlog"] }, reasoning: { type: "string" } } },
    closestPrecedent: { type: "object", properties: { ask: { type: "string" }, verdict: { type: "string" }, reason: { type: "string" } }, description: "Omit this field entirely if nothing in the decisions log is meaningfully similar" },
    metricAlignment: { type: "string", description: "Which tracked metric this should move, or a note that it doesn't map to one" },
    escalation: { type: "object", properties: { needed: { type: "boolean" }, who: { type: "string", description: "Must be a name/role that appears verbatim in the retrieved context — never a title you construct yourself" }, why: { type: "string" } } },
    technicalScoping: {
      type: "object",
      description: "Omit entirely if verdict is Decline",
      properties: {
        componentsAffected: { type: "array", items: { type: "string" } },
        impactSummary: { type: "string" },
        scopeOfWork: { type: "array", items: { type: "string" } },
        suggestedStaffing: { type: "object", properties: { engineers: { type: "number" }, reasoning: { type: "string" } } },
        edgeCases: { type: "array", items: { type: "string" }, description: "3-4 specific to this ask, grounded in the retrieved architecture" },
      },
    },
    strategicQuestions: {
      type: "object",
      description: "Omit entirely if verdict is Decline",
      properties: {
        forProduct: { type: "array", items: { type: "string" } },
        forEngineering: { type: "array", items: { type: "string" } },
      },
    },
    buildEstimate: {
      type: "object",
      description: "REQUIRED whenever verdict is Now or Fast-Follow — never omit it for those verdicts, even if scope is still Partial or the spec isn't finalized yet. In that case, give your best current-information estimate and caveat the uncertainty inside individual task notes (e.g. 'assumes final spec matches current scope discussion; re-estimate once requirements are confirmed') rather than leaving the field out. Only omit this entirely if verdict is Decline. A single estimate that already assumes AI-assisted development — not a with/without-AI comparison.",
      properties: {
        totalDays: { type: "number" },
        sprintEquivalent: { type: "string" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              task: { type: "string" },
              effortDays: { type: "number" },
              owner: { type: "string", enum: ["AI-Assisted", "Engineer-Required"] },
              note: { type: "string" },
            },
            required: ["task", "effortDays", "owner", "note"],
          },
        },
      },
    },
    suggestedPOCs: { type: "array", items: { type: "object", properties: { component: { type: "string" }, poc: { type: "string", description: "Name/role verbatim from the retrieved POC table — never invented" }, jiraBoard: { type: "string" } } } },
    externalDependencies: { type: "array", items: { type: "object", properties: { team: { type: "string" }, poc: { type: "string", description: "Name/role verbatim from the retrieved external-dependencies table — never invented" }, why: { type: "string" } } } },
    prototype: {
      type: "object",
      description: "Omit entirely if verdict is Decline",
      properties: {
        buildApproach: { type: "string" },
        flowSteps: { type: "array", items: { type: "string" } },
        keyFields: { type: "array", items: { type: "string" } },
        anticipatedChallenges: { type: "array", items: { type: "string" } },
      },
    },
  },
  required: ["impact", "scope", "size", "verdict", "verdictReasoning"],
};

// Multiple specialized "playbooks" the agent can route an ask through — this is the answer to
// "can it pick the right prompt for the situation": rather than one fixed prompt for every ask,
// the agent's first move is always to classify the ask and select the lens that fits, and that
// lens's guidance gets injected into its own context before it does anything else. Same pattern
// used by both the live model (via the select_playbook tool, forced on turn 1) and the offline
// fallback (via a deterministic classifier), so the routing behavior is visible either way.
const PLAYBOOKS = {
  complianceLegal: {
    label: "Compliance / Legal",
    guidance:
      "This ask is compliance/legal-driven. Weight verdict heavily toward meeting the deadline safely — treat \"Now\" as the default when there's a hard regulatory deadline and finalized requirements, don't let it get stuck on generic scope debate. metricAlignment should default to \"delivered on time, zero incidents,\" not a growth-metric framing, unless there's a clear secondary growth angle worth naming. Lean toward escalation.needed = true if there's real exec/compliance exposure — this is one of the few categories where over-flagging is safer than under-flagging. strategicQuestions.forProduct should press on how hard the deadline actually is and who set it; forEngineering should press on whether the requirement changes an existing contract in a way that affects other surfaces.",
  },
  platformTechDebt: {
    label: "Platform / Architecture",
    guidance:
      "This ask touches platform architecture or an unbuilt surface (native SDK, conversational, migration, rearchitect, schema change). Treat size conservatively — lean Large unless there's strong evidence otherwise — and call out in scopeOfWork that a design spike is needed before committing real staffing. Escalation should lean toward involving Sanjay Kapoor (Principal Engineer, per stakeholders.md) for anything that sets an architectural precedent, even if the immediate ask feels small. Don't let a confident-sounding ask talk you out of flagging the real unknowns here.",
  },
  crossTeamDependency: {
    label: "Cross-Team Dependency",
    guidance:
      "This ask pulls in at least one team outside Onboarding Experience (Identity, Risk, Compliance/Legal, Security, or Data). Weight scope conservatively until that team's requirements are actually confirmed — an ask can look Clear internally but still be effectively Unclear once you account for an external dependency's own timeline. strategicQuestions.forProduct should include confirming which external team owns the requirement and by when; escalation.why should name the specific external POC to loop in from the pocs.md external-dependencies table, not just the internal chain.",
  },
  productFeature: {
    label: "Product Feature",
    guidance:
      "This is a standard product-driven feature ask with no unusual compliance, architecture, or cross-team complication. Apply the impact/scope/size framework directly without extra weighting. strategicQuestions.forProduct should press on measurable success criteria and whether this competes with an existing roadmap commitment; forEngineering should press on whether this reuses an existing pattern or requires something net-new.",
  },
  general: {
    label: "General",
    guidance: "No strong signal that this fits one of the specialized lenses — apply the standard framework as-is, without additional weighting in any direction.",
  },
};

function classifyPlaybook(text) {
  const complianceHits = ["compliance", "legal", "regulat", "consent", "disclosure"].some((w) => text.includes(w));
  const platformHits = ["native sdk", "ios sdk", "android sdk", "conversational", "external partner", "migration", "rearchitect", "new service", "new backend", "schema change"].some((w) => text.includes(w));
  const externalHits = ["identity", "kyc", "verification", "risk", "fraud", "security", "auth", "pii", "data storage"].some((w) => text.includes(w));
  if (complianceHits) return "complianceLegal";
  if (platformHits) return "platformTechDebt";
  if (externalHits) return "crossTeamDependency";
  return "productFeature";
}

const TOOLS = [
  {
    name: "select_playbook",
    description: `Classify what kind of ask this is and select the triage playbook that best fits — always call this FIRST, exactly once, before any other tool. Available lenses: ${Object.entries(
      PLAYBOOKS
    )
      .map(([key, p]) => `"${key}" (${p.label})`)
      .join(", ")}. Pick "general" only if nothing else clearly applies.`,
    input_schema: {
      type: "object",
      properties: {
        lens: { type: "string", enum: Object.keys(PLAYBOOKS) },
        why: { type: "string", description: "One sentence on why this lens fits" },
      },
      required: ["lens", "why"],
    },
  },
  {
    name: "search_alternate_precedent",
    description: "Search the past-decisions log again using different or broader search terms than the raw ask text. Use this when the ask's literal wording doesn't obviously match a past decision, but the underlying situation might (e.g. a different partner name, but the same 'partner consent disclosure' pattern).",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Alternate search phrase to match against past decisions" } }, required: ["query"] },
  },
  {
    name: "lookup_external_component",
    description: "Look up whether a specific component, surface, or team name maps to a known internal POC or external team dependency. Use this when the ask mentions something you're not fully confident is covered by the retrieved POC/external-dependency context.",
    input_schema: { type: "object", properties: { term: { type: "string", description: "Component, surface, or team name to look up" } }, required: ["term"] },
  },
  {
    name: "request_clarification",
    description: "Call this INSTEAD of finalize_triage only when the ask has NO discernible business driver AND NO discernible feature/action AND NO scope signal at all — e.g. 'someone suggested we look into improving onboarding somehow.' Do NOT call this for an ask that names a requester, a feature or problem, and gives at least rough scope information (mockups, a stated deadline, 'no launch date yet', 'spec finalized', an incident description with urgency) — score those with stated assumptions instead, even if some details are still missing. A production incident, outage, or hotfix request is NEVER ambiguous enough to need this — those always get scored as high-impact and urgent. This tool exists for the rare truly-contentless one-liner, not for routine underspecification. When in doubt, finalize with a lower confidence level rather than stopping to ask.",
    input_schema: { type: "object", properties: { question: { type: "string", description: "The single most important clarifying question to ask back" }, reason: { type: "string", description: "One sentence on why you can't responsibly score this without an answer" } }, required: ["question", "reason"] },
  },
  {
    name: "finalize_triage",
    description: "Submit the final triage result and conclude. Always call this to finish, unless you called request_clarification instead.",
    input_schema: FINALIZE_SCHEMA,
  },
];

const AGENT_SYSTEM_PROMPT = (ctx) => `You are a triage agent for an engineering manager who runs a busy onboarding platform team. You have retrieved the following real context about this team from its knowledge base before scoring anything — ground your reasoning in it, don't just react to the raw text of the ask.

RETRIEVED CONTEXT — TEAM:
${ctx.team}

RETRIEVED CONTEXT — ROADMAP (FY26):
${ctx.roadmap}

RETRIEVED CONTEXT — ARCHITECTURE:
${ctx.architecture}

RETRIEVED CONTEXT — PAST TRIAGE DECISIONS (precedent):
${ctx.decisions}

RETRIEVED CONTEXT — COMPONENT POCs & JIRA BOARDS:
${ctx.pocs}

RETRIEVED CONTEXT — LEADERSHIP & STAKEHOLDER MAP:
${ctx.stakeholders}

RETRIEVED CONTEXT — SUCCESS METRICS THIS TEAM ACTUALLY TRACKS:
${ctx.metrics}

GROUNDING RULE — read this before anything else: every person you name (in escalation.who, suggestedPOCs, externalDependencies, or anywhere else) must be a name that appears verbatim in the RETRIEVED CONTEXT above. Never invent a name, a title, or a more senior-sounding substitute for someone who is actually named above — if the retrieved context says a compliance ask routes to a specific named liaison, use that exact person, even if you'd guess a "Deputy General Counsel" or similar title feels more fitting. If no one in the retrieved context clearly owns something, say so explicitly ("no named owner in the retrieved context — confirm with [closest named contact]") rather than fabricating a plausible-sounding person. This matters more than sounding authoritative.

Your very first action, before anything else, must be calling select_playbook to classify this ask and pick the lens that fits it best. Once you do, the matching playbook's guidance will be added to your context — apply it for the rest of your reasoning, on top of (not instead of) the base framework below.

Every ad hoc ask that comes in (from product, sales, another team, leadership) gets evaluated against this framework:

- IMPACT: How much does this move real business or customer outcomes? Vague requests with no measurable upside score low. Requests tied to revenue, conversion, compliance/legal deadlines, or a clear customer pain point score high.
- SCOPE: How well-defined is the ask? Is there a finalized design/spec, or is it still a loose idea? Requirements that are still being figured out score low; a signed-off spec, Figma, or mockups score high or at least partial. "No launch date yet" or "no timeline set" describes the ask's urgency, not its ambiguity — don't read that as missing scope.
- SIZE: How much engineering effort and risk does this actually require, realistically — GIVEN THE TEAM'S ACTUAL STAFFING ABOVE? An ask that maps cleanly to an existing staffing pool and known integration surface (Payroll, Payments, Lending, BillPay, B2B, Risk) is smaller in practice than one that doesn't map to any current pool, even if the raw engineering work looks similar — the second one requires re-prioritization, not just "fitting it in." An ask that resembles something already shipped (see roadmap) is lower-risk than one that touches an unbuilt surface (native SDK, conversational, external partner). If a similar ask appears in the past-decisions log, weigh that precedent explicitly in your reasoning.

Priority follows directly from impact + verdict, not a separate judgment call: High impact + Now = P0. High impact but blocked (Fast-Follow/scope not ready) = P1. Medium impact + Now = P1. Medium impact + Fast-Follow = P2. Low impact (any verdict that isn't Decline) = P2. Decline = P3/Backlog.

Escalation: use the stakeholder map above and name exactly who it names — for a compliance/legal ask, that's the Compliance/Legal liaison from the external-dependencies table (pocs.md), not a title you construct yourself. Only flag escalation as needed for P0 asks with exec visibility (compliance deadline, revenue-critical, customer-facing incident), architectural precedent-setting decisions, or anything that trades off against the existing roadmap. Most asks — even P0 ones — don't need escalation beyond the EM; don't over-flag.

If the verdict is "Now" or "Fast-Follow", also produce a technical scoping brief, grounded specifically in the architecture and staffing context retrieved above — real component names from the architecture doc, real staffing-pool logic from the team doc, not generic engineering platitudes — plus strategic clarifying questions split by who should answer them: Product/business questions vs. Engineering questions. If the verdict is "Decline", omit technicalScoping, prototype, buildEstimate, and strategicQuestions entirely (no point scoping work that isn't happening).

For the same "Now"/"Fast-Follow" cases, ALWAYS also produce a buildEstimate — this is not optional for these two verdicts, even when scope is only Partial or the spec is still being finalized with another team. An incomplete spec is a reason to caveat the estimate, not a reason to skip it: state your current-information assumption in the relevant task's note (e.g. "assumes the contract shape looks like X; re-estimate once Risk's spec is finalized") and still give real numbers. A single day/sprint-level estimate that already assumes this team's active AI-assisted development stream (see team context above) — not a comparison against a no-AI baseline, just the realistic estimate given how the team actually builds now. Break it into individual tasks each tagged as AI-Assisted or Engineer-Required. Ground the split in what AI is actually good at on this stack: scaffolding a new component off an existing pattern, generating tests/tracking events, drafting a first-pass diff against an already-defined contract — tag those AI-Assisted. Architecture/contract decisions, correctness-critical logic (e.g. the caching deep-merge), cross-team coordination, and anything with no existing pattern to scaffold from — tag those Engineer-Required, and say so even when it's the less flattering answer; don't force an AI-Assisted tag onto judgment-heavy work just to look more AI-native. Each task gets a realistic effort-day estimate for that specific task (not the whole ask). Sum them for totalDays. Express sprintEquivalent relative to the team's 2-week/10-working-day sprint cadence.

Verdict logic: "Now" for High impact + Clear-or-Partial scope + Small-or-Medium size. "Decline" for Low impact combined with either Large size (not worth the cost for the payoff) or Unclear scope (no clear value and no clear plan). A Low-impact ask that is Small/Medium size with real scope is a cheap quick win, not a decline — that's a "Fast-Follow". Everything else is "Fast-Follow" too (including High impact asks still blocked on Unclear scope — get scope first, don't greenlight blind). Only include externalDependencies entries that genuinely apply — most asks touch zero or one external team, not all five. Same for suggestedPOCs: only list components actually affected by this specific ask.

You have four tools: search_alternate_precedent, lookup_external_component, request_clarification, and finalize_triage. Decide for yourself which to use and in what order — you are not required to call the research tools, only to use them when they'd genuinely change your answer:
- Call search_alternate_precedent if the retrieved precedent context doesn't feel like a strong match but you suspect different phrasing would surface one.
- Call lookup_external_component if the ask references a system, team, or surface you're not confident is covered by the retrieved POC/external-dependency context.
- Call request_clarification instead of finalizing ONLY when the ask names no requester, no feature, and no scope signal at all. If the ask names who wants it and what they want, score it — a missing launch date, missing spec, or missing metric is something to note in your reasoning and strategic questions, not a reason to stop. This should fire on well under 1 in 20 asks.
- Always conclude by calling finalize_triage, unless you called request_clarification.`;

// Day/sprint estimate assuming the team's active AI-assisted dev stream (see team.json.aiDevelopmentStream).
// AI-Assisted tasks are scaffolding/boilerplate/test-generation work off an existing or newly-defined
// pattern; Engineer-Required tasks are architecture/contract decisions, correctness-critical logic, and
// cross-team coordination. This is a single estimate that already assumes AI assistance where it applies —
// not a with/without-AI comparison.
function buildEffortPlan({ matchesKnownSurface, matchedSurface, matchesUnbuiltSurface, text }) {
  const tasks = [];

  if (matchesKnownSurface) {
    tasks.push({
      task: `Decide how to extend the ${matchedSurface} props-based contract for this behavior`,
      effortDays: 1,
      owner: "Engineer-Required",
      note: "Contract-shape decision — AI can draft the prop-typing diff once the shape is chosen, but the shape itself is a judgment call.",
    });
    tasks.push({
      task: "Scaffold the new NEON UI component/field off the existing pattern",
      effortDays: 1,
      owner: "AI-Assisted",
      note: "Boilerplate React/TypeScript following an established pattern — strong AI fit; engineer reviews and wires it in.",
    });
    tasks.push({
      task: "Confirm the caching deep-merge handles the new field correctly",
      effortDays: 1,
      owner: "Engineer-Required",
      note: "Correctness-critical — a miss here silently drops data on browser close. Judgment call, not pattern-matching.",
    });
    tasks.push({
      task: "Generate the tracking event + test scaffolding",
      effortDays: 0.5,
      owner: "AI-Assisted",
      note: "AI drafts the tracking call and unit/integration test boilerplate from the existing pattern; engineer confirms the event matches metrics.md.",
    });
  } else if (matchesUnbuiltSurface) {
    tasks.push({
      task: "Design the new integration contract — no existing pattern to extend",
      effortDays: 3,
      owner: "Engineer-Required",
      note: "No precedent to scaffold from — real architecture work, likely needs cross-team alignment (see stakeholders.md).",
    });
    tasks.push({
      task: "Spike to confirm Onboarding Service can support the new surface",
      effortDays: 2,
      owner: "Engineer-Required",
      note: "Feasibility judgment call. AI can draft the spike code once direction is set, but the direction is the engineer's call.",
    });
    tasks.push({
      task: "Scaffold NEON UI component(s) once the contract is defined",
      effortDays: 1.5,
      owner: "AI-Assisted",
      note: "Once the contract shape is decided, component scaffolding is a strong AI fit.",
    });
    tasks.push({
      task: "Add tracking + risk-streaming hooks",
      effortDays: 1,
      owner: "AI-Assisted",
      note: "Pattern-following work once the hook shape is defined by the engineer.",
    });
  } else {
    tasks.push({
      task: "Scope and confirm which existing contract/pattern this maps to",
      effortDays: 1,
      owner: "Engineer-Required",
      note: "No clear surface match yet — needs an engineer to confirm before any scaffolding can start.",
    });
    tasks.push({
      task: "Build the change following the confirmed pattern",
      effortDays: 1.5,
      owner: "AI-Assisted",
      note: "Once the pattern is confirmed, implementation is largely AI-scaffoldable; engineer reviews.",
    });
    tasks.push({
      task: "Add tracking + test coverage",
      effortDays: 0.5,
      owner: "AI-Assisted",
      note: "AI drafts tracking/test boilerplate from the confirmed pattern.",
    });
  }

  if (text.includes("risk") || text.includes("fraud") || text.includes("mfa")) {
    tasks.push({
      task: "Validate risk-streaming latency budget isn't affected by the new field",
      effortDays: 1,
      owner: "Engineer-Required",
      note: "Latency-budget correctness (the ~8s target) is production-judgment territory, not something to hand to AI unreviewed.",
    });
  }
  if (text.includes("identity") || text.includes("kyc") || text.includes("verification")) {
    tasks.push({
      task: "Coordinate contract details with Identity team",
      effortDays: 0.5,
      owner: "Engineer-Required",
      note: "Cross-team coordination — needs a person, not a model.",
    });
  }

  const totalDays = Math.round(tasks.reduce((s, t) => s + t.effortDays, 0) * 10) / 10;
  const aiDays = Math.round(tasks.filter((t) => t.owner === "AI-Assisted").reduce((s, t) => s + t.effortDays, 0) * 10) / 10;
  const engineerDays = Math.round(tasks.filter((t) => t.owner === "Engineer-Required").reduce((s, t) => s + t.effortDays, 0) * 10) / 10;
  const sprintDays = 10;
  const sprintEquivalent =
    totalDays <= sprintDays
      ? `Fits within a single ${sprintDays}-day sprint`
      : `Spans ~${Math.ceil(totalDays / sprintDays)} sprints`;

  return { totalDays, aiDays, engineerDays, sprintEquivalent, tasks };
}

// Post-processing helper applied to BOTH the live model's parsed JSON and the offline fallback,
// so the AI-Assisted/Engineer-Required day split used for the UI's visual bar is always a real sum
// over the returned tasks, not a number the model (or the fallback) has to compute and could get wrong.
function withEffortSplit(buildEstimate) {
  if (!buildEstimate?.tasks) return buildEstimate;
  const aiDays = Math.round(buildEstimate.tasks.filter((t) => t.owner === "AI-Assisted").reduce((s, t) => s + (t.effortDays || 0), 0) * 10) / 10;
  const engineerDays = Math.round(buildEstimate.tasks.filter((t) => t.owner === "Engineer-Required").reduce((s, t) => s + (t.effortDays || 0), 0) * 10) / 10;
  return { ...buildEstimate, aiDays, engineerDays };
}

// Runs the actual agent loop: the model decides, turn by turn, whether to call a research tool,
// ask for clarification, or finalize. Returns { type: "result", ...fields, agentTrace } or
// { type: "clarification", question, reason, agentTrace }, or null if it never concluded within
// maxTurns (caller falls back to the deterministic scorer in that case).
async function runAgentLoop(anthropic, ask, kb, ctx) {
  const trace = [];
  let selectedPlaybook = null;
  let messages = [{ role: "user", content: `Raw ask to triage:\n\n${ask}` }];
  const maxTurns = 5;

  for (let turn = 0; turn < maxTurns; turn++) {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      system: AGENT_SYSTEM_PROMPT(ctx),
      tools: TOOLS,
      tool_choice: turn === 0 ? { type: "tool", name: "select_playbook" } : { type: "auto" },
      messages,
    });
    messages.push({ role: "assistant", content: msg.content });

    const toolUses = msg.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      messages.push({ role: "user", content: "Please continue by calling a tool — either request_clarification or finalize_triage." });
      continue;
    }

    const toolResults = [];
    for (const tu of toolUses) {
      if (tu.name === "select_playbook") {
        const playbook = PLAYBOOKS[tu.input.lens] || PLAYBOOKS.general;
        selectedPlaybook = { lens: tu.input.lens, label: playbook.label, why: tu.input.why };
        trace.push({ step: trace.length + 1, tool: "select_playbook", input: tu.input, output: `Selected "${playbook.label}" lens — ${tu.input.why}` });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Playbook selected: ${playbook.label}. Apply this guidance for the rest of your reasoning, on top of the base framework:\n\n${playbook.guidance}` });
        continue;
      }
      if (tu.name === "request_clarification") {
        trace.push({ step: trace.length + 1, tool: "request_clarification", input: tu.input, output: tu.input.question });
        return { type: "clarification", question: tu.input.question, reason: tu.input.reason, agentTrace: trace, playbook: selectedPlaybook };
      }
      if (tu.name === "finalize_triage") {
        trace.push({ step: trace.length + 1, tool: "finalize_triage", input: { verdict: tu.input.verdict, priority: tu.input.priority?.level }, output: `${tu.input.verdict}${tu.input.priority?.level ? " / " + tu.input.priority.level : ""}` });
        return { type: "result", ...tu.input, agentTrace: trace, playbook: selectedPlaybook };
      }
      if (tu.name === "search_alternate_precedent") {
        const precedent = findClosestPrecedent(tu.input.query || "", kb.decisions);
        const output = precedent ? `Matched: "${precedent.ask}" → ${precedent.verdict} (${precedent.reason})` : "No strong match found for that phrasing either.";
        trace.push({ step: trace.length + 1, tool: "search_alternate_precedent", input: tu.input, output });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: output });
      } else if (tu.name === "lookup_external_component") {
        const term = (tu.input.term || "").toLowerCase();
        const deps = findExternalDependencies(term);
        const pocKey = Object.keys(POC_MAP).find((k) => term.includes(k));
        const output = deps.length
          ? `External: ${deps.map((d) => `${d.team} (${d.poc})`).join("; ")}`
          : pocKey
          ? `Internal: ${POC_MAP[pocKey].poc} (${POC_MAP[pocKey].role}), board ${POC_MAP[pocKey].jira}`
          : "No match found for that term in the POC or external-dependency tables.";
        trace.push({ step: trace.length + 1, tool: "lookup_external_component", input: tu.input, output });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: output });
      } else {
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Unknown tool.", is_error: true });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return null; // never finalized within maxTurns
}

function fallbackScore(ask, kb) {
  const text = ask.toLowerCase();
  const summary = summarizeKB(kb);
  const knownSurfaces = ["payroll", "payments", "lending", "billpay", "b2b", "risk"];
  const unbuiltSurfaces = ["native sdk", "conversational", "external partner", "ios sdk", "android sdk"];

  const impactSignals = ["revenue", "conversion", "compliance", "legal", "regulat", "churn", "launch blocker", "customer complaint", "production issue", "production incident", "incident", "outage", "hotfix", "security", "fraud", "risk"];
  const impactHits = impactSignals.filter((w) => text.includes(w)).length;
  // An active incident affecting real users is definitionally high-impact and urgent — don't make it
  // fight its way to High through the same additive keyword count as a routine feature ask.
  const isActiveIncident = ["incident", "outage", "hotfix", "getting stuck", "users are", "production issue"].some((w) => text.includes(w));
  const impact = isActiveIncident ? "High" : impactHits >= 2 ? "High" : impactHits === 1 ? "Medium" : "Low";

  const scopeSignals = ["figma", "spec", "requirements", "acceptance criteria", "design doc", "prd", "mockup", "mockups ready", "wireframe"];
  const vagueSignals = ["not sure", "tbd", "figure out", "explore", "just an idea", "loosely", "no spec", "no design", "no figma", "no requirements", "not finalized", "not yet", "no data"];
  const hasScope = scopeSignals.some((w) => text.includes(w));
  const isVague = vagueSignals.some((w) => text.includes(w));
  const scope = isVague ? "Unclear" : hasScope ? "Clear" : "Partial";

  const largeSignals = ["new service", "rearchitect", "migration", "cross-team", "multiple teams", "new backend", "schema change"];
  const smallSignals = ["config", "copy change", "content change", "small tweak", "quick fix", "flag"];
  const matchesKnownSurface = knownSurfaces.some((w) => text.includes(w));
  const matchesUnbuiltSurface = unbuiltSurfaces.some((w) => text.includes(w));
  let size = largeSignals.some((w) => text.includes(w)) ? "Large" : smallSignals.some((w) => text.includes(w)) ? "Small" : "Medium";
  if (matchesUnbuiltSurface) size = "Large";
  else if (matchesKnownSurface && size === "Medium") size = "Small";

  // Deterministic mirror of the live agent loop's step-by-step behavior, so the UI can show a trace
  // regardless of which path produced the answer. Trigger clarification only when there's truly no
  // signal on any dimension — most real asks, even underspecified ones, still get scored.
  const trace = [];
  const playbookLens = classifyPlaybook(text);
  const playbook = { lens: playbookLens, label: PLAYBOOKS[playbookLens].label, why: `Keyword classification matched the "${PLAYBOOKS[playbookLens].label}" lens.` };
  trace.push({ step: 1, tool: "select_playbook", input: { lens: playbookLens }, output: `Selected "${playbook.label}" lens — ${playbook.why}` });

  // Precedent match happens BEFORE the clarification check (not after, as it did originally) because
  // "this closely resembles a past decision" is itself strong evidence the ask has real content —
  // relying only on a fixed keyword list to detect "signal" was too narrow and misfired on legitimate,
  // well-formed asks that just didn't happen to use one of those exact words.
  const earlyPrecedent = findClosestPrecedent(ask, kb.decisions);
  const wordCount = ask.trim().split(/\s+/).filter(Boolean).length;
  const hasAnySignal =
    impactHits > 0 ||
    hasScope ||
    isVague ||
    matchesKnownSurface ||
    matchesUnbuiltSurface ||
    largeSignals.some((w) => text.includes(w)) ||
    smallSignals.some((w) => text.includes(w)) ||
    !!earlyPrecedent ||
    wordCount >= 12; // a real sentence-length ask almost always carries some describable content, even without hitting a specific keyword list
  trace.push({
    step: 2,
    tool: "assess_confidence",
    input: { ask },
    output: hasAnySignal
      ? `Found usable signal${earlyPrecedent ? " (including a precedent match)" : wordCount >= 12 ? " (sentence-length ask with describable content)" : ""} — proceeding to score.`
      : "No usable signal found on impact, scope, size, or precedent, and the ask is too short to infer intent from.",
  });
  if (!hasAnySignal) {
    const question = "What's the business driver here, and roughly how big a lift does this feel like — is there anything close to a spec, or is this still just an idea?";
    const reason = "The raw ask gives no signal on impact, scope, or size — scoring it would be a guess dressed up as an answer.";
    trace.push({ step: 3, tool: "request_clarification", input: { question, reason }, output: question });
    return { type: "clarification", question, reason, agentTrace: trace, playbook, source: "fallback", contextUsed: KB_FILE_LIST };
  }

  let verdict = "Fast-Follow";
  if (impact === "High" && scope !== "Unclear" && size !== "Large") verdict = "Now";
  else if (impact === "Low" && size === "Large") verdict = "Decline";
  else if (impact === "Low" && scope === "Unclear") verdict = "Decline";

  const matchedSurface = knownSurfaces.find((w) => text.includes(w));
  const sizeReasoning = matchesUnbuiltSurface
    ? "Touches a surface with no committed staffing yet (native SDK / conversational / external partner) — treated as large regardless of raw complexity."
    : matchesKnownSurface
    ? `Maps to an existing integration surface (${matchedSurface}) with a signed contract and staffing pool already in place — lower effort in practice than a from-scratch build.`
    : "No strong signal on size, and it doesn't clearly map to a current staffing pool — defaulting to medium and flagging for re-prioritization review.";

  const { priority, reasoning: priorityReasoning } = derivePriority(impact, verdict);

  // Confidence: high when signals are unambiguous (multiple impact hits or a clear "vague" tell,
  // and a size that's driven by a real surface match, not the medium default), low otherwise.
  const signalCount = impactHits + (hasScope || isVague ? 1 : 0) + (matchesKnownSurface || matchesUnbuiltSurface ? 1 : 0);
  const confidenceLevel = signalCount >= 3 ? "High" : signalCount >= 1 ? "Medium" : "Low";
  const confidenceReasoning =
    confidenceLevel === "High"
      ? "Multiple clear signals in the ask text (impact, scope, and a known/unbuilt surface match) — low ambiguity."
      : confidenceLevel === "Medium"
      ? "Some signal present, but at least one dimension (impact, scope, or surface match) is a default guess — worth a second look before committing."
      : "Very little signal in the raw text — this is mostly a default guess. Get more detail before treating this as final.";

  const precedent = earlyPrecedent;
  trace.push({
    step: trace.length + 1,
    tool: "search_alternate_precedent",
    input: { query: ask.length > 60 ? ask.slice(0, 60) + "…" : ask },
    output: precedent ? `Matched: "${precedent.ask}" → ${precedent.verdict} (${precedent.reason})` : "No strong match in the decisions log.",
  });
  const externalDepsPreview = findExternalDependencies(text);
  trace.push({
    step: trace.length + 1,
    tool: "lookup_external_component",
    input: { term: externalDepsPreview.length ? externalDepsPreview.map((d) => d.team).join(", ") : "(none detected)" },
    output: externalDepsPreview.length ? `External: ${externalDepsPreview.map((d) => `${d.team} (${d.poc})`).join("; ")}` : "No external team dependency detected.",
  });
  const isComplianceDriven = text.includes("compliance") || text.includes("legal") || text.includes("regulat") || text.includes("consent") || text.includes("disclosure");
  const metricAlignment = isActiveIncident
    ? "This is incident response, not a roadmap bet — the metric is time-to-resolution and the number of affected users, not conversion or revenue. Don't dress this up as a growth win."
    : isComplianceDriven
    ? "Compliance/legal-driven — the metric here is \"delivered on time, zero incidents,\" not a growth metric. Don't force a conversion-lift framing onto this."
    : isVague
    ? "No clear success metric yet — ask Product what this should be measured against before committing engineering time."
    : text.includes("risk") || text.includes("fraud") || text.includes("latency")
    ? "Likely maps to risk-decision-latency (see metrics.md — cut from ~20s to ~8s precedent) — confirm the target with Product/Risk."
    : impact === "High"
    ? "Likely maps to conversion lift or net-new-users/revenue (see metrics.md) — confirm which one with Product before committing."
    : "Doesn't cleanly map to an existing tracked metric — treat as a hygiene/quick-win item, not a growth bet.";

  const escalationNeeded = priority === "P0" && (text.includes("compliance") || text.includes("legal") || text.includes("regulat") || text.includes("revenue") || text.includes("production issue") || isActiveIncident);

  trace.push({ step: trace.length + 1, tool: "finalize_triage", input: { verdict, priority }, output: `${verdict} / ${priority}` });

  const result = {
    type: "result",
    agentTrace: trace,
    playbook,
    impact: { score: impact, reasoning: `Keyword scan found ${impactHits} impact signal(s) in the request.` },
    scope: { score: scope, reasoning: isVague ? "Request language signals requirements are still being worked out." : hasScope ? "Request references concrete spec/design artifacts." : "No strong signal either way on scope readiness." },
    size: { score: size, reasoning: sizeReasoning },
    verdict,
    verdictReasoning: "Generated by the offline fallback scorer (Claude API unavailable) — a simple rules pass informed by the retrieved team/roadmap context, not a full model judgment. Good enough to keep the flow moving, but review before you commit to it.",
    confidence: { level: confidenceLevel, reasoning: confidenceReasoning },
    priority: { level: priority, reasoning: priorityReasoning },
    closestPrecedent: precedent ? { ask: precedent.ask, verdict: precedent.verdict, reason: precedent.reason } : null,
    metricAlignment,
    escalation: escalationNeeded
      ? { needed: true, who: "Marcus Webb (Director)", why: "P0 with compliance/legal/revenue signal — exec visibility warranted per the escalation guidance in stakeholders.md." }
      : { needed: false, who: null, why: null },
    source: "fallback",
    contextUsed: KB_FILE_LIST,
    contextPreview: summary,
  };

  if (verdict !== "Decline") {
    const componentsAffected = ["NEON UI (React/TypeScript)", "Onboarding Service (orchestration layer)"];
    if (matchesKnownSurface) componentsAffected.push(`${matchedSurface} integration contract (props-based, already signed)`);
    if (matchesUnbuiltSurface) componentsAffected.push("New integration contract — none exists today for this surface");
    if (text.includes("cach") || text.includes("draft") || text.includes("resume")) componentsAffected.push("Field-level caching layer");
    if (text.includes("risk") || text.includes("fraud") || text.includes("mfa")) componentsAffected.push("Real-time risk streaming endpoint");

    const engineers = size === "Small" ? 1 : size === "Medium" ? 2 : 3;
    const staffingReasoning = matchesKnownSurface
      ? `Most existing staffing pools run 1-2 engineers per surface (per team.json) — this fits that pattern.`
      : matchesUnbuiltSurface
      ? `No existing pool covers this surface, so this likely needs 3+ engineers pulled cross-functionally (backend + frontend + platform), not a single pool reassignment.`
      : `Defaulting to a typical pool size; confirm against the specific surface once scope is clearer.`;

    result.technicalScoping = {
      componentsAffected,
      impactSummary: `${impact}-impact ask (${impactHits} signal${impactHits === 1 ? "" : "s"} detected). ${impact === "High" ? "Worth prioritizing given the business/compliance signal present." : impact === "Medium" ? "Real but not urgent — reasonable to sequence behind higher-signal work." : "Limited measurable upside on its own; only worth it because the cost to deliver is low."}`,
      scopeOfWork: matchesKnownSurface
        ? [
            `Extend the ${matchedSurface} props-based contract to support this behavior`,
            "Update NEON UI to handle the new field/interaction",
            "Confirm caching behavior covers any new field introduced",
            "Add a tracking event so this change's impact is measurable post-launch",
          ]
        : [
            "Design a new integration contract for this surface (none exists today)",
            "Scope Onboarding Service support for the new surface",
            "Build the NEON UI component(s) once the contract is defined",
            "Add tracking + risk-streaming hooks as needed",
          ],
      suggestedStaffing: { engineers, reasoning: staffingReasoning },
      edgeCases: [
        "User abandons mid-flow — confirm the cached draft state correctly covers this new field/interaction on resume.",
        "Existing users who onboarded before this change existed — confirm backfill or fallback behavior is defined.",
        matchesKnownSurface ? `Concurrent onboarding across products — confirm this doesn't conflict with another in-flight change on the ${matchedSurface} surface.` : "This surface has no existing integration pattern — confirm it doesn't bypass the standard risk-streaming or caching contracts other surfaces rely on.",
      ],
    };
    result.strategicQuestions = {
      forProduct: [
        "What's the measurable success metric for this, and what's the target — how will we know it worked?",
        isVague ? "What's the actual business driver — a customer ask, a competitive gap, or an internal idea?" : "Is there a hard deadline behind this, or is the timeline negotiable if it competes with other roadmap work?",
      ],
      forEngineering: [
        matchesKnownSurface ? `Does the existing ${matchedSurface} props contract already cover this, or does the contract itself need to change?` : "Does this require a net-new integration pattern, or can it reuse something from an existing surface?",
        "Does this introduce any new field that needs to stream to Risk, and if so, does that change the latency budget?",
      ],
    };

    const pocEntries = [];
    if (matchesKnownSurface && POC_MAP[matchedSurface]) pocEntries.push({ component: `${matchedSurface} integration`, ...POC_MAP[matchedSurface] });
    pocEntries.push({ component: "NEON UI", ...POC_MAP["neon ui"] });
    pocEntries.push({ component: "Onboarding Service", ...POC_MAP["onboarding service"] });
    if (text.includes("cach") || text.includes("draft") || text.includes("resume")) pocEntries.push({ component: "Field-level caching", ...POC_MAP["caching"] });
    if (text.includes("risk") || text.includes("fraud") || text.includes("mfa")) pocEntries.push({ component: "Real-time risk streaming endpoint", ...POC_MAP["risk streaming"] });
    result.suggestedPOCs = pocEntries;
    result.externalDependencies = findExternalDependencies(text);

    result.buildEstimate = buildEffortPlan({ matchesKnownSurface, matchedSurface, matchesUnbuiltSurface, text });

    result.prototype = {
      buildApproach: matchesKnownSurface
        ? `Start from the ${matchedSurface} surface's existing props contract as the template — extend it rather than designing from scratch. Ship behind a feature flag, validate with the ${matchedSurface} POC before wiring into the main flow.`
        : "No existing pattern to extend — start with a throwaway spike against the Onboarding Service orchestration layer to confirm the integration is even feasible before committing to a build plan.",
      flowSteps: ["Step 1: Define the trigger/entry point for this change.", "Step 2: Confirm the primary user-facing behavior.", "Step 3: Identify what confirmation or fallback state is needed."],
      keyFields: ["Exact copy/content for any new user-facing text", "Owner sign-off before entering the sprint"],
      anticipatedChallenges: [
        isVague ? "Requirements are still loose — biggest risk is building the wrong thing before scope firms up." : "Standard integration risk — coordinate timing with the owning surface's existing release cadence.",
        matchesUnbuiltSurface ? "No existing contract to extend means the first version will likely need a second pass once real usage surfaces edge cases." : "Field-level caching means any new field needs explicit handling in the deep-merge logic, or it silently won't persist across a browser close.",
      ],
    };
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }
  const { ask, forceFallback } = req.body || {};
  if (!ask || typeof ask !== "string" || !ask.trim()) {
    return res.status(400).json({ error: "Provide an 'ask' string describing the request to triage." });
  }

  let kb;
  try {
    kb = loadKnowledgeBase();
  } catch (err) {
    console.error("Failed to load knowledge base:", err.message);
    return res.status(500).json({ error: "Knowledge base files missing — check the knowledge-base/ folder was deployed." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  // forceFallback lets the UI demo the deterministic path on demand, without touching the env var
  // or redeploying — useful for showing both paths side by side in a live walkthrough.
  if (!apiKey || forceFallback) {
    return res.status(200).json(fallbackScore(ask, kb));
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const ctx = summarizeKB(kb);
    const agentResult = await runAgentLoop(anthropic, ask, kb, ctx);
    if (!agentResult) throw new Error("Agent did not conclude (finalize or clarify) within max turns");

    if (agentResult.type === "result" && agentResult.buildEstimate) {
      agentResult.buildEstimate = withEffortSplit(agentResult.buildEstimate);
    }
    // Safety net: the system prompt now instructs the model to always produce a buildEstimate for
    // Now/Fast-Follow verdicts even against an unfinished spec, but a tool-use response can still
    // omit an optional field despite instructions. Rather than silently show no estimate in the UI,
    // synthesize one with the same deterministic logic the offline path uses, and flag it clearly as
    // a lower-confidence estimate so the user knows this specific number came from the fallback
    // heuristic, not the model's own reasoning about this ask.
    if (agentResult.type === "result" && !agentResult.buildEstimate && agentResult.verdict !== "Decline") {
      const text = ask.toLowerCase();
      const knownSurfaces = ["payroll", "payments", "lending", "billpay", "b2b", "risk"];
      const unbuiltSurfaces = ["native sdk", "conversational", "external partner", "ios sdk", "android sdk"];
      const matchesKnownSurface = knownSurfaces.some((w) => text.includes(w));
      const matchesUnbuiltSurface = unbuiltSurfaces.some((w) => text.includes(w));
      const matchedSurface = knownSurfaces.find((w) => text.includes(w));
      agentResult.buildEstimate = withEffortSplit(buildEffortPlan({ matchesKnownSurface, matchedSurface, matchesUnbuiltSurface, text }));
      agentResult.buildEstimateSource = "heuristic-fallback";
    }
    agentResult.source = "claude";
    agentResult.contextUsed = KB_FILE_LIST;
    agentResult.contextPreview = ctx;
    return res.status(200).json(agentResult);
  } catch (err) {
    console.error("Claude agent loop failed, using fallback:", err.message);
    return res.status(200).json(fallbackScore(ask, kb));
  }
}

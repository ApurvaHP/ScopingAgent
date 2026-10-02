import { useState } from "react";

// Curated so every entry (except the last) produces a full "Now"/"Fast-Follow" scope with a real
// day estimate and AI-vs-engineer split — verified against the fallback scorer. Prompts with no
// spec/design ("no spec yet", "no design") score Decline with zero build detail, so they're
// deliberately excluded here even though the agent still handles them fine if typed manually.
const EXAMPLES = [
  { text: "Identity wants a new KYC document upload step added to the payments flow for high-risk accounts, spec finalized, compliance-driven deadline.", detail: "5d total · 1.5d AI-assisted / 3.5d engineer" },
  { text: "Risk wants a new real-time fraud signal streamed into onboarding for high-value accounts, spec still being scoped with their team.", detail: "4.5d total · 1.5d AI-assisted / 3d engineer" },
  { text: "Partner wants native SDK onboarding embedded in their app, revenue-impacting, requirements finalized.", detail: "7.5d total · 2.5d AI-assisted / 5d engineer" },
  { text: "Legal flagged a required consent disclosure for Amex partners — hard compliance deadline in 3 weeks, requirements finalized.", detail: "3d total · 2d AI-assisted / 1d engineer" },
  { text: "Content team needs a copy change on the intro screen — Figma attached, ready to ship.", detail: "3d total · 2d AI-assisted / 1d engineer" },
  { text: "Someone on the team suggested we look into improving onboarding somehow.", detail: "demo: triggers a clarifying question instead" },
];

const TOOL_LABEL = {
  assess_confidence: "Assess confidence",
  search_alternate_precedent: "Search alternate precedent",
  lookup_external_component: "Look up component/team",
  request_clarification: "Request clarification",
  finalize_triage: "Finalize triage",
};

const verdictColor = {
  Now: "#1E7A46",
  "Fast-Follow": "#B8760A",
  Decline: "#B0402D",
};

const KB_FILES = [
  { name: "team.json", label: "Team & staffing" },
  { name: "roadmap.json", label: "FY26 roadmap" },
  { name: "architecture.md", label: "NEON architecture" },
  { name: "decisions.json", label: "Past triage precedent" },
  { name: "pocs.md", label: "Component & external POCs" },
  { name: "stakeholders.md", label: "Leadership & escalation" },
  { name: "metrics.md", label: "Success metrics" },
];

const priorityColor = { P0: "#B0402D", P1: "#B8760A", P2: "#3A5FB8", "P3 / Backlog": "#4B5563" };

// Score → bar fill % and color, per dimension. Direction differs per dimension:
// higher impact/clearer scope/higher confidence = "good" (green); larger size = "worse" (red).
const SCORE_METER = {
  impact: { Low: { pct: 33, color: "#B0402D" }, Medium: { pct: 66, color: "#B8760A" }, High: { pct: 100, color: "#1E7A46" } },
  scope: { Unclear: { pct: 33, color: "#B0402D" }, Partial: { pct: 66, color: "#B8760A" }, Clear: { pct: 100, color: "#1E7A46" } },
  size: { Small: { pct: 33, color: "#1E7A46" }, Medium: { pct: 66, color: "#B8760A" }, Large: { pct: 100, color: "#B0402D" } },
  confidence: { Low: { pct: 33, color: "#B0402D" }, Medium: { pct: 66, color: "#B8760A" }, High: { pct: 100, color: "#1E7A46" } },
};

const AI_COLOR = "#2FB8A6";
const ENGINEER_COLOR = "#3A5FB8";

// Numbered timeline of the tool calls the agent actually made for this ask — the literal answer to
// "is this autonomous, or does it follow a fixed script": each row here is a real decision point.
function AgentTrace({ trace }) {
  if (!trace?.length) return null;
  return (
    <div>
      {trace.map((t, i) => (
        <div key={i} style={styles.traceRow}>
          <div style={styles.traceStepNum}>{t.step}</div>
          <div style={{ flex: 1 }}>
            <div style={styles.traceTool}>{TOOL_LABEL[t.tool] || t.tool}</div>
            <div style={styles.traceOutput}>{t.output}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Meter({ dim, score }) {
  const m = SCORE_METER[dim]?.[score];
  if (!m) return null;
  return (
    <div style={styles.meterTrack}>
      <div style={{ ...styles.meterFill, width: `${m.pct}%`, background: m.color }} />
    </div>
  );
}

// Collapsible section wrapper — keeps the growing output scannable.
function Section({ id, title, defaultOpen, openMap, setOpenMap, children }) {
  const open = openMap[id] ?? defaultOpen ?? false;
  return (
    <div style={styles.subSection}>
      <button
        style={styles.sectionToggle}
        onClick={() => setOpenMap((m) => ({ ...m, [id]: !open }))}
      >
        <span style={styles.subHeader}>{title}</span>
        <span style={styles.chevron}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

function summarizeForHistory(result) {
  return {
    verdict: result.verdict,
    priority: result.priority?.level,
    confidence: result.confidence,
  };
}

function buildCopySummary(ask, result) {
  const lines = [];
  lines.push(`ASK: ${ask}`);
  lines.push(`VERDICT: ${result.verdict}${result.priority ? ` (${result.priority.level})` : ""}`);
  if (result.confidence?.level) lines.push(`CONFIDENCE: ${result.confidence.level} — ${result.confidence.reasoning || ""}`);
  lines.push(`REASONING: ${result.verdictReasoning}`);
  if (result.priority?.reasoning) lines.push(`PRIORITY REASONING: ${result.priority.reasoning}`);
  lines.push("");
  lines.push(`IMPACT: ${result.impact?.score} — ${result.impact?.reasoning}`);
  lines.push(`SCOPE: ${result.scope?.score} — ${result.scope?.reasoning}`);
  lines.push(`SIZE: ${result.size?.score} — ${result.size?.reasoning}`);
  if (result.closestPrecedent) {
    lines.push("");
    lines.push(`CLOSEST PRECEDENT: "${result.closestPrecedent.ask}" → ${result.closestPrecedent.verdict}${result.closestPrecedent.reason ? ` (${result.closestPrecedent.reason})` : ""}`);
  }
  if (result.metricAlignment) {
    lines.push(`METRIC ALIGNMENT: ${result.metricAlignment}`);
  }
  if (result.escalation?.needed) {
    lines.push("");
    lines.push(`ESCALATION: ${result.escalation.who} — ${result.escalation.why}`);
  }
  if (result.technicalScoping) {
    lines.push("");
    lines.push("TECHNICAL SCOPING:");
    if (result.technicalScoping.componentsAffected?.length) lines.push(`  Components: ${result.technicalScoping.componentsAffected.join(", ")}`);
    if (result.technicalScoping.impactSummary) lines.push(`  Impact: ${result.technicalScoping.impactSummary}`);
    if (result.technicalScoping.scopeOfWork?.length) lines.push(`  Scope of work: ${result.technicalScoping.scopeOfWork.join("; ")}`);
    if (result.technicalScoping.suggestedStaffing) lines.push(`  Staffing: ${result.technicalScoping.suggestedStaffing.engineers} engineer(s) — ${result.technicalScoping.suggestedStaffing.reasoning}`);
    if (result.technicalScoping.edgeCases?.length) lines.push(`  Edge cases: ${result.technicalScoping.edgeCases.join("; ")}`);
  }
  if (result.buildEstimate) {
    lines.push("");
    lines.push(`BUILD ESTIMATE${result.buildEstimateSource === "heuristic-fallback" ? " (heuristic — model didn't provide one)" : ""}: ${result.buildEstimate.totalDays} days (${result.buildEstimate.sprintEquivalent})`);
    if (result.buildEstimate.tasks?.length) {
      result.buildEstimate.tasks.forEach((t) => lines.push(`  [${t.owner}, ${t.effortDays}d] ${t.task} — ${t.note}`));
    }
  }
  if (result.suggestedPOCs?.length) {
    lines.push("");
    lines.push("POCs: " + result.suggestedPOCs.map((p) => `${p.component} — ${p.poc} (${p.jiraBoard})`).join(" | "));
  }
  if (result.externalDependencies?.length) {
    lines.push("EXTERNAL DEPENDENCIES: " + result.externalDependencies.map((d) => `${d.team} (${d.poc}) — ${d.why}`).join(" | "));
  }
  if (result.strategicQuestions) {
    lines.push("");
    lines.push("STRATEGIC QUESTIONS:");
    if (result.strategicQuestions.forProduct?.length) lines.push(`  For Product: ${result.strategicQuestions.forProduct.join(" / ")}`);
    if (result.strategicQuestions.forEngineering?.length) lines.push(`  For Engineering: ${result.strategicQuestions.forEngineering.join(" / ")}`);
  }
  if (result.prototype) {
    lines.push("");
    lines.push("PROTOTYPE:");
    if (result.prototype.buildApproach) lines.push(`  Build approach: ${result.prototype.buildApproach}`);
    if (result.prototype.flowSteps?.length) lines.push(`  Flow: ${result.prototype.flowSteps.join(" -> ")}`);
    if (result.prototype.keyFields?.length) lines.push(`  Key fields: ${result.prototype.keyFields.join(", ")}`);
    if (result.prototype.anticipatedChallenges?.length) lines.push(`  Anticipated challenges: ${result.prototype.anticipatedChallenges.join("; ")}`);
  }
  return lines.join("\n");
}

export default function Home() {
  const [ask, setAsk] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(""); // "retrieving" | "scoring"
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [openMap, setOpenMap] = useState({});
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState([]); // [{ ask, result }]
  const [activeHistoryIdx, setActiveHistoryIdx] = useState(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [forceFallback, setForceFallback] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(true);

  async function submit(text) {
    const value = (text ?? ask).trim();
    if (!value) return;
    setAsk(value);
    setLoading(true);
    setError("");
    setResult(null);
    setCopied(false);
    setActiveHistoryIdx(null);
    setClarificationAnswer("");
    setOpenMap({ scoping: true, estimate: true, who: true, questions: false, prototype: false, retrieved: false, trace: false });
    setPhase("retrieving");
    try {
      // The retrieval + scoring both happen server-side in one call; this staged
      // UI mirrors the two real steps the API performs (read knowledge-base/*, then call the model).
      const retrievalDelay = new Promise((r) => setTimeout(r, 500));
      const fetchPromise = fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ask: value, forceFallback }),
      });
      await retrievalDelay;
      setPhase("scoring");
      const res = await fetchPromise;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResult(data);
      setHistory((h) => [...h, { ask: value, result: data }]);
    } catch (e) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
      setPhase("");
    }
  }

  function revisit(i) {
    const entry = history[i];
    if (!entry) return;
    setAsk(entry.ask);
    setResult(entry.result);
    setActiveHistoryIdx(i);
    setError("");
    setCopied(false);
    setOpenMap({ scoping: true, estimate: true, who: true, questions: false, prototype: false, retrieved: false });
  }

  async function copySummary() {
    if (!result) return;
    const text = buildCopySummary(ask, result);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const borderColor = result?.priority ? priorityColor[result.priority.level] : "#2A3373";

  return (
    <div style={styles.page}>
      <div style={styles.layout}>
        <div style={styles.examplesPanel}>
          <button style={styles.examplesToggle} onClick={() => setExamplesOpen((o) => !o)}>
            <span style={styles.historyHeader}>SAMPLE PROMPTS</span>
            <span style={styles.chevron}>{examplesOpen ? "−" : "+"}</span>
          </button>
          {examplesOpen && (
            <div style={styles.examplesList}>
              {EXAMPLES.map((ex, i) => (
                <button key={i} style={styles.exampleListItem} onClick={() => submit(ex.text)} disabled={loading}>
                  <div>{ex.text}</div>
                  {ex.detail && <div style={styles.exampleDetail}>{ex.detail}</div>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={styles.container}>
          <div style={styles.kicker}>SCOPING AGENT</div>
          <h1 style={styles.h1}>Triage, scope, and prototype any ask before it reaches engineering</h1>
          <p style={styles.sub}>
            The same framework I use to protect engineering bandwidth — paste in a raw ask and get a Now / Fast-Follow / Decline call, plus a starting scope, owners, and prototype outline for anything worth pursuing.
          </p>

          <textarea
            style={styles.textarea}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Paste a raw ask, e.g. 'Sales wants a custom onboarding step for one enterprise customer, no spec yet, needs it in 2 weeks.'"
            rows={5}
          />

          <div style={styles.submitRow}>
            <button style={styles.submitBtn} onClick={() => submit()} disabled={loading || !ask.trim()}>
              {phase === "retrieving" ? "Retrieving context…" : phase === "scoring" ? "Scoring against framework…" : "Triage this ask"}
            </button>
            <label style={styles.fallbackToggle}>
              <input type="checkbox" checked={forceFallback} onChange={(e) => setForceFallback(e.target.checked)} />
              Force offline mode (skip Claude, use deterministic scorer)
            </label>
          </div>

          {loading && (
            <div style={styles.retrievalPanel}>
              {KB_FILES.map((f) => (
                <div key={f.name} style={styles.retrievalRow}>
                  <span style={{ ...styles.retrievalDot, opacity: phase === "retrieving" ? 1 : 0.4 }} />
                  <span style={styles.retrievalLabel}>{f.label}</span>
                  <span style={styles.retrievalFile}>{f.name}</span>
                  <span style={styles.retrievalStatus}>{phase === "retrieving" ? "fetching…" : "loaded"}</span>
                </div>
              ))}
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}

          {result && result.type === "clarification" && (
            <div style={styles.clarificationCard}>
              <div style={styles.clarificationLabel}>AGENT NEEDS MORE INFO</div>
              {result.playbook && (
                <div style={styles.playbookTag}>Lens considered: {result.playbook.label}</div>
              )}
              <p style={styles.clarificationQuestion}>{result.question}</p>
              <p style={styles.clarificationReason}>{result.reason}</p>
              <textarea
                style={styles.clarificationInput}
                value={clarificationAnswer}
                onChange={(e) => setClarificationAnswer(e.target.value)}
                placeholder="Add the missing detail here…"
                rows={2}
              />
              <button
                style={styles.submitBtn}
                disabled={loading || !clarificationAnswer.trim()}
                onClick={() => submit(`${ask}\n\nAdditional detail: ${clarificationAnswer.trim()}`)}
              >
                Answer & re-triage
              </button>
              {result.agentTrace && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ ...styles.subHeader, marginBottom: 8 }}>AGENT REASONING TRACE</div>
                  <AgentTrace trace={result.agentTrace} />
                </div>
              )}
            </div>
          )}

          {result && result.type !== "clarification" && (
            <div style={{ ...styles.resultCard, borderLeft: `4px solid ${borderColor}` }}>
              <div style={styles.resultTopRow}>
                {result.contextUsed && (
                  <div style={styles.contextBadgeRow}>
                    <span style={styles.contextBadgeLabel}>CONTEXT RETRIEVED</span>
                    {result.contextUsed.map((f) => (
                      <span key={f} style={styles.contextBadge}>{f}</span>
                    ))}
                  </div>
                )}
                <button style={styles.copyBtn} onClick={copySummary}>
                  {copied ? "Copied ✓" : "Copy summary"}
                </button>
              </div>

              {result.playbook && (
                <div style={styles.playbookTag}>
                  Lens: <strong>{result.playbook.label}</strong>{result.playbook.why ? ` — ${result.playbook.why}` : ""}
                </div>
              )}

              <div style={styles.verdictRow}>
                <span style={{ ...styles.verdictBadge, background: verdictColor[result.verdict] || "#444" }}>
                  {result.verdict}
                </span>
                {result.priority && (
                  <span style={{ ...styles.verdictBadge, background: priorityColor[result.priority.level] || "#444" }}>
                    {result.priority.level}
                  </span>
                )}
                {result.confidence?.level && (
                  <span style={styles.confidenceTag}>
                    confidence: {result.confidence.level}
                    <span style={{ ...styles.meterTrack, ...styles.meterTrackInline }}>
                      <span style={{ ...styles.meterFill, width: `${SCORE_METER.confidence[result.confidence.level]?.pct || 0}%`, background: SCORE_METER.confidence[result.confidence.level]?.color }} />
                    </span>
                  </span>
                )}
                {result.source === "fallback" && <span style={styles.fallbackTag}>offline fallback scorer</span>}
              </div>
              <p style={styles.verdictReasoning}>{result.verdictReasoning}</p>
              {result.priority?.reasoning && (
                <p style={{ ...styles.verdictReasoning, marginTop: 4, fontSize: 12.5, color: "#8891C0" }}>
                  <strong>Priority:</strong> {result.priority.reasoning}
                </p>
              )}

              {result.escalation?.needed && (
                <div style={styles.escalationCallout}>
                  <span style={styles.escalationLabel}>ESCALATE</span>
                  <span style={styles.subText}><strong>{result.escalation.who}</strong> — {result.escalation.why}</span>
                </div>
              )}

              <div style={styles.dimGrid}>
                {["impact", "scope", "size"].map((dim) => (
                  <div key={dim} style={styles.dimCard}>
                    <div style={styles.dimLabel}>{dim.toUpperCase()}</div>
                    <div style={styles.dimScore}>{result[dim]?.score}</div>
                    <Meter dim={dim} score={result[dim]?.score} />
                    <div style={styles.dimReasoning}>{result[dim]?.reasoning}</div>
                  </div>
                ))}
              </div>

              {(result.closestPrecedent || result.metricAlignment) && (
                <div style={styles.calloutStack}>
                  {result.closestPrecedent && (
                    <p style={styles.subText}>
                      <strong style={{ color: "#E8952B" }}>Closest precedent:</strong>{" "}
                      "{result.closestPrecedent.ask}" → {result.closestPrecedent.verdict}
                      {result.closestPrecedent.reason ? ` (${result.closestPrecedent.reason})` : ""}
                    </p>
                  )}
                  {result.metricAlignment && (
                    <p style={styles.subText}><strong style={{ color: "#E8952B" }}>Metric alignment:</strong> {result.metricAlignment}</p>
                  )}
                </div>
              )}

              {result.technicalScoping && (
                <Section id="scoping" title="Technical Scoping" defaultOpen openMap={openMap} setOpenMap={setOpenMap}>
                  {result.technicalScoping.componentsAffected?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ ...styles.subText, marginBottom: 6 }}><strong>Components affected:</strong></p>
                      <div style={styles.chipRow}>
                        {result.technicalScoping.componentsAffected.map((c, i) => (
                          <span key={i} style={styles.chip}>{c}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.technicalScoping.impactSummary && (
                    <p style={styles.subText}><strong>Impact:</strong> {result.technicalScoping.impactSummary}</p>
                  )}

                  {result.technicalScoping.scopeOfWork?.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ ...styles.subText, marginBottom: 4 }}><strong>Scope of work:</strong></p>
                      <ul style={styles.stepList}>
                        {result.technicalScoping.scopeOfWork.map((item, i) => (
                          <li key={i} style={styles.stepItem}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {result.technicalScoping.suggestedStaffing && (
                    <p style={styles.subText}>
                      <strong>Suggested staffing:</strong> {result.technicalScoping.suggestedStaffing.engineers} engineer{result.technicalScoping.suggestedStaffing.engineers === 1 ? "" : "s"} — {result.technicalScoping.suggestedStaffing.reasoning}
                    </p>
                  )}

                  {result.technicalScoping.edgeCases?.length > 0 && (
                    <div>
                      <p style={{ ...styles.subText, marginBottom: 6 }}><strong>Edge cases to plan for:</strong></p>
                      {result.technicalScoping.edgeCases.map((ec, i) => (
                        <div key={i} style={styles.edgeCaseRow}>
                          <span style={styles.edgeCaseIcon}>⚠</span>
                          <span style={styles.subText}>{ec}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {result.buildEstimate && (
                <Section
                  id="estimate"
                  title={result.buildEstimateSource === "heuristic-fallback" ? "Build Estimate (AI-Augmented) — heuristic estimate, model didn't provide one" : "Build Estimate (AI-Augmented)"}
                  defaultOpen
                  openMap={openMap}
                  setOpenMap={setOpenMap}
                >
                  <div style={styles.estimateHeaderRow}>
                    <div>
                      <div style={styles.estimateBigNumber}>{result.buildEstimate.totalDays}d</div>
                      <div style={styles.estimateSubLabel}>{result.buildEstimate.sprintEquivalent}</div>
                    </div>
                    {(result.buildEstimate.aiDays != null && result.buildEstimate.engineerDays != null) && (
                      <div style={styles.estimateLegend}>
                        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: AI_COLOR }} />AI-Assisted: {result.buildEstimate.aiDays}d</span>
                        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: ENGINEER_COLOR }} />Engineer-Required: {result.buildEstimate.engineerDays}d</span>
                      </div>
                    )}
                  </div>

                  {(result.buildEstimate.aiDays != null && result.buildEstimate.engineerDays != null && result.buildEstimate.totalDays > 0) && (
                    <div style={styles.stackedBar}>
                      <div style={{ width: `${(result.buildEstimate.aiDays / result.buildEstimate.totalDays) * 100}%`, background: AI_COLOR }} />
                      <div style={{ width: `${(result.buildEstimate.engineerDays / result.buildEstimate.totalDays) * 100}%`, background: ENGINEER_COLOR }} />
                    </div>
                  )}

                  {result.buildEstimate.tasks?.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      {result.buildEstimate.tasks.map((t, i) => (
                        <div key={i} style={styles.taskRow}>
                          <span style={{ ...styles.legendDot, background: t.owner === "AI-Assisted" ? AI_COLOR : ENGINEER_COLOR, marginTop: 3 }} />
                          <div style={{ flex: 1 }}>
                            <div style={styles.taskTitleRow}>
                              <span style={styles.taskTitle}>{t.task}</span>
                              <span style={styles.taskDays}>{t.effortDays}d</span>
                            </div>
                            <div style={styles.taskNote}>{t.note}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {(result.suggestedPOCs?.length > 0 || result.externalDependencies?.length > 0) && (
                <Section id="who" title="Who To Work With" defaultOpen openMap={openMap} setOpenMap={setOpenMap}>
                  {result.suggestedPOCs?.length > 0 && (
                    <div style={{ marginBottom: result.externalDependencies?.length > 0 ? 14 : 0 }}>
                      <p style={{ ...styles.subText, marginBottom: 6 }}><strong>Internal POCs:</strong></p>
                      {result.suggestedPOCs.map((p, i) => (
                        <p key={i} style={{ ...styles.subText, marginBottom: 4 }}>
                          <span style={styles.pocComponent}>{p.component}</span> — {p.poc} <span style={styles.jiraTag}>{p.jiraBoard}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {result.externalDependencies?.length > 0 && (
                    <div>
                      <p style={{ ...styles.subText, marginBottom: 6 }}><strong>External team dependencies:</strong></p>
                      {result.externalDependencies.map((d, i) => (
                        <p key={i} style={{ ...styles.subText, marginBottom: 4 }}>
                          <span style={styles.externalTag}>{d.team}</span> {d.poc} — {d.why}
                        </p>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {result.strategicQuestions && (
                <Section id="questions" title="Strategic Questions to Ask" openMap={openMap} setOpenMap={setOpenMap}>
                  <div style={styles.questionCols}>
                    {result.strategicQuestions.forProduct?.length > 0 && (
                      <div style={{ ...styles.questionCol, borderTopColor: "#3A5FB8" }}>
                        <p style={{ ...styles.subText, marginBottom: 6, color: "#8FB2F5" }}><strong>For Product</strong></p>
                        {result.strategicQuestions.forProduct.map((q, i) => <p key={i} style={styles.questionItem}>{q}</p>)}
                      </div>
                    )}
                    {result.strategicQuestions.forEngineering?.length > 0 && (
                      <div style={{ ...styles.questionCol, borderTopColor: "#E8952B" }}>
                        <p style={{ ...styles.subText, marginBottom: 6, color: "#F0C089" }}><strong>For Engineering</strong></p>
                        {result.strategicQuestions.forEngineering.map((q, i) => <p key={i} style={styles.questionItem}>{q}</p>)}
                      </div>
                    )}
                  </div>
                </Section>
              )}

              {result.prototype && (
                <Section id="prototype" title="Prototype Outline" openMap={openMap} setOpenMap={setOpenMap}>
                  {result.prototype.buildApproach && (
                    <p style={styles.subText}><strong>How to build it:</strong> {result.prototype.buildApproach}</p>
                  )}
                  {result.prototype.flowSteps?.length > 0 && (
                    <ol style={styles.stepList}>
                      {result.prototype.flowSteps.map((step, i) => (
                        <li key={i} style={styles.stepItem}>{step.replace(/^Step \d+:\s*/, "")}</li>
                      ))}
                    </ol>
                  )}
                  {result.prototype.keyFields?.length > 0 && (
                    <p style={styles.subText}><strong>Key fields/decisions for the PM:</strong> {result.prototype.keyFields.join(" · ")}</p>
                  )}
                  {result.prototype.anticipatedChallenges?.length > 0 && (
                    <div>
                      <p style={{ ...styles.subText, marginBottom: 4 }}><strong>Anticipated challenges:</strong></p>
                      <ul style={styles.stepList}>
                        {result.prototype.anticipatedChallenges.map((c, i) => <li key={i} style={styles.stepItem}>{c}</li>)}
                      </ul>
                    </div>
                  )}
                </Section>
              )}

              {result.contextPreview && (
                <Section id="retrieved" title="What Was Retrieved" openMap={openMap} setOpenMap={setOpenMap}>
                  <p style={styles.subText}><strong>team.json:</strong> {result.contextPreview.team}</p>
                  <p style={styles.subText}><strong>roadmap.json:</strong> {result.contextPreview.roadmap}</p>
                  <p style={styles.subText}><strong>architecture.md:</strong> {result.contextPreview.architecture?.slice(0, 220)}…</p>
                  {result.contextPreview.decisions && (
                    <p style={styles.subText}><strong>decisions.json:</strong> {result.contextPreview.decisions.slice(0, 260)}…</p>
                  )}
                  {result.contextPreview.pocs && (
                    <p style={styles.subText}><strong>pocs.md:</strong> {result.contextPreview.pocs.slice(0, 220)}…</p>
                  )}
                  {result.contextPreview.stakeholders && (
                    <p style={styles.subText}><strong>stakeholders.md:</strong> {result.contextPreview.stakeholders.slice(0, 220)}…</p>
                  )}
                  {result.contextPreview.metrics && (
                    <p style={styles.subText}><strong>metrics.md:</strong> {result.contextPreview.metrics.slice(0, 220)}…</p>
                  )}
                </Section>
              )}

              {result.agentTrace?.length > 0 && (
                <Section id="trace" title="Agent Reasoning Trace" openMap={openMap} setOpenMap={setOpenMap}>
                  <AgentTrace trace={result.agentTrace} />
                </Section>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#0F1330", fontFamily: "Calibri, Arial, sans-serif", padding: "48px 20px" },
  layout: { maxWidth: 980, margin: "0 auto", display: "flex", gap: 24, alignItems: "flex-start" },
  container: { maxWidth: 1080, flex: "1 1 auto", minWidth: 0 },
  kicker: { color: "#E8952B", fontWeight: 700, letterSpacing: 2, fontSize: 13, marginBottom: 8 },
  h1: { color: "#FFFFFF", fontFamily: "Cambria, Georgia, serif", fontSize: 32, lineHeight: 1.25, margin: "0 0 12px" },
  sub: { color: "#CADCFC", fontSize: 15, lineHeight: 1.5, marginBottom: 24, maxWidth: 640 },
  textarea: { width: "100%", boxSizing: "border-box", borderRadius: 10, border: "1px solid #2A3373", background: "#161B45", color: "#FFFFFF", padding: 14, fontSize: 14, fontFamily: "Calibri, Arial, sans-serif", resize: "vertical" },
  examplesPanel: { flex: "0 0 240px", position: "sticky", top: 24, background: "#161B45", border: "1px solid #2A3373", borderRadius: 10, padding: 12, maxHeight: "80vh", overflowY: "auto" },
  examplesToggle: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: "0 4px", cursor: "pointer" },
  examplesList: { display: "flex", flexDirection: "column", gap: 6, marginTop: 10 },
  exampleListItem: { textAlign: "left", background: "#1E2761", color: "#CADCFC", border: "1px solid #2A3373", borderRadius: 8, padding: "8px 10px", fontSize: 12, lineHeight: 1.4, cursor: "pointer" },
  exampleDetail: { color: "#E8952B", fontSize: 10.5, fontFamily: "monospace", marginTop: 5 },
  submitBtn: { marginTop: 20, background: "#E8952B", color: "#141B49", border: "none", borderRadius: 8, padding: "12px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  submitRow: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" },
  fallbackToggle: { display: "flex", alignItems: "center", gap: 6, marginTop: 20, color: "#8891C0", fontSize: 11.5, cursor: "pointer", userSelect: "none" },
  error: { marginTop: 16, color: "#FFB4A8", background: "#3A1E1E", padding: 12, borderRadius: 8, fontSize: 13 },
  resultCard: { marginTop: 28, background: "#161B45", border: "1px solid #2A3373", borderRadius: 12, padding: 22 },
  clarificationCard: { marginTop: 28, background: "#161B45", border: "1px solid #B8760A", borderRadius: 12, padding: 22 },
  clarificationLabel: { color: "#E8952B", fontWeight: 700, fontSize: 11, letterSpacing: 1, marginBottom: 10 },
  clarificationQuestion: { color: "#FFFFFF", fontSize: 16, lineHeight: 1.5, fontWeight: 600, margin: "0 0 8px" },
  clarificationReason: { color: "#CADCFC", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 14px" },
  clarificationInput: { width: "100%", boxSizing: "border-box", borderRadius: 8, border: "1px solid #2A3373", background: "#0F1330", color: "#FFFFFF", padding: 10, fontSize: 13, fontFamily: "Calibri, Arial, sans-serif", resize: "vertical", marginBottom: 10 },
  playbookTag: { display: "inline-block", color: "#CADCFC", fontSize: 11.5, background: "#0F1330", border: "1px solid #2A3373", borderRadius: 20, padding: "4px 12px", marginBottom: 14 },
  traceRow: { display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderTop: "1px solid #1E2761" },
  traceStepNum: { width: 20, height: 20, borderRadius: "50%", background: "#1E2761", color: "#E8952B", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  traceTool: { color: "#EEF3FC", fontSize: 12.5, fontWeight: 600 },
  traceOutput: { color: "#8891C0", fontSize: 11.5, lineHeight: 1.5, marginTop: 2 },
  resultTopRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 },
  copyBtn: { flexShrink: 0, background: "transparent", color: "#CADCFC", border: "1px solid #2A3373", borderRadius: 6, padding: "5px 12px", fontSize: 11.5, cursor: "pointer" },
  verdictRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  verdictBadge: { color: "#FFFFFF", fontWeight: 700, fontSize: 14, padding: "6px 14px", borderRadius: 20 },
  confidenceTag: { color: "#8891C0", fontSize: 11.5, border: "1px solid #2A3373", borderRadius: 20, padding: "4px 10px" },
  fallbackTag: { color: "#8891C0", fontSize: 11, fontStyle: "italic" },
  verdictReasoning: { color: "#EEF3FC", fontSize: 14, lineHeight: 1.5, marginTop: 12 },
  escalationCallout: { display: "flex", alignItems: "flex-start", gap: 10, marginTop: 14, background: "#3A1E1E", border: "1px solid #6B3A3A", borderRadius: 8, padding: "10px 14px" },
  escalationLabel: { color: "#FFB4A8", fontWeight: 700, fontSize: 10.5, letterSpacing: 1, flexShrink: 0, marginTop: 2 },
  dimGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 20 },
  dimCard: { background: "#0F1330", borderRadius: 8, padding: 14 },
  dimLabel: { color: "#E8952B", fontSize: 11, fontWeight: 700, letterSpacing: 1 },
  dimScore: { color: "#FFFFFF", fontSize: 20, fontWeight: 700, fontFamily: "Cambria, Georgia, serif", margin: "4px 0" },
  dimReasoning: { color: "#CADCFC", fontSize: 12, lineHeight: 1.4 },
  calloutStack: { marginTop: 16, background: "#0F1330", borderRadius: 8, padding: "12px 14px" },
  subSection: { marginTop: 16, paddingTop: 16, borderTop: "1px solid #2A3373" },
  sectionToggle: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer" },
  chevron: { color: "#8891C0", fontSize: 16, fontWeight: 700 },
  subHeader: { color: "#E8952B", fontSize: 12, fontWeight: 700, letterSpacing: 1 },
  subText: { color: "#EEF3FC", fontSize: 12.5, lineHeight: 1.6, margin: "0 0 8px" },
  stepList: { color: "#EEF3FC", fontSize: 12.5, lineHeight: 1.7, margin: "0 0 10px", paddingLeft: 20 },
  stepItem: { marginBottom: 4 },
  retrievalPanel: { marginTop: 16, background: "#161B45", border: "1px solid #2A3373", borderRadius: 10, padding: 14 },
  retrievalRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 0" },
  retrievalDot: { width: 8, height: 8, borderRadius: "50%", background: "#E8952B", flexShrink: 0 },
  retrievalLabel: { color: "#EEF3FC", fontSize: 12.5, minWidth: 130 },
  retrievalFile: { color: "#8891C0", fontSize: 11.5, fontFamily: "monospace", flex: 1 },
  retrievalStatus: { color: "#CADCFC", fontSize: 11, fontStyle: "italic" },
  contextBadgeRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 },
  contextBadgeLabel: { color: "#8891C0", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginRight: 4 },
  contextBadge: { background: "#0F1330", color: "#CADCFC", fontSize: 10.5, fontFamily: "monospace", padding: "3px 9px", borderRadius: 12, border: "1px solid #2A3373" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { background: "#0F1330", color: "#E8952B", fontSize: 10.5, padding: "4px 10px", borderRadius: 6, border: "1px solid #2A3373" },
  pocComponent: { color: "#E8952B", fontWeight: 600 },
  jiraTag: { color: "#8891C0", fontFamily: "monospace", fontSize: 11 },
  externalTag: { background: "#3A2A1E", color: "#F0A868", fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 5, marginRight: 4 },
  historyPanel: { flex: "0 0 220px", position: "sticky", top: 24, display: "flex", flexDirection: "column", gap: 6, background: "#161B45", border: "1px solid #2A3373", borderRadius: 10, padding: 12, maxHeight: "80vh", overflowY: "auto" },
  historyHeader: { color: "#8891C0", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 4, padding: "0 4px" },
  historyItem: { display: "flex", flexDirection: "column", gap: 3, textAlign: "left", background: "transparent", border: "none", borderRadius: 6, padding: "8px 10px", cursor: "pointer" },
  historyVerdict: { fontSize: 11, fontWeight: 700 },
  historyAsk: { color: "#CADCFC", fontSize: 11, lineHeight: 1.4 },
  meterTrack: { display: "block", width: "100%", height: 5, borderRadius: 3, background: "#1E2761", overflow: "hidden", margin: "6px 0 8px" },
  meterTrackInline: { display: "inline-block", width: 48, marginLeft: 8, verticalAlign: "middle" },
  meterFill: { display: "block", height: "100%", borderRadius: 3 },
  edgeCaseRow: { display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  edgeCaseIcon: { color: "#E8952B", fontSize: 12, flexShrink: 0, marginTop: 1 },
  estimateHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  estimateBigNumber: { color: "#FFFFFF", fontSize: 30, fontWeight: 700, fontFamily: "Cambria, Georgia, serif", lineHeight: 1 },
  estimateSubLabel: { color: "#CADCFC", fontSize: 12, marginTop: 4 },
  estimateLegend: { display: "flex", flexDirection: "column", gap: 4 },
  legendItem: { display: "flex", alignItems: "center", gap: 6, color: "#EEF3FC", fontSize: 11.5 },
  legendDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0, display: "inline-block" },
  stackedBar: { display: "flex", width: "100%", height: 10, borderRadius: 5, overflow: "hidden", background: "#0F1330" },
  taskRow: { display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderTop: "1px solid #1E2761" },
  taskTitleRow: { display: "flex", justifyContent: "space-between", gap: 10 },
  taskTitle: { color: "#EEF3FC", fontSize: 12.5, fontWeight: 600 },
  taskDays: { color: "#8891C0", fontSize: 11.5, fontFamily: "monospace", flexShrink: 0 },
  taskNote: { color: "#8891C0", fontSize: 11.5, lineHeight: 1.5, marginTop: 3 },
  questionCols: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  questionCol: { background: "#0F1330", borderRadius: 8, borderTop: "3px solid", padding: "12px 14px" },
  questionItem: { color: "#EEF3FC", fontSize: 12.5, lineHeight: 1.6, margin: "0 0 8px" },
};

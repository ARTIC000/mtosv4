import type { UiClient } from "@/lib/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hasScheduledTouch(value: string | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  return !!normalized && normalized !== "not scheduled" && normalized !== "—";
}

function isPositiveSentiment(value: string | undefined) {
  return (value || "").trim().toLowerCase() === "positive";
}

function isAtRiskSentiment(value: string | undefined) {
  return (value || "").trim().toLowerCase() === "at-risk";
}

function normalizeActionState(status?: string, synced?: boolean) {
  if (!synced) return "unsynced" as const;

  const normalized = (status || "").toLowerCase().trim();
  if (!normalized) return "open" as const;
  if (normalized === "missing") return "missing" as const;
  if (
    normalized.includes("complete") ||
    normalized.includes("closed") ||
    normalized.includes("done") ||
    normalized.includes("resolved")
  ) {
    return "completed" as const;
  }

  return "open" as const;
}

function isOverdue(value: string | undefined) {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed < Date.now();
}

function summarizeActionStates(client: UiClient) {
  const items = client.aiArtifacts?.postMeeting?.actionItems || [];
  const summary = {
    open: 0,
    completed: 0,
    missing: 0,
    unsynced: 0,
    overdue: 0,
  };

  for (const item of items) {
    const state = normalizeActionState(item.clickupSync?.status, item.clickupSync?.synced);
    summary[state] += 1;
    if (state !== "completed" && state !== "missing" && isOverdue(item.clickupSync?.dueDate || item.dueDate)) {
      summary.overdue += 1;
    }
  }

  return summary;
}

function computeKpiScore(client: UiClient) {
  if (!client.kpis.length) return 58;
  const goodCount = client.kpis.filter((kpi) => kpi.good).length;
  return Math.round((goodCount / client.kpis.length) * 100);
}

function computeHealthScore(client: UiClient, actionSummary: ReturnType<typeof summarizeActionStates>) {
  const baseHealth = client.health ?? 68;
  const kpiScore = computeKpiScore(client);
  const meetingScore = hasScheduledTouch(client.nextTouch) ? 78 : 45;
  const sentimentScore = isPositiveSentiment(client.sentiment) ? 84 : isAtRiskSentiment(client.sentiment) ? 36 : 62;
  const health = Math.round(baseHealth * 0.55 + kpiScore * 0.2 + meetingScore * 0.1 + sentimentScore * 0.15);

  const factors = [
    `${actionSummary.completed} completed action item(s)`,
    `${actionSummary.open} open action item(s)`,
    `${actionSummary.missing} missing ClickUp task(s)`,
    `${actionSummary.overdue} overdue action item(s)`,
    `${client.kpis.filter((kpi) => kpi.good).length}/${client.kpis.length || 0} positive KPI signal(s)`,
  ];

  return {
    score: clamp(health, 0, 100),
    factors,
  };
}

function computeRiskScore(client: UiClient, actionSummary: ReturnType<typeof summarizeActionStates>) {
  const churnCount = client.churn.length;
  const riskBase =
    churnCount * 11 +
    actionSummary.missing * 18 +
    actionSummary.overdue * 11 +
    actionSummary.open * 4 +
    actionSummary.unsynced * 6 +
    (hasScheduledTouch(client.nextTouch) ? 0 : 12) +
    (isAtRiskSentiment(client.sentiment) ? 18 : 0) +
    ((client.health ?? 70) < 60 ? 12 : (client.health ?? 70) < 75 ? 6 : 0) -
    actionSummary.completed * 3;

  const factors = [
    `${churnCount} churn signal(s)`,
    `${actionSummary.missing} missing ClickUp task(s)`,
    `${actionSummary.overdue} overdue action item(s)`,
    hasScheduledTouch(client.nextTouch) ? "next touch scheduled" : "next touch not scheduled",
  ];

  return {
    score: clamp(Math.round(riskBase), 0, 100),
    factors,
  };
}

function computeUpsellReadiness(client: UiClient, actionSummary: ReturnType<typeof summarizeActionStates>) {
  const kpiScore = computeKpiScore(client);
  let score =
    42 +
    ((client.health ?? 70) >= 80 ? 14 : (client.health ?? 70) >= 65 ? 6 : -8) +
    (isPositiveSentiment(client.sentiment) ? 12 : isAtRiskSentiment(client.sentiment) ? -20 : 0) +
    (client.goals.length ? 8 : 0) +
    (hasScheduledTouch(client.nextTouch) ? 6 : -6) +
    Math.min(10, Math.round(kpiScore / 10)) +
    Math.min(8, actionSummary.completed * 2) -
    actionSummary.missing * 8 -
    actionSummary.overdue * 6 -
    actionSummary.unsynced * 3;

  score = clamp(Math.round(score), 0, 100);

  const factors = [
    `${client.goals.length} documented goal(s)`,
    `${actionSummary.completed} completed action item(s)`,
    `${actionSummary.overdue} overdue action item(s)`,
    `${kpiScore} KPI momentum score`,
  ];

  return {
    score,
    factors,
  };
}

export function applyMtosScoring(client: UiClient) {
  const actionSummary = summarizeActionStates(client);
  const health = computeHealthScore(client, actionSummary);
  const risk = computeRiskScore(client, actionSummary);
  const upsell = computeUpsellReadiness(client, actionSummary);
  const computedAt = new Date().toISOString();

  const nextSentiment = risk.score >= 70 ? "at-risk" : upsell.score >= 72 && health.score >= 75 ? "positive" : "neutral";
  const nextRiskNote =
    risk.score >= 70
      ? `MTOS risk ${risk.score}/100. Priority issues: ${risk.factors.slice(0, 3).join(", ")}.`
      : upsell.score >= 72
        ? `MTOS upsell readiness ${upsell.score}/100. Positive momentum: ${upsell.factors.slice(0, 3).join(", ")}.`
        : `MTOS risk ${risk.score}/100. Monitor: ${risk.factors.slice(0, 3).join(", ")}.`;

  return {
    ...client,
    health: health.score,
    sentiment: nextSentiment,
    riskNote: nextRiskNote,
    mtosScores: {
      health: health.score,
      risk: risk.score,
      upsellReadiness: upsell.score,
      computedAt,
      deltas: {
        health: null,
        risk: null,
        upsellReadiness: null,
      },
      factors: {
        health: health.factors,
        risk: risk.factors,
        upsell: upsell.factors,
      },
    },
  };
}

export function applyMtosScoringToClients(clients: UiClient[]) {
  return clients.map(applyMtosScoring);
}

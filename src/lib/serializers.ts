import type { Client } from "@prisma/client";

import type { UiClient } from "@/lib/types";

type ClientWithRelations = Client & {
  kpis: Array<{ label: string; value: string; delta: string | null; good: boolean }>;
  churnSignals: Array<{ text: string; color: string }>;
  goals: Array<{ text: string }>;
  activities: Array<{ text: string; meta: string; dot: string }>;
};

export function serializeClient(client: ClientWithRelations): UiClient {
  const rawPayload =
    client.rawPayload && typeof client.rawPayload === "object" && !Array.isArray(client.rawPayload) ? client.rawPayload : null;
  const contactName =
    rawPayload && typeof rawPayload.contactName === "string" && rawPayload.contactName.trim().length
      ? rawPayload.contactName
      : undefined;

  return {
    id: client.id,
    name: client.name,
    contactName,
    industry: client.industry || "—",
    location: client.location || "—",
    initials: client.initials || "?",
    avatar: [client.avatarStart || "#0d9488", client.avatarEnd || "#5eead4"],
    accountManager: client.accountManager,
    health: client.health,
    trend: client.trend || "—",
    sentiment: client.sentiment || "neutral",
    tenure: client.tenure || "—",
    mrr: client.mrr || "—",
    nextTouch: client.nextTouch || "Not scheduled",
    openActions: client.openActions,
    riskNote: client.riskNote || "Waiting on source systems to enrich this account.",
    context: client.context || "",
    kpis: client.kpis.map((kpi) => ({
      label: kpi.label,
      value: kpi.value,
      delta: kpi.delta || "—",
      good: kpi.good,
    })),
    churn: client.churnSignals.map((signal) => ({
      text: signal.text,
      color: signal.color,
    })),
    goals: client.goals.map((goal) => goal.text),
    activity: client.activities.map((entry) => ({
      text: entry.text,
      meta: entry.meta,
      dot: entry.dot,
    })),
  };
}

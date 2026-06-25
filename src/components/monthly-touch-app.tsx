"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import { FIELD_MANUAL, INTEGRATIONS, INTEGRATION_SPECS, NAV_ITEMS } from "@/lib/prototype-data";
import type { AuthedUser } from "@/lib/auth";
import type { IntegrationCard, UiClient } from "@/lib/types";

type Screen =
  | "dashboard"
  | "clients"
  | "meetings"
  | "wins"
  | "issues"
  | "recommendations"
  | "integrations"
  | "wiki";

type UserIntegrationStatus = IntegrationCard & {
  status: "connected" | "not_connected";
  accountEmail: string | null;
  workspaceName: string | null;
};

type AdminSourceStatus = {
  key: string;
  label: string;
  hint: string;
  provider: string;
  glyph: string;
  icon: [string, string];
  description: string;
  covers: string[];
  status: "connected" | "not_connected";
  accountEmail: string | null;
  workspaceName: string | null;
};

type GoogleConnectTarget = "gcalendar" | "gdrive" | "gmail" | "meet" | "mcc" | "adg";
type ManualConnectTarget = "ghl" | "ahrefs" | "meta";
type AiTaskType =
  | "data_collection"
  | "context_collection"
  | "analysis"
  | "deliverable_generation"
  | "post_meeting"
  | "connector_diagnosis"
  | "general_strategy";

type AiExecutionStatus = {
  gemini: {
    configured: boolean;
    model: string;
  };
  claude: {
    configured: boolean;
    model: string;
  };
};

type AiRouterStatus = {
  execution?: AiExecutionStatus;
};

type AiExecutionResult = {
  provider: "gemini" | "claude";
  model: string;
  outputText: string;
  stopReason: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
  executed: boolean;
};

type AiRouterResponse = {
  router: {
    model: "gemini" | "claude";
    phase: "collection" | "reasoning";
    taskType: AiTaskType;
    reason: string;
    readyForExecution: boolean;
  };
  execution?: AiExecutionResult;
  savedArtifact?: {
    id: string;
    type: string;
    updatedAt: string;
  } | null;
};

type ClickUpPostMeetingSyncResponse = {
  clientName: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  createdTasks: Array<{ id: string; name: string }>;
  updatedTasks: Array<{ id: string; name: string }>;
  skippedTasks: Array<{ name: string; reason: string }>;
};

type ClickUpActionState = "unsynced" | "open" | "completed" | "missing";

type MtosScoreSnapshot = {
  id: string;
  createdAt: string;
  health: number;
  risk: number;
  upsellReadiness: number;
};

type MtosScoreHistoryResponse = {
  clientId: string;
  snapshots: MtosScoreSnapshot[];
};

type ClickUpWizardState = {
  step: "authorize" | "connecting" | "sync" | "syncing" | "done";
  email: string;
  workspaceId: string;
  workspaceName: string;
  picks: Record<string, boolean>;
  rows: UiClient[];
  syncIndex: number;
  error: string | null;
  count: number;
};

type ManualConnectState = {
  target: ManualConnectTarget;
  title: string;
  subtitle: string;
  accountEmail: string;
  workspaceName: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresIn: string;
  saving: boolean;
  error: string | null;
};

const CLICKUP_SCOPES = [
  "Read tasks, lists and spaces",
  "Read time tracking and due dates",
  "Read account / client structure",
  "Write tasks (push action items back)",
];

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof body.error === "string" ? body.error : "Request failed.";
    const details = typeof body.details === "string" ? body.details : "";
    throw new Error(details ? `${error}\n\n${details}` : error);
  }

  return body as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatMaybeDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function buildLinePath(args: { values: number[]; width: number; height: number; padding: number }) {
  const values = args.values;
  if (!values.length) return "";
  const max = Math.max(...values, 100);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const xStep = values.length > 1 ? (args.width - args.padding * 2) / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      const x = args.padding + index * xStep;
      const y = args.padding + (1 - (value - min) / span) * (args.height - args.padding * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function getClickUpActionState(sync?: {
  synced?: boolean;
  status?: string;
}) {
  if (!sync?.synced) return "unsynced" as ClickUpActionState;

  const normalized = (sync.status || "").toLowerCase().trim();
  if (!normalized) return "open" as ClickUpActionState;
  if (normalized === "missing") return "missing" as ClickUpActionState;
  if (
    normalized.includes("complete") ||
    normalized.includes("closed") ||
    normalized.includes("done") ||
    normalized.includes("resolved")
  ) {
    return "completed" as ClickUpActionState;
  }

  return "open" as ClickUpActionState;
}

function clickUpActionStateLabel(state: ClickUpActionState, status?: string) {
  if (state === "unsynced") return "Not yet synced";
  if (state === "missing") return "ClickUp missing";
  if (state === "completed") return "ClickUp completed";
  return `ClickUp ${status || "open"}`;
}

function clickUpActionStateTone(state: ClickUpActionState) {
  if (state === "completed") return "bg-emerald-400/15 text-emerald-300";
  if (state === "missing") return "bg-rose-400/15 text-rose-300";
  if (state === "open") return "bg-amber-400/15 text-amber-200";
  return "bg-white/5 text-slate-400";
}

function clickUpActionDot(state: ClickUpActionState) {
  if (state === "completed") return "#34d399";
  if (state === "missing") return "#f5544f";
  if (state === "open") return "#f5a524";
  return "#64748b";
}

function clickUpActionMeta(args: {
  department: string;
  owner: string;
  dueDate: string;
  clickupDueDate?: string;
  assignee?: string;
  lastSyncedAt?: string;
}) {
  return [
    `${args.department} · ${args.owner}`,
    args.assignee ? `Assignee ${args.assignee}` : null,
    args.clickupDueDate ? `ClickUp due ${formatMaybeDate(args.clickupDueDate)}` : `Due ${args.dueDate}`,
    args.lastSyncedAt ? `Synced ${formatMaybeDate(args.lastSyncedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function healthTone(client: UiClient) {
  if ((client.health ?? 0) >= 80) return "success";
  if ((client.health ?? 0) >= 60) return "warning";
  if ((client.health ?? 0) > 0) return "danger";
  return "neutral";
}

function sentimentTone(sentiment: string) {
  if (sentiment === "positive") return "text-emerald-300";
  if (sentiment === "at-risk") return "text-rose-300";
  return "text-amber-200";
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="mt-card rounded-2xl p-5">
      <div className="mt-label">{label}</div>
      <div className="mt-3 font-display text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-2 text-sm text-slate-400">{note}</div>
    </div>
  );
}

function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-card flex min-h-64 flex-col items-center justify-center rounded-2xl border-dashed px-8 py-10 text-center">
      <div className="font-display text-2xl font-bold">{title}</div>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function MonthlyTouchApp({
  initialUser,
  initialScreen,
  initialToast,
  initialError,
}: {
  initialUser: AuthedUser | null;
  initialScreen?: string;
  initialToast?: string;
  initialError?: string;
}) {
  const [user, setUser] = useState<AuthedUser | null>(initialUser);
  const [screen, setScreen] = useState<Screen>((initialScreen as Screen) || "dashboard");
  const [clients, setClients] = useState<UiClient[]>([]);
  const [integrations, setIntegrations] = useState<UserIntegrationStatus[]>([]);
  const [adminSources, setAdminSources] = useState<AdminSourceStatus[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [activeIntegration, setActiveIntegration] = useState<string>("clickup");
  const [toast, setToast] = useState<string | null>(initialToast || null);
  const [bannerError, setBannerError] = useState<string | null>(initialError || null);
  const [loading, setLoading] = useState(false);
  const [clickup, setClickup] = useState<ClickUpWizardState | null>(null);
  const [manualConnect, setManualConnect] = useState<ManualConnectState | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiExecutionStatus | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiOutput, setAiOutput] = useState<AiExecutionResult | null>(null);
  const [aiRoute, setAiRoute] = useState<AiRouterResponse["router"] | null>(null);
  const [aiTaskLabel, setAiTaskLabel] = useState<string | null>(null);
  const [clickUpPushClientId, setClickUpPushClientId] = useState<string | null>(null);
  const [scoreHistory, setScoreHistory] = useState<MtosScoreSnapshot[]>([]);
  const [scoreHistoryLoading, setScoreHistoryLoading] = useState(false);
  const [scoreHistoryError, setScoreHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!user) return;

    let ignore = false;

    async function loadData() {
      setLoading(true);
      try {
        const [clientResponse, integrationResponse, aiResponse] = await Promise.all([
          fetchJson<{ clients: UiClient[] }>("/api/clients"),
          fetchJson<{
            integrations: UserIntegrationStatus[];
            adminSources: AdminSourceStatus[];
          }>("/api/integrations"),
          fetchJson<AiRouterStatus>("/api/ai/router"),
        ]);

        if (ignore) return;
        setClients(clientResponse.clients);
        setIntegrations(integrationResponse.integrations);
        setAdminSources(integrationResponse.adminSources);
        setAiStatus(aiResponse.execution || null);
        setSelectedClientId((current) => current || clientResponse.clients[0]?.id || null);
      } catch (error) {
        if (!ignore) {
          setBannerError(error instanceof Error ? error.message : "Unable to load app data.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadData();
    return () => {
      ignore = true;
    };
  }, [user]);

  const currentClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) || clients[0] || null,
    [clients, selectedClientId],
  );

  useEffect(() => {
    if (!user || !currentClient?.id) return;

    let ignore = false;
    setScoreHistoryLoading(true);
    setScoreHistoryError(null);

    fetchJson<MtosScoreHistoryResponse>(
      `/api/clients/score-history?clientId=${encodeURIComponent(currentClient.id)}&limit=30`,
    )
      .then((response) => {
        if (ignore) return;
        setScoreHistory(response.snapshots || []);
      })
      .catch((error) => {
        if (ignore) return;
        setScoreHistory([]);
        setScoreHistoryError(error instanceof Error ? error.message : "Unable to load MTOS score history.");
      })
      .finally(() => {
        if (!ignore) setScoreHistoryLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [user, currentClient?.id]);

  const scoreChart = useMemo(() => {
    const ordered = [...scoreHistory].reverse();
    const health = ordered.map((row) => clamp(row.health, 0, 100));
    const risk = ordered.map((row) => clamp(row.risk, 0, 100));
    const upsell = ordered.map((row) => clamp(row.upsellReadiness, 0, 100));

    const width = 520;
    const height = 160;
    const padding = 14;

    return {
      width,
      height,
      healthPath: buildLinePath({ values: health, width, height, padding }),
      riskPath: buildLinePath({ values: risk, width, height, padding }),
      upsellPath: buildLinePath({ values: upsell, width, height, padding }),
      hasData: ordered.length >= 2,
      points: ordered.length,
    };
  }, [scoreHistory]);

  const userScopedIntegrations = integrations.filter((integration) => integration.scope === "user");
  const connectedCount = userScopedIntegrations.filter((integration) => integration.status === "connected").length;
  const highRiskClients = clients.filter(
    (client) => (client.mtosScores?.risk ?? 0) >= 70 || client.sentiment === "at-risk" || (client.health ?? 100) < 60,
  );
  const upsellReadyClients = clients.filter((client) => (client.mtosScores?.upsellReadiness ?? 0) >= 72);
  const savedWorkspaceSnapshots = clients
    .flatMap((client) =>
      client.aiArtifacts?.workspaceSnapshot
        ? [
            {
              clientName: client.name,
              snapshot: client.aiArtifacts.workspaceSnapshot,
            },
          ]
        : [],
    );
  const wins = (savedWorkspaceSnapshots.length
    ? savedWorkspaceSnapshots.flatMap((entry) => entry.snapshot.wins.map((win) => `${entry.clientName}: ${win}`))
    : clients
    .flatMap((client) =>
      client.kpis
        .filter((kpi) => kpi.good)
        .slice(0, 2)
        .map((kpi) => `${client.name}: ${kpi.label} ${kpi.value} (${kpi.delta})`),
    ))
    .slice(0, 6);
  const issues = (savedWorkspaceSnapshots.length
    ? savedWorkspaceSnapshots.flatMap((entry) =>
        entry.snapshot.issues.map((issue) => ({
          client: entry.clientName,
          text: issue,
          color: "#f5a524",
        })),
      )
    : clients.flatMap((client) => client.churn.map((item) => ({ client: client.name, text: item.text, color: item.color }))))
    .slice(0, 6);
  const recommendations = savedWorkspaceSnapshots.flatMap((entry) =>
    entry.snapshot.recommendations.map((recommendation) => ({
      client: entry.clientName,
      text: recommendation,
      updatedAt: entry.snapshot.updatedAt,
    })),
  );
  const meetings = savedWorkspaceSnapshots.flatMap((entry) =>
    entry.snapshot.meetingAgenda.map((agendaItem, index) => ({
      client: entry.clientName,
      text: agendaItem,
      updatedAt: entry.snapshot.updatedAt,
      key: `${entry.clientName}-${index}-${agendaItem}`,
    })),
  );
  const postMeetings = clients.flatMap((client) =>
    client.aiArtifacts?.postMeeting
      ? [
          {
            clientId: client.id,
            client: client.name,
            recap: client.aiArtifacts.postMeeting,
          },
        ]
      : [],
  );
  const postMeetingActionItems = clients.flatMap((client) =>
    client.aiArtifacts?.postMeeting
      ? client.aiArtifacts.postMeeting.actionItems.map((item, index) => {
          const state = getClickUpActionState(item.clickupSync);
          return {
            key: `${client.id}-${index}-${item.department}-${item.task}`,
            clientId: client.id,
            clientName: client.name,
            updatedAt: client.aiArtifacts?.postMeeting?.updatedAt || null,
            state,
            item,
          };
        })
      : [],
  );
  const openActionItems = postMeetingActionItems.filter((entry) => entry.state === "open");
  const completedActionItems = postMeetingActionItems.filter((entry) => entry.state === "completed");
  const missingActionItems = postMeetingActionItems.filter((entry) => entry.state === "missing");
  const unsyncedActionItems = postMeetingActionItems.filter((entry) => entry.state === "unsynced");
  const actionQueue = [...missingActionItems, ...openActionItems, ...unsyncedActionItems].slice(0, 6);
  const actionStateIssues = actionQueue.map((entry) => ({
    client: entry.clientName,
    text:
      entry.state === "missing"
        ? `A synced ClickUp post-meeting task is missing and needs to be recreated or relinked: ${entry.item.task}`
        : entry.state === "open"
          ? `A ClickUp post-meeting task is still open: ${entry.item.task}`
          : `A post-meeting action item still needs to be pushed to ClickUp: ${entry.item.task}`,
    color: entry.state === "missing" ? "#f5544f" : entry.state === "open" ? "#f5a524" : "#4a9eff",
  }));
  const actionStateRecommendations = [
    ...missingActionItems.slice(0, 3).map((entry) => ({
      client: entry.clientName,
      text: `Recreate or relink the missing ClickUp action item for ${entry.item.department}: ${entry.item.task}`,
      updatedAt: entry.updatedAt || new Date().toISOString(),
    })),
    ...openActionItems
      .filter((entry) => !!entry.item.clickupSync?.dueDate)
      .slice(0, 3)
      .map((entry) => ({
        client: entry.clientName,
        text: `Review the still-open ClickUp action item and confirm the owner, due date, and next follow-up: ${entry.item.task}`,
        updatedAt: entry.updatedAt || new Date().toISOString(),
      })),
    ...unsyncedActionItems.slice(0, 3).map((entry) => ({
      client: entry.clientName,
      text: `Push the unsynced MTOS post-meeting action item into ClickUp so it can be tracked operationally: ${entry.item.task}`,
      updatedAt: entry.updatedAt || new Date().toISOString(),
    })),
  ];
  const scoreDrivenIssues = highRiskClients.slice(0, 4).map((client) => ({
    client: client.name,
    text: `MTOS risk is ${client.mtosScores?.risk ?? "—"}/100. ${client.mtosScores?.factors.risk.slice(0, 2).join(" · ")}`,
    color: "#f5544f",
  }));
  const scoreDrivenRecommendations = [
    ...highRiskClients.slice(0, 3).map((client) => ({
      client: client.name,
      text: `Reduce MTOS risk by resolving the top drivers first: ${client.mtosScores?.factors.risk.slice(0, 2).join(" · ")}.`,
      updatedAt: new Date().toISOString(),
    })),
    ...upsellReadyClients.slice(0, 3).map((client) => ({
      client: client.name,
      text: `MTOS upsell readiness is ${client.mtosScores?.upsellReadiness ?? "—"}/100. Use the next touch to explore growth around ${client.mtosScores?.factors.upsell.slice(0, 2).join(" · ")}.`,
      updatedAt: new Date().toISOString(),
    })),
  ];
  const combinedIssues = [...issues, ...scoreDrivenIssues, ...actionStateIssues].slice(0, 8);
  const combinedRecommendations = [...recommendations, ...scoreDrivenRecommendations, ...actionStateRecommendations].slice(0, 8);
  const currentClientActionFeed = currentClient?.aiArtifacts?.postMeeting
    ? currentClient.aiArtifacts.postMeeting.actionItems.map((item, index) => {
        const state = getClickUpActionState(item.clickupSync);
        return {
          key: `${currentClient.id}-action-${index}-${item.department}-${item.task}`,
          text:
            state === "completed"
              ? `ClickUp action completed: ${item.task}`
              : state === "missing"
                ? `ClickUp action missing: ${item.task}`
                : state === "open"
                  ? `ClickUp action open: ${item.task}`
                  : `MTOS action ready to sync: ${item.task}`,
          meta: clickUpActionMeta({
            department: item.department,
            owner: item.owner,
            dueDate: item.dueDate,
            clickupDueDate: item.clickupSync?.dueDate,
            assignee: item.clickupSync?.assignee,
            lastSyncedAt: item.clickupSync?.lastSyncedAt,
          }),
          dot: clickUpActionDot(state),
        };
      })
    : [];
  const currentClientActionSummary = currentClient?.aiArtifacts?.postMeeting
    ? (() => {
        const states = currentClient.aiArtifacts.postMeeting.actionItems.map((item) => getClickUpActionState(item.clickupSync));
        return {
          open: states.filter((state) => state === "open").length,
          completed: states.filter((state) => state === "completed").length,
          missing: states.filter((state) => state === "missing").length,
          unsynced: states.filter((state) => state === "unsynced").length,
        };
      })()
    : null;
  const currentClientActivityFeed = [...currentClientActionFeed, ...(currentClient?.activity || [])].slice(0, 10);

  async function refreshData() {
    if (!user) return;
    const [clientResponse, integrationResponse, aiResponse] = await Promise.all([
      fetchJson<{ clients: UiClient[] }>("/api/clients"),
      fetchJson<{
        integrations: UserIntegrationStatus[];
        adminSources: AdminSourceStatus[];
      }>("/api/integrations"),
      fetchJson<AiRouterStatus>("/api/ai/router"),
    ]);

    setClients(clientResponse.clients);
    setIntegrations(integrationResponse.integrations);
    setAdminSources(integrationResponse.adminSources);
    setAiStatus(aiResponse.execution || null);
    setSelectedClientId((current) => current || clientResponse.clients[0]?.id || null);
  }

  async function refreshAiStatus() {
    if (!user) return;
    try {
      const response = await fetchJson<AiRouterStatus>("/api/ai/router");
      setAiStatus(response.execution || null);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Unable to load AI runtime status.");
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    try {
      const endpoint = authMode === "signin" ? "/api/auth/signin" : "/api/auth/signup";
      const payload =
        authMode === "signin"
          ? { email: authEmail, password: authPassword }
          : { name: authName, email: authEmail, password: authPassword };

      const response = await fetchJson<{ user: AuthedUser }>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setUser(response.user);
      setScreen("dashboard");
      setAuthPassword("");
      setToast("Signed in. Monthly Touch OS is live.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to continue.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/signout", { method: "POST" });
    setUser(null);
    setClients([]);
    setIntegrations([]);
    setAdminSources([]);
    setSelectedClientId(null);
    setScreen("dashboard");
    setToast(null);
    setAiStatus(null);
    setAiOutput(null);
    setAiRoute(null);
    setAiTaskLabel(null);
  }

  async function runAiTask(args: {
    label: string;
    task: string;
    taskType: AiTaskType;
    clientId?: string;
    artifactType?: string;
  }) {
    setAiLoading(true);
    setAiError(null);
    setAiTaskLabel(args.label);

    try {
      const response = await fetchJson<AiRouterResponse>("/api/ai/router", {
        method: "POST",
        body: JSON.stringify({
          task: args.task,
          taskType: args.taskType,
          clientId: args.clientId,
          artifactType: args.artifactType,
          artifactTitle: args.label,
          execute: true,
          maxTokens: 2048,
          temperature: 0.2,
        }),
      });

      setAiRoute(response.router);
      setAiOutput(response.execution || null);
      await refreshData();
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Unable to run the MTOS AI workspace.");
      setAiOutput(null);
      setAiRoute(null);
    } finally {
      setAiLoading(false);
    }
  }

  async function pushPostMeetingToClickUp(clientId: string) {
    setClickUpPushClientId(clientId);
    setBannerError(null);

    try {
      const result = await fetchJson<ClickUpPostMeetingSyncResponse>("/api/integrations/clickup/post-meeting-sync", {
        method: "POST",
        body: JSON.stringify({ clientId }),
      });

      setToast(
        `ClickUp sync for ${result.clientName}: ${result.createdCount} created, ${result.updatedCount} updated, ${result.skippedCount} linked.`,
      );
      await refreshData();
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "Unable to push post-meeting tasks to ClickUp.");
    } finally {
      setClickUpPushClientId(null);
    }
  }

  function openClickUpAuthorize() {
    if (!user) return;
    const connected = integrations.find((item) => item.slug === "clickup");
    if (connected?.status === "connected") {
      void openClickUpSync();
      return;
    }

    setClickup({
      step: "authorize",
      email: connected?.accountEmail || user.email,
        workspaceId: "",
        workspaceName: connected?.workspaceName || "",
      picks: {},
      rows: [],
      syncIndex: 0,
      error: null,
      count: 0,
    });
  }

  async function startClickUpOAuth() {
    if (!clickup) return;
    setClickup({ ...clickup, step: "connecting", error: null });

    try {
      const result = await fetchJson<{ authUrl: string }>("/api/integrations/clickup/connect", {
        method: "POST",
        body: JSON.stringify({
          email: clickup.email,
        }),
      });

      window.location.assign(result.authUrl);
    } catch (error) {
      setClickup({
        ...clickup,
        step: "authorize",
        error: error instanceof Error ? error.message : "Unable to open ClickUp OAuth.",
      });
    }
  }

  async function disconnectClickUp() {
    try {
      await fetchJson("/api/integrations/clickup/connect", { method: "DELETE" });
      await refreshData();
      setToast("ClickUp disconnected.");
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "Unable to disconnect ClickUp.");
    }
  }

  async function openGoogleAuthorize(target: GoogleConnectTarget) {
    try {
      const result = await fetchJson<{ authUrl: string }>("/api/integrations/google/connect", {
        method: "POST",
        body: JSON.stringify({ target }),
      });
      window.location.assign(result.authUrl);
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "Unable to start Google authorization.");
    }
  }

  async function disconnectGoogle(target: GoogleConnectTarget) {
    try {
      await fetchJson("/api/integrations/google/connect", {
        method: "DELETE",
        body: JSON.stringify({ target }),
      });
      await refreshData();
      setToast("Google integration disconnected.");
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "Unable to disconnect Google integration.");
    }
  }

  function openManualConnect(target: ManualConnectTarget) {
    const titleMap: Record<ManualConnectTarget, string> = {
      ghl: "Connect GoHighLevel",
      ahrefs: "Connect Ahrefs",
      meta: "Connect Meta Ads",
    };
    const subtitleMap: Record<ManualConnectTarget, string> = {
      ghl: "Store the agency token securely for CRM, pipelines, and conversation sync.",
      ahrefs: "Store your Ahrefs bearer token securely for SEO and backlink data pulls.",
      meta: "Store your Meta Ads access token securely for paid-media reporting.",
    };
    const existingIntegration = integrations.find((item) => item.slug === target);
    const existingSource = adminSources.find((item) => item.key === target);

    setManualConnect({
      target,
      title: titleMap[target],
      subtitle: subtitleMap[target],
      accountEmail: existingIntegration?.accountEmail || existingSource?.accountEmail || "",
      workspaceName: existingIntegration?.workspaceName || existingSource?.workspaceName || "",
      accessToken: "",
      refreshToken: "",
      scope: "",
      expiresIn: "",
      saving: false,
      error: null,
    });
  }

  async function submitManualConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualConnect) return;

    setManualConnect({ ...manualConnect, saving: true, error: null });
    try {
      await fetchJson("/api/integrations/manual-token", {
        method: "POST",
        body: JSON.stringify({
          target: manualConnect.target,
          accountEmail: manualConnect.accountEmail,
          workspaceName: manualConnect.workspaceName,
          accessToken: manualConnect.accessToken,
          refreshToken: manualConnect.refreshToken || undefined,
          scope: manualConnect.scope || undefined,
          expiresIn: manualConnect.expiresIn || undefined,
        }),
      });
      await refreshData();
      setManualConnect(null);
      setToast(`${manualConnect.title.replace("Connect ", "")} connected.`);
    } catch (error) {
      setManualConnect((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: error instanceof Error ? error.message : "Unable to save the token.",
            }
          : current,
      );
    }
  }

  async function disconnectManual(target: ManualConnectTarget) {
    try {
      await fetchJson("/api/integrations/manual-token", {
        method: "DELETE",
        body: JSON.stringify({ target }),
      });
      await refreshData();
      setToast("Integration disconnected.");
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "Unable to disconnect integration.");
    }
  }

  async function openClickUpSync() {
    const connected = integrations.find((item) => item.slug === "clickup");

    try {
      const result = await fetchJson<{ managerName: string; clients: UiClient[] }>(
        "/api/integrations/clickup/assigned-clients",
      );

      const picks = Object.fromEntries(result.clients.map((client) => [client.id, true]));
      setClickup({
        step: "sync",
        email: connected?.accountEmail || user?.email || "",
        workspaceId: "",
        workspaceName: connected?.workspaceName || "",
        picks,
        rows: result.clients,
        syncIndex: 0,
        error: null,
        count: 0,
      });
    } catch (error) {
      setClickup({
        step: "sync",
        email: connected?.accountEmail || user?.email || "",
        workspaceId: "",
        workspaceName: connected?.workspaceName || "",
        picks: {},
        rows: [],
        syncIndex: 0,
        error: error instanceof Error ? error.message : "Unable to load assigned accounts.",
        count: 0,
      });
    }
  }

  function togglePick(clientId: string) {
    if (!clickup) return;
    setClickup({
      ...clickup,
      picks: {
        ...clickup.picks,
        [clientId]: !clickup.picks[clientId],
      },
    });
  }

  function setAllPicks(value: boolean) {
    if (!clickup) return;
    setClickup({
      ...clickup,
      picks: Object.fromEntries(clickup.rows.map((client) => [client.id, value])),
    });
  }

  async function startClickUpSync() {
    if (!clickup) return;
    const selectedIds = clickup.rows.filter((row) => clickup.picks[row.id]).map((row) => row.id);
    if (!selectedIds.length) return;

    setClickup({
      ...clickup,
      step: "syncing",
      syncIndex: 0,
      error: null,
      count: selectedIds.length,
    });

    try {
      const syncPromise = fetchJson<{ count: number }>("/api/integrations/clickup/sync", {
        method: "POST",
        body: JSON.stringify({ selectedIds }),
      });

      for (let index = 0; index < selectedIds.length; index += 1) {
        await sleep(420);
        setClickup((current) =>
          current
            ? {
                ...current,
                step: "syncing",
                syncIndex: index + 1,
              }
            : current,
        );
      }

      const result = await syncPromise;
      await refreshData();
      setClickup((current) =>
        current
          ? {
              ...current,
              step: "done",
              count: result.count,
              syncIndex: result.count,
            }
          : current,
      );
      setToast(`${result.count} clients synced from ClickUp.`);
    } catch (error) {
      setClickup((current) =>
        current
          ? {
              ...current,
              step: "sync",
              error: error instanceof Error ? error.message : "Unable to sync clients.",
            }
          : current,
      );
    }
  }

  function renderMain() {
    if (loading) {
      return (
        <div className="mt-card flex min-h-80 items-center justify-center rounded-2xl">
          <div className="flex items-center gap-3 text-slate-300">
            <div className="h-5 w-5 animate-mtspin rounded-full border-2 border-white/10 border-t-cyan-400" />
            Loading Monthly Touch OS...
          </div>
        </div>
      );
    }

    if (screen === "dashboard") {
      return (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
            <StatCard label="Synced clients" value={String(clients.length)} note="Persisted across sign-in and sign-out." />
            <StatCard label="High risk" value={String(highRiskClients.length)} note="MTOS risk score 70 or higher." />
            <StatCard label="Upsell ready" value={String(upsellReadyClients.length)} note="MTOS upsell readiness 72 or higher." />
            <StatCard
              label="Open actions"
              value={String(openActionItems.length)}
              note="Synced ClickUp tasks that still need work."
            />
            <StatCard
              label="Completed"
              value={String(completedActionItems.length)}
              note="Post-meeting action items already finished in ClickUp."
            />
            <StatCard
              label="Missing"
              value={String(missingActionItems.length)}
              note="Tracked tasks that no longer exist in ClickUp."
            />
            <StatCard label="Connected" value={`${connectedCount} / ${userScopedIntegrations.length}`} note="Per-manager integrations live on this login." />
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.2fr,.8fr]">
            <div className="mt-card rounded-2xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="mt-label">Client Health Tracker</div>
                  <h2 className="mt-2 font-display text-2xl font-bold">Your synced book of business</h2>
                </div>
                <button
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300"
                  onClick={() => setScreen("clients")}
                >
                  View clients
                </button>
              </div>
              <div className="mt-6 space-y-3">
                {clients.length ? (
                  clients.slice(0, 5).map((client) => (
                    <button
                      key={client.id}
                      onClick={() => {
                        setSelectedClientId(client.id);
                        setScreen("clients");
                      }}
                      className="flex w-full items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 text-left"
                    >
                      <div
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold text-white"
                        style={{
                          background: `linear-gradient(140deg, ${client.avatar[0]}, ${client.avatar[1]})`,
                        }}
                      >
                        {client.initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{client.name}</div>
                        <div className="truncate text-xs text-slate-400">
                          {client.industry} · {client.location}
                        </div>
                      </div>
                      <div
                        className={clsx(
                          "rounded-full px-3 py-1 text-xs font-semibold",
                          healthTone(client) === "success" && "bg-emerald-400/15 text-emerald-300",
                          healthTone(client) === "warning" && "bg-amber-400/15 text-amber-200",
                          healthTone(client) === "danger" && "bg-rose-400/15 text-rose-300",
                          healthTone(client) === "neutral" && "bg-white/5 text-slate-300",
                        )}
                      >
                        {client.health ? `Health ${client.health}` : "Awaiting KPI sources"}
                      </div>
                    </button>
                  ))
                ) : (
                  <EmptyPanel
                    title="No clients synced yet"
                    description="The roster stays empty until ClickUp returns Client Health Tracker rows assigned to you. It never invents accounts."
                    action={
                      <button className="rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f] teal-gradient" onClick={openClickUpAuthorize}>
                        Connect ClickUp
                      </button>
                    }
                  />
                )}
              </div>
            </div>
            <div className="space-y-6">
              <div className="mt-card rounded-2xl p-6">
                <div className="mt-label">Wins Library</div>
                <div className="mt-4 space-y-3">
                  {wins.length ? (
                    wins.map((win) => (
                      <div key={win} className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.05] p-4 text-sm text-slate-200">
                        {win}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-slate-400">
                      KPI-driven wins appear here once downstream data sources are connected.
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-card rounded-2xl p-6">
                <div className="mt-label">Issues Queue</div>
                <div className="mt-4 space-y-3">
                  {combinedIssues.length ? (
                    combinedIssues.map((issue) => (
                      <div key={`${issue.client}-${issue.text}`} className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.05] p-4 text-sm">
                        <div className="font-semibold text-slate-100">{issue.client}</div>
                        <div className="mt-1 text-slate-400">{issue.text}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-slate-400">
                      Churn signals appear here when the health tracker or CRM enrichment adds them.
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-card rounded-2xl p-6">
                <div className="mt-label">Action Sync Queue</div>
                <div className="mt-4 space-y-3">
                  {actionQueue.length ? (
                    actionQueue.map((entry) => (
                      <div key={entry.key} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="font-semibold text-slate-100">{entry.clientName}</div>
                          <div className={clsx("rounded-full px-3 py-1 text-xs font-semibold", clickUpActionStateTone(entry.state))}>
                            {clickUpActionStateLabel(entry.state, entry.item.clickupSync?.status)}
                          </div>
                        </div>
                        <div className="mt-2 text-slate-300">{entry.item.task}</div>
                        <div className="mt-2 text-xs text-slate-500">
                          {clickUpActionMeta({
                            department: entry.item.department,
                            owner: entry.item.owner,
                            dueDate: entry.item.dueDate,
                            clickupDueDate: entry.item.clickupSync?.dueDate,
                            assignee: entry.item.clickupSync?.assignee,
                            lastSyncedAt: entry.item.clickupSync?.lastSyncedAt,
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-slate-400">
                      Run `Post Meeting`, then push the action items to ClickUp to track open, completed, and missing work here.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (screen === "clients") {
      if (!clients.length) {
        return (
          <EmptyPanel
            title="Client roster is empty"
            description="Monthly Touch OS does not synthesize demo accounts. Connect ClickUp and sync only the Client Health Tracker rows assigned to you."
            action={
              <button className="rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f] teal-gradient" onClick={openClickUpAuthorize}>
                Open ClickUp wizard
              </button>
            }
          />
        );
      }

      if (!currentClient) {
        return (
          <EmptyPanel
            title="Client roster is empty"
            description="Monthly Touch OS only shows clients that have been synced from your real ClickUp Client Health Tracker."
            action={
              <button className="rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f] teal-gradient" onClick={openClickUpAuthorize}>
                Open ClickUp wizard
              </button>
            }
          />
        );
      }

      return (
        <div className="grid gap-6 xl:grid-cols-[420px,1fr]">
          <div className="mt-card rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="mt-label">Client Health Tracker</div>
                <h2 className="mt-2 font-display text-2xl font-bold">Roster</h2>
              </div>
              <div className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{clients.length} accounts</div>
            </div>
            <div className="scroll-thin mt-5 max-h-[72vh] space-y-3 overflow-y-auto pr-1">
              {clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => setSelectedClientId(client.id)}
                  className={clsx(
                    "w-full rounded-2xl border p-4 text-left transition",
                    selectedClientId === client.id
                      ? "border-cyan-400/45 bg-cyan-400/[0.08]"
                      : "border-white/8 bg-white/[0.02]",
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold text-white"
                      style={{
                        background: `linear-gradient(140deg, ${client.avatar[0]}, ${client.avatar[1]})`,
                      }}
                    >
                      {client.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{client.name}</div>
                      <div className="truncate text-xs text-slate-400">
                        {client.industry} · {client.location}
                      </div>
                    </div>
                    <div className={clsx("text-xs font-semibold", sentimentTone(client.sentiment))}>{client.sentiment}</div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-slate-400">
                    <div>
                      <div className="mt-label">Health</div>
                      <div className="mt-1 text-sm text-slate-100">{client.health ?? "—"}</div>
                    </div>
                    <div>
                      <div className="mt-label">MRR</div>
                      <div className="mt-1 text-sm text-slate-100">{client.mrr}</div>
                    </div>
                    <div>
                      <div className="mt-label">Next touch</div>
                      <div className="mt-1 text-sm text-slate-100">{client.nextTouch}</div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl bg-white/[0.03] px-3 py-3 text-sm text-slate-300">{client.riskNote}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="mt-card rounded-2xl p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold"
                    style={{
                      background: `linear-gradient(140deg, ${currentClient.avatar[0]}, ${currentClient.avatar[1]})`,
                    }}
                  >
                    {currentClient.initials}
                  </div>
                  <div>
                    <h2 className="font-display text-3xl font-bold">{currentClient.name}</h2>
                    <div className="mt-1 text-sm text-slate-400">
                      {currentClient.industry} · {currentClient.location}
                    </div>
                  </div>
                </div>
                <div className="rounded-full bg-white/5 px-4 py-2 text-sm text-slate-300">
                  Account Manager: {currentClient.accountManager || user?.name}
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                {(currentClient.kpis.length ? currentClient.kpis : new Array(6).fill(null)).map((kpi, index) => (
                  <div key={kpi?.label || index} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                    <div className="text-xs uppercase tracking-[0.08em] text-slate-500">
                      {kpi?.label || `Metric ${index + 1}`}
                    </div>
                    <div className="mt-3 font-display text-2xl font-bold">{kpi?.value || "—"}</div>
                    <div className={clsx("mt-2 text-sm", kpi?.good ? "text-emerald-300" : "text-slate-400")}>
                      {kpi?.delta || "Waiting on connected KPI sources"}
                    </div>
                  </div>
                ))}
              </div>

              {currentClient.mtosScores ? (
                <section className="mt-6 rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="mt-label">MTOS Scorecard</div>
                    <div className="text-xs text-slate-500">
                      Computed {new Date(currentClient.mtosScores.computedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Health</div>
                      <div className="mt-2 flex items-end justify-between gap-3">
                        <div className="font-display text-3xl font-bold text-slate-100">{currentClient.mtosScores.health}</div>
                        {currentClient.mtosScores.deltas.health !== null ? (
                          <div className="text-sm font-semibold text-slate-400">
                            Δ {currentClient.mtosScores.deltas.health >= 0 ? "+" : ""}
                            {currentClient.mtosScores.deltas.health}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 text-sm text-slate-400">{currentClient.mtosScores.factors.health.slice(0, 2).join(" · ")}</div>
                    </div>
                    <div className="rounded-2xl bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Risk</div>
                      <div className="mt-2 flex items-end justify-between gap-3">
                        <div className="font-display text-3xl font-bold text-rose-300">{currentClient.mtosScores.risk}</div>
                        {currentClient.mtosScores.deltas.risk !== null ? (
                          <div className="text-sm font-semibold text-slate-400">
                            Δ {currentClient.mtosScores.deltas.risk >= 0 ? "+" : ""}
                            {currentClient.mtosScores.deltas.risk}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 text-sm text-slate-400">{currentClient.mtosScores.factors.risk.slice(0, 2).join(" · ")}</div>
                    </div>
                    <div className="rounded-2xl bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Upsell Readiness</div>
                      <div className="mt-2 flex items-end justify-between gap-3">
                        <div className="font-display text-3xl font-bold text-emerald-300">{currentClient.mtosScores.upsellReadiness}</div>
                        {currentClient.mtosScores.deltas.upsellReadiness !== null ? (
                          <div className="text-sm font-semibold text-slate-400">
                            Δ {currentClient.mtosScores.deltas.upsellReadiness >= 0 ? "+" : ""}
                            {currentClient.mtosScores.deltas.upsellReadiness}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 text-sm text-slate-400">{currentClient.mtosScores.factors.upsell.slice(0, 2).join(" · ")}</div>
                    </div>
                  </div>
                  <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-100">Last 30 score snapshots</div>
                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-white/5 px-3 py-1 text-slate-200">Health</span>
                        <span className="rounded-full bg-white/5 px-3 py-1 text-rose-200">Risk</span>
                        <span className="rounded-full bg-white/5 px-3 py-1 text-emerald-200">Upsell</span>
                      </div>
                    </div>
                    {scoreHistoryLoading ? (
                      <div className="mt-4 flex items-center gap-3 text-sm text-slate-300">
                        <div className="h-4 w-4 animate-mtspin rounded-full border-2 border-white/10 border-t-cyan-400" />
                        Loading score history...
                      </div>
                    ) : scoreHistoryError ? (
                      <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200">
                        {scoreHistoryError}
                      </div>
                    ) : scoreChart.hasData ? (
                      <div className="mt-4">
                        <svg
                          viewBox={`0 0 ${scoreChart.width} ${scoreChart.height}`}
                          className="h-auto w-full"
                          role="img"
                          aria-label="MTOS score history chart"
                        >
                          <path d={scoreChart.healthPath} fill="none" stroke="#e2e8f0" strokeWidth="2" opacity="0.9" />
                          <path d={scoreChart.riskPath} fill="none" stroke="#fb7185" strokeWidth="2" opacity="0.9" />
                          <path d={scoreChart.upsellPath} fill="none" stroke="#34d399" strokeWidth="2" opacity="0.9" />
                        </svg>
                        <div className="mt-3 text-xs text-slate-500">{scoreChart.points} snapshots · newest on the right</div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                        Score history will appear after a few refresh cycles. MTOS saves snapshots automatically from the clients API.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr,.9fr]">
                <div className="space-y-6">
                  <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="mt-label">MTOS AI Workspace</div>
                        <div className="mt-2 font-display text-2xl font-bold">Run the master prompt on this client</div>
                        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                          This panel sends the selected client’s live MTOS context through the app router, then routes the task to Gemini for collection/diagnosis or Claude for analysis and deliverables.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <div
                          className={clsx(
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            aiStatus?.gemini.configured ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-slate-400",
                          )}
                        >
                          Gemini {aiStatus?.gemini.configured ? "ready" : "not configured"}
                        </div>
                        <div
                          className={clsx(
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            aiStatus?.claude.configured ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-slate-400",
                          )}
                        >
                          Claude {aiStatus?.claude.configured ? "ready" : "not configured"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <button
                        className="teal-gradient rounded-2xl px-4 py-3 text-sm font-semibold text-[#06231f]"
                        disabled={aiLoading}
                        onClick={() =>
                          runAiTask({
                            label: "Prepare Monthly Touch",
                            task: `Prepare the Monthly Touch workspace snapshot for ${currentClient.name}. Answer what happened, why it happened, what we are doing about it, what should happen next, and how this helps the client grow. Include wins, issues, recommendations, and a meeting agenda.`,
                            taskType: "analysis",
                            clientId: currentClient.id,
                            artifactType: "WORKSPACE_SNAPSHOT",
                          })
                        }
                      >
                        {aiLoading && aiTaskLabel === "Prepare Monthly Touch" ? "Running..." : "Prepare Monthly Touch"}
                      </button>
                      <button
                        className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200"
                        disabled={aiLoading}
                        onClick={() =>
                          runAiTask({
                            label: "Executive Brief",
                            task: `Generate an Executive Brief for ${currentClient.name} using the MTOS master prompt and the current intelligence package.`,
                            taskType: "deliverable_generation",
                            clientId: currentClient.id,
                            artifactType: "EXECUTIVE_BRIEF",
                          })
                        }
                      >
                        {aiLoading && aiTaskLabel === "Executive Brief" ? "Running..." : "Executive Brief"}
                      </button>
                      <button
                        className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200"
                        disabled={aiLoading}
                        onClick={() =>
                          runAiTask({
                            label: "Client Summary",
                            task: `Generate a client-friendly Monthly Touch summary for ${currentClient.name}. Keep it simple, confident, and easy to understand.`,
                            taskType: "deliverable_generation",
                            clientId: currentClient.id,
                            artifactType: "CLIENT_SUMMARY",
                          })
                        }
                      >
                        {aiLoading && aiTaskLabel === "Client Summary" ? "Running..." : "Client Summary"}
                      </button>
                      <button
                        className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200"
                        disabled={aiLoading}
                        onClick={() =>
                          runAiTask({
                            label: "Connector Diagnosis",
                            task: `Diagnose missing or weak source coverage for ${currentClient.name}. Use connected systems as the source of truth and identify what is available, what is missing, and the next connector actions.`,
                            taskType: "connector_diagnosis",
                            clientId: currentClient.id,
                            artifactType: "CONNECTOR_DIAGNOSIS",
                          })
                        }
                      >
                        {aiLoading && aiTaskLabel === "Connector Diagnosis" ? "Running..." : "Connector Diagnosis"}
                      </button>
                      <button
                        className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200"
                        disabled={aiLoading}
                        onClick={() =>
                          runAiTask({
                            label: "Post Meeting",
                            task: `Generate the post monthly touch package for ${currentClient.name}. Return a meeting summary, client sentiment analysis, action items by department, suggested owners, due dates, ticket creation recommendations, and follow-up tasks.`,
                            taskType: "post_meeting",
                            clientId: currentClient.id,
                            artifactType: "POST_MEETING",
                          })
                        }
                      >
                        {aiLoading && aiTaskLabel === "Post Meeting" ? "Running..." : "Post Meeting"}
                      </button>
                    </div>

                    {aiRoute ? (
                      <div className="mt-5 rounded-2xl border border-sky-400/20 bg-sky-400/[0.05] p-4 text-sm leading-6 text-slate-200">
                        Routed to <b>{aiRoute.model}</b> during the <b>{aiRoute.phase}</b> phase as <b>{aiRoute.taskType}</b>.
                        <div className="mt-2 text-slate-300">{aiRoute.reason}</div>
                      </div>
                    ) : (
                      <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                        Run one of the MTOS actions above to execute the master prompt against this client’s live workspace context.
                      </div>
                    )}

                    {aiError ? (
                      <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] p-4 text-sm text-rose-100">
                        {aiError}
                      </div>
                    ) : null}

                    {aiOutput?.outputText ? (
                      <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-100">
                            {aiTaskLabel || "MTOS AI Output"} via {aiOutput.provider} · {aiOutput.model}
                          </div>
                          <div className="text-xs text-slate-500">
                            Input {aiOutput.usage.inputTokens ?? "—"} · Output {aiOutput.usage.outputTokens ?? "—"}
                          </div>
                        </div>
                        <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">{aiOutput.outputText}</div>
                      </div>
                    ) : null}

                    {currentClient.aiArtifacts?.workspaceSnapshot ? (
                      <div className="mt-5 rounded-2xl border border-teal-400/20 bg-teal-400/[0.05] p-5 text-sm leading-7 text-slate-200">
                        <div className="font-semibold text-slate-100">Latest saved MTOS snapshot</div>
                        <div className="mt-2 text-slate-300">{currentClient.aiArtifacts.workspaceSnapshot.summary}</div>
                        <div className="mt-3 text-xs text-slate-500">
                          Updated {new Date(currentClient.aiArtifacts.workspaceSnapshot.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    ) : null}

                    {currentClient.aiArtifacts?.clientSummary ? (
                      <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5">
                        <div className="mt-label">Saved Client Summary</div>
                        <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">
                          {currentClient.aiArtifacts.clientSummary.text}
                        </div>
                        <div className="mt-4 text-xs text-slate-500">
                          Updated {new Date(currentClient.aiArtifacts.clientSummary.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    ) : null}
                  </section>
                  <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="mt-label">Context</div>
                    <p className="mt-3 text-sm leading-7 text-slate-300">
                      {currentClient.context || "This account is synced from ClickUp. Additional context appears here as more systems enrich the client record."}
                    </p>
                  </section>
                  <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="mt-label">Goals</div>
                    <div className="mt-4 space-y-3">
                      {currentClient.goals.length ? (
                        currentClient.goals.map((goal) => (
                          <div key={goal} className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                            {goal}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                          No goals have been synced for this client yet.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
                <div className="space-y-6">
                  <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="mt-label">Action Workflow Health</div>
                    {currentClientActionSummary ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-4">
                        <div className="rounded-xl bg-white/[0.03] p-4">
                          <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Open</div>
                          <div className="mt-2 text-2xl font-bold text-amber-200">{currentClientActionSummary.open}</div>
                        </div>
                        <div className="rounded-xl bg-white/[0.03] p-4">
                          <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Completed</div>
                          <div className="mt-2 text-2xl font-bold text-emerald-300">{currentClientActionSummary.completed}</div>
                        </div>
                        <div className="rounded-xl bg-white/[0.03] p-4">
                          <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Missing</div>
                          <div className="mt-2 text-2xl font-bold text-rose-300">{currentClientActionSummary.missing}</div>
                        </div>
                        <div className="rounded-xl bg-white/[0.03] p-4">
                          <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Unsynced</div>
                          <div className="mt-2 text-2xl font-bold text-sky-300">{currentClientActionSummary.unsynced}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                        Run `Post Meeting` to create tracked action items, then push them to ClickUp to monitor workflow health here.
                      </div>
                    )}
                  </section>
                  <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="mt-label">Churn signals</div>
                    <div className="mt-4 space-y-3">
                      {currentClient.churn.length ? (
                        currentClient.churn.map((item) => (
                          <div key={item.text} className="flex gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                            <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                            <span>{item.text}</span>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                          No churn signals are stored for this client yet.
                        </div>
                      )}
                    </div>
                  </section>
                  <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="mt-label">Activity Feed</div>
                    <div className="mt-4 space-y-4">
                      {currentClientActivityFeed.length ? (
                        currentClientActivityFeed.map((entry) => (
                          <div key={`${entry.text}-${entry.meta}`} className="flex gap-3 text-sm">
                            <span className="mt-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.dot }} />
                            <div>
                              <div className="text-slate-100">{entry.text}</div>
                              <div className="mt-1 text-xs text-slate-500">{entry.meta}</div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                          ClickUp activity is connected. Additional feeds populate this stream as more integrations go live.
                        </div>
                      )}
                    </div>
                  </section>
                  <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="mt-label">Executive Brief</div>
                    {currentClient.aiArtifacts?.executiveBrief ? (
                      <>
                        <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">
                          {currentClient.aiArtifacts.executiveBrief.text}
                        </div>
                        <div className="mt-4 text-xs text-slate-500">
                          Updated {new Date(currentClient.aiArtifacts.executiveBrief.updatedAt).toLocaleString()}
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                        Run the saved MTOS Executive Brief action to persist the internal meeting brief for this client.
                      </div>
                    )}
                  </section>
                  <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="mt-label">Meeting Agenda</div>
                    {currentClient.aiArtifacts?.workspaceSnapshot?.meetingAgenda.length ? (
                      <div className="mt-4 space-y-3">
                        {currentClient.aiArtifacts.workspaceSnapshot.meetingAgenda.map((agendaItem, index) => (
                          <div key={`${index}-${agendaItem}`} className="flex gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                            <span className="text-teal-300">{index + 1}.</span>
                            <span>{agendaItem}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                        Run `Prepare Monthly Touch` to save a structured meeting agenda for this client.
                      </div>
                    )}
                  </section>
                  <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="mt-label">Post Meeting Summary</div>
                      {currentClient.aiArtifacts?.postMeeting ? (
                        <button
                          className="teal-gradient rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f]"
                          disabled={clickUpPushClientId === currentClient.id}
                          onClick={() => pushPostMeetingToClickUp(currentClient.id)}
                        >
                          {clickUpPushClientId === currentClient.id ? "Pushing to ClickUp..." : "Push To ClickUp"}
                        </button>
                      ) : null}
                    </div>
                    {currentClient.aiArtifacts?.postMeeting ? (
                      <div className="mt-4 space-y-5">
                        <div className="rounded-xl bg-white/[0.03] p-4 text-sm leading-7 text-slate-200">
                          {currentClient.aiArtifacts.postMeeting.summary}
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Client Sentiment</div>
                          <div className="mt-2 text-lg font-semibold text-slate-100">
                            {currentClient.aiArtifacts.postMeeting.sentiment.label}
                          </div>
                          <div className="mt-2 text-sm leading-7 text-slate-300">
                            {currentClient.aiArtifacts.postMeeting.sentiment.rationale}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Department Action Items</div>
                          <div className="mt-3 space-y-3">
                            {currentClient.aiArtifacts.postMeeting.actionItems.map((item, index) => (
                              <div key={`${index}-${item.department}-${item.task}`} className="rounded-xl bg-white/[0.03] p-4 text-sm text-slate-200">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="font-semibold text-slate-100">
                                    {item.department} · {item.owner}
                                  </div>
                                  <div
                                    className={clsx(
                                      "rounded-full px-3 py-1 text-xs font-semibold",
                                clickUpActionStateTone(getClickUpActionState(item.clickupSync)),
                                    )}
                                  >
                                    {clickUpActionStateLabel(
                                      getClickUpActionState(item.clickupSync),
                                      item.clickupSync?.status,
                                    )}
                                  </div>
                                </div>
                                <div className="mt-2 leading-7">{item.task}</div>
                                <div className="mt-2 text-xs text-slate-500">
                                  Due {item.dueDate}
                                  {item.clickupSync?.taskName ? ` · ${item.clickupSync.taskName}` : ""}
                                  {item.clickupSync?.assignee ? ` · Assignee ${item.clickupSync.assignee}` : ""}
                                  {item.clickupSync?.dueDate ? ` · ClickUp due ${formatMaybeDate(item.clickupSync.dueDate)}` : ""}
                                  {item.clickupSync?.lastSyncedAt
                                    ? ` · Synced ${formatMaybeDate(item.clickupSync.lastSyncedAt)}`
                                    : ""}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        {!!currentClient.aiArtifacts.postMeeting.ticketRecommendations.length && (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Ticket Recommendations</div>
                            <div className="mt-3 space-y-2">
                              {currentClient.aiArtifacts.postMeeting.ticketRecommendations.map((item, index) => (
                                <div key={`${index}-${item}`} className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {!!currentClient.aiArtifacts.postMeeting.followUps.length && (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Follow-Ups</div>
                            <div className="mt-3 space-y-2">
                              {currentClient.aiArtifacts.postMeeting.followUps.map((item, index) => (
                                <div key={`${index}-${item}`} className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="text-xs text-slate-500">
                          Updated {new Date(currentClient.aiArtifacts.postMeeting.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                        Run `Post Meeting` to save the recap, sentiment analysis, departmental actions, and follow-up tasks for this client.
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (screen === "integrations") {
      const activeSpec = INTEGRATION_SPECS[activeIntegration] || INTEGRATION_SPECS.clickup;
      const activeCard = INTEGRATIONS.find((item) => item.slug === activeIntegration) || INTEGRATIONS[0];
      const clickupStatus = integrations.find((item) => item.slug === "clickup");

      return (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mt-label">Monthly Touch pipeline</div>
              <h1 className="mt-2 font-display text-3xl font-bold">Integrations</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                Agency sources are connected once by an admin. Manager-scope integrations are connected per login. ClickUp is fully wired for OAuth and manager-scoped sync, and Google plus Map Ranking sources are now modeled as live integrations.
              </p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-slate-300">
              {connectedCount} personal connections active
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr,360px]">
            <div className="space-y-6">
              <div>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-sky-400" />
                  Agency connections
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {adminSources.map((source) => (
                    <div key={source.key} className="mt-card rounded-2xl p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold"
                            style={{ background: source.icon[0], color: source.icon[1] }}
                          >
                            {source.glyph}
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{source.label}</div>
                            <div className="text-xs text-slate-500">{source.description}</div>
                          </div>
                        </div>
                        <div
                          className={clsx(
                            "rounded-full px-3 py-1 text-[11px] font-semibold",
                            source.status === "connected" ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-slate-400",
                          )}
                        >
                          {source.status === "connected" ? "connected" : "admin"}
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-4 text-sm text-slate-400">
                        {source.accountEmail ? (
                          <span className="text-slate-200">
                            {source.accountEmail}
                            {source.workspaceName ? ` · ${source.workspaceName}` : ""}
                          </span>
                        ) : user?.role === "ADMIN" ? (
                          `Connect ${source.provider} here when the agency credentials are ready.`
                        ) : (
                          "Managed by your admin."
                        )}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {source.key === "mrapi" ? (
                          <button className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300" disabled>
                            {source.status === "connected" ? "Connected via env" : "Missing env configuration"}
                          </button>
                        ) : user?.role === "ADMIN" && (source.key === "mcc" || source.key === "adg") ? (
                          source.status === "connected" ? (
                            <button
                              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300"
                              onClick={() => disconnectGoogle(source.key as "mcc" | "adg")}
                            >
                              Disconnect
                            </button>
                          ) : (
                            <button
                              className="teal-gradient rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f]"
                              onClick={() => openGoogleAuthorize(source.key as "mcc" | "adg")}
                            >
                              Connect {source.provider}
                            </button>
                          )
                        ) : user?.role === "ADMIN" && source.key === "ghl" ? (
                          source.status === "connected" ? (
                            <button
                              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300"
                              onClick={() => disconnectManual("ghl")}
                            >
                              Disconnect
                            </button>
                          ) : (
                            <button
                              className="teal-gradient rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f]"
                              onClick={() => openManualConnect("ghl")}
                            >
                              Add agency token
                            </button>
                          )
                        ) : (
                          <button className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300" disabled>
                            {user?.role === "ADMIN" ? "Coming soon" : "Managed by admin"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Integration cards
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {integrations.map((integration) => {
                    const isClickUp = integration.slug === "clickup";
                    const isGoogleUser =
                      integration.slug === "gcalendar" ||
                      integration.slug === "gdrive" ||
                      integration.slug === "gmail" ||
                      integration.slug === "meet";
                    const isManualUser = integration.slug === "ahrefs" || integration.slug === "meta";
                    const isConnected = integration.status === "connected";
                    const source = integration.sourceKey ? adminSources.find((item) => item.key === integration.sourceKey) : null;

                    return (
                      <div key={integration.slug} className="mt-card rounded-2xl p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold"
                              style={{ background: integration.icon[0], color: integration.icon[1] }}
                            >
                              {integration.glyph}
                            </div>
                            <div>
                              <div className="text-sm font-semibold">{integration.name}</div>
                              <div className="text-xs text-slate-500">{integration.category}</div>
                            </div>
                          </div>
                          <div
                            className={clsx(
                              "rounded-full px-3 py-1 text-[11px] font-semibold",
                              isConnected ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-slate-400",
                            )}
                          >
                            {isConnected ? "connected" : "connect"}
                          </div>
                        </div>

                        <p className="mt-4 min-h-16 text-sm leading-6 text-slate-400">{integration.description}</p>

                        {integration.accountEmail ? (
                          <div className="rounded-xl bg-black/20 px-3 py-3 text-xs text-slate-300">
                            {integration.accountEmail}
                            {integration.workspaceName ? ` · ${integration.workspaceName}` : ""}
                          </div>
                        ) : null}

                        <div className="mt-4 flex gap-2">
                          {!isConnected ? (
                            isClickUp ? (
                              <button className="teal-gradient flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f]" onClick={openClickUpAuthorize}>
                                Connect your account
                              </button>
                            ) : isGoogleUser ? (
                              <button
                                className="teal-gradient flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f]"
                                onClick={() =>
                                  openGoogleAuthorize(integration.slug as "gcalendar" | "gdrive" | "gmail" | "meet")
                                }
                              >
                                Connect your account
                              </button>
                            ) : isManualUser ? (
                              <button
                                className="teal-gradient flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f]"
                                onClick={() => openManualConnect(integration.slug as ManualConnectTarget)}
                              >
                                Connect your account
                              </button>
                            ) : (
                              <button className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300" disabled>
                                {integration.scope === "admin"
                                  ? user?.role === "ADMIN"
                                    ? `Connect ${source?.label || "source"} above`
                                    : "Managed by admin"
                                  : "Coming soon"}
                              </button>
                            )
                          ) : isClickUp ? (
                            <>
                              <button className="purple-gradient flex-1 rounded-xl px-4 py-2 text-sm font-semibold" onClick={openClickUpSync}>
                                Sync clients
                              </button>
                              <button className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300" onClick={disconnectClickUp}>
                                Disconnect
                              </button>
                            </>
                          ) : isGoogleUser ? (
                            <>
                              <button className="flex-1 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200" disabled>
                                Connected
                              </button>
                              <button
                                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300"
                                onClick={() =>
                                  disconnectGoogle(integration.slug as "gcalendar" | "gdrive" | "gmail" | "meet")
                                }
                              >
                                Disconnect
                              </button>
                            </>
                          ) : isManualUser ? (
                            <>
                              <button className="flex-1 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200" disabled>
                                Connected
                              </button>
                              <button
                                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300"
                                onClick={() => disconnectManual(integration.slug as ManualConnectTarget)}
                              >
                                Disconnect
                              </button>
                            </>
                          ) : (
                            <button className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300" disabled>
                              {integration.scope === "admin" ? `Connected via ${source?.label || "admin source"}` : "Connected"}
                            </button>
                          )}
                          <button
                            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300"
                            onClick={() => setActiveIntegration(integration.slug)}
                          >
                            Data &rsaquo;
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-card sticky top-6 h-fit rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div
                  className={clsx(
                    "flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold",
                    activeCard.slug === "clickup" ? "clickup-gradient text-white" : "",
                  )}
                  style={
                    activeCard.slug === "clickup"
                      ? undefined
                      : { background: activeCard.icon[0], color: activeCard.icon[1] }
                  }
                >
                  {activeCard.glyph}
                </div>
                <div>
                  <div className="font-display text-2xl font-bold">{activeCard.name}</div>
                  <div className="text-sm text-slate-400">
                    {activeCard.category} · syncs {activeSpec.frequency}
                  </div>
                </div>
              </div>

              {activeCard.slug === "clickup" ? (
                <div className="mt-5 rounded-2xl border border-teal-400/20 bg-teal-400/[0.06] p-4 text-sm leading-6 text-slate-200">
                  The server enforces the critical rule: only Client Health Tracker rows where <b>{user?.name}</b> is the
                  Account Manager are shown in the sync list and persisted.
                </div>
              ) : null}

              <div className="mt-6">
                <div className="mt-label">Auth</div>
                <div className="mt-2 text-sm text-slate-200">{activeSpec.auth}</div>
              </div>
              <div className="mt-6">
                <div className="mt-label">Base URL</div>
                <div className="mt-2 break-all rounded-xl bg-black/20 px-4 py-3 font-mono text-xs text-cyan-300">
                  {activeSpec.base}
                </div>
              </div>
              <div className="mt-6">
                <div className="mt-label">Scopes</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {activeSpec.scopes.map((scope) => (
                    <span key={scope} className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 font-mono text-xs text-slate-200">
                      {scope}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-6">
                <div className="mt-label">Feeds into the OS</div>
                <div className="mt-3 space-y-3">
                  {activeSpec.feeds.map((feed) => (
                    <div key={feed} className="flex gap-3 text-sm text-slate-300">
                      <span className="text-teal-300">✓</span>
                      <span>{feed}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/[0.05] p-4 text-sm leading-6 text-slate-200">
                {activeSpec.automation}
              </div>
              <div className="mt-6">
                <div className="mt-label">Endpoints</div>
                <div className="mt-3 space-y-3">
                  {activeSpec.endpoints.map((endpoint) => (
                    <div key={`${endpoint.method}-${endpoint.path}`} className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={clsx(
                            "rounded-md px-2 py-1 font-mono text-xs font-semibold",
                            endpoint.method === "GET" && "bg-emerald-400/15 text-emerald-300",
                            endpoint.method === "POST" && "bg-amber-400/15 text-amber-200",
                          )}
                        >
                          {endpoint.method}
                        </span>
                        <span className="font-mono text-xs text-slate-200">{endpoint.path}</span>
                      </div>
                      <div className="mt-2 text-sm text-slate-400">{endpoint.description}</div>
                    </div>
                  ))}
                </div>
              </div>
              {clickupStatus?.status === "connected" ? (
                <button className="mt-6 teal-gradient w-full rounded-xl px-4 py-3 text-sm font-semibold text-[#06231f]" onClick={openClickUpSync}>
                  Open ClickUp sync wizard
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    if (screen === "wiki") {
      return (
        <div className="space-y-6">
          <div>
            <div className="mt-label">Dashboard Wiki</div>
            <h1 className="mt-2 font-display text-3xl font-bold">Field Manual</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
              The approved field manual content from the prototype is embedded here as a reference surface inside the real app shell.
            </p>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            {FIELD_MANUAL.map((article) => (
              <article key={article.title} className="mt-card rounded-2xl p-6">
                <div className="inline-flex rounded-full bg-teal-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-teal-300">
                  {article.category}
                </div>
                <h2 className="mt-4 font-display text-2xl font-bold">{article.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-400">{article.intro}</p>
                <div className="mt-5 space-y-3">
                  {article.sections.map((section) => (
                    <div key={section} className="flex gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 text-sm text-slate-300">
                      <span className="text-teal-300">•</span>
                      <span>{section}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      );
    }

    if (screen === "wins") {
      return wins.length ? (
        <div className="space-y-4">
          {wins.map((win) => (
            <div key={win} className="mt-card rounded-2xl border-emerald-400/20 bg-emerald-400/[0.05] p-5 text-sm text-slate-200">
              {win}
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel title="No wins yet" description="Run `Prepare Monthly Touch` on a client to save MTOS wins here." />
      );
    }

    if (screen === "issues") {
      return combinedIssues.length ? (
        <div className="space-y-4">
          {combinedIssues.map((issue) => (
            <div key={`${issue.client}-${issue.text}`} className="mt-card rounded-2xl p-5">
              <div className="font-semibold">{issue.client}</div>
              <div className="mt-2 text-sm text-slate-400">{issue.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel title="No issues captured" description="Run `Prepare Monthly Touch` on a client to save MTOS issues here." />
      );
    }

    if (screen === "meetings") {
      return meetings.length || postMeetings.length ? (
        <div className="space-y-6">
          {postMeetings.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {postMeetings.map((meeting) => (
                <div key={`${meeting.clientId}-post-meeting`} className="mt-card rounded-2xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="mt-label">Post monthly touch</div>
                    <button
                      className="teal-gradient rounded-xl px-4 py-2 text-sm font-semibold text-[#06231f]"
                      disabled={clickUpPushClientId === meeting.clientId}
                      onClick={() => pushPostMeetingToClickUp(meeting.clientId)}
                    >
                      {clickUpPushClientId === meeting.clientId ? "Pushing to ClickUp..." : "Push To ClickUp"}
                    </button>
                  </div>
                  <h3 className="mt-3 font-display text-2xl font-bold">{meeting.client}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{meeting.recap.summary}</p>
                  <div className="mt-4 rounded-xl bg-white/[0.03] p-4 text-sm text-slate-200">
                    <div className="font-semibold text-slate-100">{meeting.recap.sentiment.label}</div>
                    <div className="mt-2 leading-7 text-slate-300">{meeting.recap.sentiment.rationale}</div>
                  </div>
                  {!!meeting.recap.actionItems.length && (
                    <div className="mt-4 space-y-2">
                      {meeting.recap.actionItems.slice(0, 3).map((item, index) => (
                        <div key={`${index}-${item.department}-${item.task}`} className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="font-semibold text-slate-100">
                              {item.department} · {item.owner}
                            </div>
                            <div
                              className={clsx(
                                "rounded-full px-3 py-1 text-xs font-semibold",
                                clickUpActionStateTone(getClickUpActionState(item.clickupSync)),
                              )}
                            >
                              {clickUpActionStateLabel(getClickUpActionState(item.clickupSync), item.clickupSync?.status)}
                            </div>
                          </div>
                          <div className="mt-2 leading-7">{item.task}</div>
                          <div className="mt-2 text-xs text-slate-500">
                            Due {item.dueDate}
                            {item.clickupSync?.assignee ? ` · Assignee ${item.clickupSync.assignee}` : ""}
                            {item.clickupSync?.dueDate ? ` · ClickUp due ${formatMaybeDate(item.clickupSync.dueDate)}` : ""}
                            {item.clickupSync?.lastSyncedAt
                              ? ` · Synced ${formatMaybeDate(item.clickupSync.lastSyncedAt)}`
                              : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 text-xs text-slate-500">
                    Saved {new Date(meeting.recap.updatedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {meetings.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {meetings.map((meeting) => (
                <div key={meeting.key} className="mt-card rounded-2xl p-5">
                  <div className="mt-label">Saved meeting agenda</div>
                  <h3 className="mt-3 font-display text-2xl font-bold">{meeting.client}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{meeting.text}</p>
                  <div className="mt-4 text-xs text-slate-500">Saved {new Date(meeting.updatedAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyPanel
          title="No meetings yet"
          description="Run `Prepare Monthly Touch` to save agenda items here, or run `Post Meeting` to save the recap, sentiment, and action items."
        />
      );
    }

    if (screen === "recommendations") {
      return combinedRecommendations.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {combinedRecommendations.map((recommendation) => (
            <div key={`${recommendation.client}-${recommendation.text}`} className="mt-card rounded-2xl p-5">
              <div className="mt-label">Strategic recommendation</div>
              <h3 className="mt-3 font-display text-2xl font-bold">{recommendation.client}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                {recommendation.text}
              </p>
              <div className="mt-4 text-xs text-slate-500">Saved {new Date(recommendation.updatedAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel title="No recommendations yet" description="Run the MTOS AI workspace on a client to save strategic recommendations here." />
      );
    }

    return (
      <EmptyPanel
        title="Screen ready for live data"
        description="This surface is scaffolded in the production app and will be enriched as the remaining integrations go live."
      />
    );
  }

  if (!user) {
    return (
      <main className="app-shell flex min-h-screen items-center justify-center px-6 py-10">
        <div className="glass-panel w-full max-w-md rounded-[28px] p-8 shadow-modal">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl teal-gradient text-xl font-bold text-[#06231f]">
            MT
          </div>
          <div className="mt-6 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Map Ranking</div>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">
              {authMode === "signin" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {authMode === "signin"
                ? "Sign in to Monthly Touch OS."
                : "Start running world-class Monthly Touch meetings with live client sync."}
            </p>
          </div>
          <form className="mt-8 space-y-4" onSubmit={handleAuthSubmit}>
            {authMode === "signup" ? (
              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-300">Name</div>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
                  value={authName}
                  onChange={(event) => setAuthName(event.target.value)}
                  placeholder="Francisco"
                />
              </label>
            ) : null}
            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-300">Email</div>
              <input
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="francisco@mapranking.com"
              />
            </label>
            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-300">Password</div>
              <input
                type="password"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400/50"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="••••••••"
              />
            </label>
            {authError ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200">{authError}</div>
            ) : null}
            <button
              type="submit"
              disabled={authLoading}
              className="purple-gradient w-full rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-70"
            >
              {authLoading ? "Working..." : authMode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
          <div className="mt-6 text-center text-sm text-slate-400">
            {authMode === "signin" ? "Need an account?" : "Already have an account?"}{" "}
            <button
              className="font-semibold text-teal-300"
              onClick={() => {
                setAuthMode(authMode === "signin" ? "signup" : "signin");
                setAuthError(null);
              }}
            >
              {authMode === "signin" ? "Create one" : "Sign in"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell min-h-screen">
      <div className="flex min-h-screen">
        <aside className="hidden w-[280px] border-r border-white/8 bg-[#0d1320]/95 px-5 py-6 lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl teal-gradient font-display text-lg font-bold text-[#06231f]">
              MT
            </div>
            <div>
              <div className="font-display text-lg font-bold">Monthly Touch OS</div>
              <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Powered by Map Ranking</div>
            </div>
          </div>

          <nav className="mt-8 space-y-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                onClick={() => setScreen(item.key)}
                className={clsx(
                  "flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm transition",
                  screen === item.key ? "bg-teal-400/10 text-slate-50" : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-100",
                )}
              >
                <span>{item.label}</span>
                {item.key === "integrations" ? (
                  <span className="rounded-full bg-white/5 px-2 py-1 text-[11px]">{connectedCount}</span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="mt-8 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="text-sm font-semibold">{user.name}</div>
            <div className="mt-1 text-xs text-slate-500">{user.email}</div>
            <div className="mt-3 rounded-full bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.08em] text-slate-300">
              {user.role}
            </div>
          </div>

          <button
            title="Sign out"
            onClick={handleLogout}
            className="mt-6 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300"
          >
            Sign out
          </button>
        </aside>

        <section className="min-w-0 flex-1 px-5 py-6 lg:px-8">
          <div className="mx-auto max-w-[1380px]">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Manager workspace</div>
                <div className="mt-2 font-display text-3xl font-bold tracking-tight">
                  {screen.charAt(0).toUpperCase() + screen.slice(1)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                  Signed in as {user.name}
                </div>
                <button className="teal-gradient rounded-2xl px-4 py-3 text-sm font-semibold text-[#06231f]" onClick={openClickUpAuthorize}>
                  {integrations.find((item) => item.slug === "clickup")?.status === "connected" ? "Sync ClickUp" : "Connect ClickUp"}
                </button>
              </div>
            </div>

            {bannerError ? (
              <div className="mb-6 flex items-start justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] px-5 py-4 text-sm text-rose-100">
                <span>{bannerError}</span>
                <button className="text-rose-200" onClick={() => setBannerError(null)}>
                  Close
                </button>
              </div>
            ) : null}

            {renderMain()}
          </div>
        </section>
      </div>

      {clickup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-[520px] overflow-hidden rounded-[22px] border border-white/10 bg-[#0d1320] shadow-modal">
            <div className="flex items-center gap-4 border-b border-white/8 px-6 py-5">
              <div className="clickup-gradient flex h-11 w-11 items-center justify-center rounded-xl font-bold text-white">CU</div>
              <div className="flex-1">
                <div className="font-display text-xl font-bold">
                  {clickup.step === "authorize" && "Connect ClickUp"}
                  {clickup.step === "connecting" && "Connecting to ClickUp..."}
                  {clickup.step === "sync" && "Sync your accounts"}
                  {clickup.step === "syncing" && "Syncing clients"}
                  {clickup.step === "done" && "All set"}
                </div>
                <div className="text-sm text-slate-400">
                  {clickup.step === "sync"
                    ? `Only the clients assigned to ${user.name}`
                    : "Monthly Touch OS ClickUp wizard"}
                </div>
              </div>
              <button className="rounded-lg border border-white/10 p-2 text-slate-400" onClick={() => setClickup(null)}>
                ✕
              </button>
            </div>

            {clickup.step === "authorize" ? (
              <div className="space-y-5 px-6 py-6">
                <div className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.07] px-4 py-4 text-sm text-slate-200">
                  <b>Monthly Touch OS</b> wants to access your ClickUp workspace.
                </div>
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-slate-300">ClickUp account</div>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none"
                    value={clickup.email}
                    onChange={(event) => setClickup({ ...clickup, email: event.target.value })}
                  />
                </label>
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 text-sm leading-6 text-slate-300">
                  You will choose or confirm the workspace inside the real ClickUp OAuth flow. The app will store the live team name returned by ClickUp after authorization.
                </div>
                <div>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Permissions requested</div>
                  <div className="space-y-2 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                    {CLICKUP_SCOPES.map((scope) => (
                      <div key={scope} className="flex items-center gap-3 text-sm text-slate-200">
                        <span className="text-emerald-300">✓</span>
                        <span>{scope}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {clickup.error ? (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-100">
                    {clickup.error}
                  </div>
                ) : null}
                <div className="flex gap-3">
                  <button className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300" onClick={() => setClickup(null)}>
                    Cancel
                  </button>
                  <button className="clickup-gradient flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-white" onClick={startClickUpOAuth}>
                    Authorize ClickUp
                  </button>
                </div>
              </div>
            ) : null}

            {clickup.step === "connecting" ? (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <div className="h-12 w-12 animate-mtspin rounded-full border-4 border-violet-400/20 border-t-violet-300" />
                <div className="mt-6 font-display text-xl font-bold">Connecting to ClickUp...</div>
                <div className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
                  Redirecting to the real OAuth consent screen and securing the token server-side.
                </div>
              </div>
            ) : null}

            {clickup.step === "sync" ? (
              <div className="px-6 py-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-slate-300">
                    Connected as <b>{clickup.email}</b>
                  </div>
                {clickup.workspaceName ? (
                  <div className="rounded-full bg-violet-400/10 px-3 py-1 text-xs text-violet-200">{clickup.workspaceName}</div>
                ) : null}
                </div>
                <div className="mt-4 rounded-2xl border border-teal-400/20 bg-teal-400/[0.07] px-4 py-4 text-sm leading-6 text-slate-200">
                  Filtered to active Client Health Tracker rows where <b>{user.name}</b> is the Account Manager.
                </div>

                {clickup.error ? (
                  <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-100">
                    {clickup.error}
                  </div>
                ) : null}

                {clickup.rows.length ? (
                  <>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-sm text-slate-400">
                        <b className="text-teal-300">
                          {clickup.rows.filter((row) => clickup.picks[row.id]).length}
                        </b>{" "}
                        of {clickup.rows.length} accounts selected
                      </div>
                      <div className="flex gap-2">
                        <button className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300" onClick={() => setAllPicks(true)}>
                          Select all
                        </button>
                        <button className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300" onClick={() => setAllPicks(false)}>
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="scroll-thin mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-1">
                      {clickup.rows.map((row) => {
                        const selected = !!clickup.picks[row.id];
                        return (
                          <button
                            key={row.id}
                            onClick={() => togglePick(row.id)}
                            className="flex w-full items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-left"
                          >
                            <div
                              className={clsx(
                                "flex h-5 w-5 items-center justify-center rounded-md border",
                                selected ? "border-teal-300 bg-teal-300 text-[#06231f]" : "border-white/20",
                              )}
                            >
                              {selected ? "✓" : ""}
                            </div>
                            <div
                              className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white"
                              style={{ background: `linear-gradient(140deg, ${row.avatar[0]}, ${row.avatar[1]})` }}
                            >
                              {row.initials}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold">{row.name}</div>
                              <div className="truncate text-xs text-slate-500">
                                {row.industry} · {row.location}
                              </div>
                            </div>
                            <div className="rounded-lg bg-violet-400/10 px-3 py-1 text-xs text-violet-200">Tracker row</div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-5 flex gap-3">
                      <button className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300" onClick={() => setClickup(null)}>
                        Cancel
                      </button>
                      <button className="teal-gradient flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-[#06231f]" onClick={startClickUpSync}>
                        Sync {clickup.rows.filter((row) => clickup.picks[row.id]).length} accounts
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/25 bg-violet-400/[0.08] text-violet-200">
                      +
                    </div>
                    <div className="mt-5 font-display text-2xl font-bold">No accounts assigned to {user.name} yet</div>
                    <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">
                      The connection is live, but the Client Health Tracker did not return any <b>active</b> rows where{" "}
                      <b>{user.name}</b> is the Account Manager. The app does not fall back to demo data.
                    </p>
                    <button className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-slate-300" onClick={() => setClickup(null)}>
                      Close
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {clickup.step === "syncing" ? (
              <div className="px-6 py-12">
                <div className="flex items-center justify-between">
                  <div className="font-display text-xl font-bold">Syncing clients from ClickUp...</div>
                  <div className="font-mono text-sm text-slate-400">
                    {clickup.syncIndex} / {clickup.count}
                  </div>
                </div>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full transition-all duration-300 purple-gradient"
                    style={{
                      width: `${clickup.count ? Math.round((clickup.syncIndex / clickup.count) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="mt-5 text-sm text-slate-300">
                  Importing {clickup.rows[Math.max(clickup.syncIndex - 1, 0)]?.name || "selected accounts"} · tasks, KPIs and activity
                </div>
              </div>
            ) : null}

            {clickup.step === "done" ? (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/15 text-2xl text-emerald-300">
                  ✓
                </div>
                <div className="mt-5 font-display text-2xl font-bold">{clickup.count} clients synced</div>
                <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
                  Your roster is now populated from the Client Health Tracker rows assigned to you.
                </p>
                <button
                  className="teal-gradient mt-6 w-full rounded-2xl px-4 py-3 text-sm font-semibold text-[#06231f]"
                  onClick={() => {
                    setClickup(null);
                    setScreen("clients");
                  }}
                >
                  Go to clients
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {manualConnect ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-[560px] overflow-hidden rounded-[22px] border border-white/10 bg-[#0d1320] shadow-modal">
            <div className="flex items-center gap-4 border-b border-white/8 px-6 py-5">
              <div className="teal-gradient flex h-11 w-11 items-center justify-center rounded-xl font-bold text-[#06231f]">
                {manualConnect.target === "ghl" ? "GHL" : manualConnect.target === "ahrefs" ? "AH" : "M"}
              </div>
              <div className="flex-1">
                <div className="font-display text-xl font-bold">{manualConnect.title}</div>
                <div className="text-sm text-slate-400">{manualConnect.subtitle}</div>
              </div>
              <button
                className="rounded-lg border border-white/10 p-2 text-slate-400"
                onClick={() => setManualConnect(null)}
              >
                ✕
              </button>
            </div>

            <form className="space-y-5 px-6 py-6" onSubmit={submitManualConnect}>
              <div className="rounded-2xl border border-teal-400/20 bg-teal-400/[0.07] px-4 py-4 text-sm text-slate-200">
                Tokens are encrypted server-side and stored in the shared integration vault for this workspace.
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-slate-300">Account label</div>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none"
                    value={manualConnect.accountEmail}
                    onChange={(event) =>
                      setManualConnect({
                        ...manualConnect,
                        accountEmail: event.target.value,
                      })
                    }
                    placeholder="agency@mapranking.com"
                  />
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-slate-300">Workspace / account name</div>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none"
                    value={manualConnect.workspaceName}
                    onChange={(event) =>
                      setManualConnect({
                        ...manualConnect,
                        workspaceName: event.target.value,
                      })
                    }
                    placeholder="Agency token"
                  />
                </label>
              </div>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-300">Access token</div>
                <textarea
                  className="min-h-28 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none"
                  value={manualConnect.accessToken}
                  onChange={(event) =>
                    setManualConnect({
                      ...manualConnect,
                      accessToken: event.target.value,
                    })
                  }
                  placeholder="Paste the provider access token here"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="block md:col-span-2">
                  <div className="mb-2 text-sm font-medium text-slate-300">Refresh token (optional)</div>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none"
                    value={manualConnect.refreshToken}
                    onChange={(event) =>
                      setManualConnect({
                        ...manualConnect,
                        refreshToken: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-slate-300">Expires in seconds</div>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none"
                    value={manualConnect.expiresIn}
                    onChange={(event) =>
                      setManualConnect({
                        ...manualConnect,
                        expiresIn: event.target.value,
                      })
                    }
                    inputMode="numeric"
                    placeholder="86400"
                  />
                </label>
              </div>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-300">Scopes (optional)</div>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none"
                  value={manualConnect.scope}
                  onChange={(event) =>
                    setManualConnect({
                      ...manualConnect,
                      scope: event.target.value,
                    })
                  }
                  placeholder="ads_read business_management"
                />
              </label>

              {manualConnect.error ? (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-100">
                  {manualConnect.error}
                </div>
              ) : null}

              <div className="flex gap-3">
                <button
                  type="button"
                  className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300"
                  onClick={() => setManualConnect(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={manualConnect.saving}
                  className="teal-gradient flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-[#06231f] disabled:opacity-70"
                >
                  {manualConnect.saving ? "Saving..." : "Save token"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-purple">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

export type AppRole = "ADMIN" | "MANAGER";

export type HealthColor = "success" | "warning" | "danger" | "neutral";

export type UiClient = {
  id: string;
  name: string;
  contactName?: string;
  industry: string;
  location: string;
  initials: string;
  avatar: [string, string];
  accountManager: string;
  health: number | null;
  trend: string;
  sentiment: string;
  tenure: string;
  mrr: string;
  nextTouch: string;
  openActions: number;
  riskNote: string;
  context: string;
  kpis: Array<{ label: string; value: string; delta: string; good: boolean }>;
  churn: Array<{ text: string; color: string }>;
  goals: string[];
  activity: Array<{ text: string; meta: string; dot: string }>;
  aiArtifacts?: UiAiArtifacts;
  mtosScores?: {
    health: number;
    risk: number;
    upsellReadiness: number;
    computedAt: string;
    deltas: {
      health: number | null;
      risk: number | null;
      upsellReadiness: number | null;
    };
    factors: {
      health: string[];
      risk: string[];
      upsell: string[];
    };
  };
};

export type UiAiWorkspaceSnapshot = {
  summary: string;
  wins: string[];
  issues: string[];
  recommendations: string[];
  meetingAgenda: string[];
};

export type UiAiPostMeeting = {
  summary: string;
  sentiment: {
    label: string;
    rationale: string;
  };
  actionItems: Array<{
    department: string;
    owner: string;
    dueDate: string;
    task: string;
    clickupSync?: {
      synced: boolean;
      taskId?: string;
      taskName?: string;
      status?: string;
      assignee?: string;
      dueDate?: string;
      lastSyncedAt?: string;
    };
  }>;
  ticketRecommendations: string[];
  followUps: string[];
};

export type UiAiArtifactText = {
  text: string;
  updatedAt: string;
};

export type UiAiArtifacts = {
  workspaceSnapshot?: UiAiWorkspaceSnapshot & {
    updatedAt: string;
  };
  executiveBrief?: UiAiArtifactText;
  clientSummary?: UiAiArtifactText;
  connectorDiagnosis?: UiAiArtifactText;
  postMeeting?: UiAiPostMeeting & {
    updatedAt: string;
  };
};

export type IntegrationCard = {
  slug: string;
  name: string;
  category: string;
  glyph: string;
  icon: [string, string];
  description: string;
  scope: "admin" | "user";
  sourceKey?: string;
};

export type IntegrationSpec = {
  auth: string;
  base: string;
  frequency: string;
  scopes: string[];
  endpoints: Array<{ method: string; path: string; description: string }>;
  feeds: string[];
  automation: string;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

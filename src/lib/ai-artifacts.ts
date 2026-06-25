import { AiArtifactType } from "@prisma/client";
import { z } from "zod";

import type { ExecutedAiResult } from "@/lib/ai-execution";
import { prisma } from "@/lib/prisma";
import type { UiAiArtifacts, UiAiPostMeeting, UiAiWorkspaceSnapshot, UiClient } from "@/lib/types";

export const aiArtifactTypeSchema = z.nativeEnum(AiArtifactType);

const workspaceSnapshotSchema = z.object({
  summary: z.string().min(1),
  wins: z.array(z.string().min(1)).default([]),
  issues: z.array(z.string().min(1)).default([]),
  recommendations: z.array(z.string().min(1)).default([]),
  meetingAgenda: z.array(z.string().min(1)).default([]),
});

const postMeetingSchema = z.object({
  summary: z.string().min(1),
  sentiment: z.object({
    label: z.string().min(1),
    rationale: z.string().min(1),
  }),
  actionItems: z
    .array(
      z.object({
        department: z.string().min(1),
        owner: z.string().min(1),
        dueDate: z.string().min(1),
        task: z.string().min(1),
      }),
    )
    .default([]),
  ticketRecommendations: z.array(z.string().min(1)).default([]),
  followUps: z.array(z.string().min(1)).default([]),
});

function normalizeActionValue(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildPostMeetingActionHash(actionItem: {
  department: string;
  owner: string;
  dueDate: string;
  task: string;
}) {
  return [
    normalizeActionValue(actionItem.department),
    normalizeActionValue(actionItem.owner),
    normalizeActionValue(actionItem.dueDate),
    normalizeActionValue(actionItem.task),
  ].join("::");
}

function stripCodeFence(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJsonObject(value: string) {
  const normalized = stripCodeFence(value);
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return normalized.slice(firstBrace, lastBrace + 1);
}

export function buildArtifactInstructions(type?: AiArtifactType | null) {
  switch (type) {
    case AiArtifactType.WORKSPACE_SNAPSHOT:
      return [
        "Return valid JSON only. Do not wrap it in markdown fences.",
        'Use exactly this shape: {"summary": string, "wins": string[], "issues": string[], "recommendations": string[], "meetingAgenda": string[]}.',
        "Keep each list concise, specific, and client-ready.",
      ];
    case AiArtifactType.EXECUTIVE_BRIEF:
      return [
        "Return a concise internal executive brief in plain text.",
        "Include health assessment, risks, opportunities, retention concerns, and next steps.",
      ];
    case AiArtifactType.CLIENT_SUMMARY:
      return [
        "Return a client-friendly summary in plain text.",
        "Keep it positive, simple, easy to understand, and free of jargon.",
      ];
    case AiArtifactType.CONNECTOR_DIAGNOSIS:
      return [
        "Return a connector diagnosis in plain text.",
        "Clearly separate available data, missing data, blockers, and recommended next steps.",
      ];
    case AiArtifactType.POST_MEETING:
      return [
        "Return valid JSON only. Do not wrap it in markdown fences.",
        'Use exactly this shape: {"summary": string, "sentiment": {"label": string, "rationale": string}, "actionItems": [{"department": string, "owner": string, "dueDate": string, "task": string}], "ticketRecommendations": string[], "followUps": string[]}.',
        "Make the action items specific, assignable, and aligned to the post-monthly-touch workflow.",
      ];
    default:
      return [];
  }
}

export function parseArtifactStructuredData(type: AiArtifactType | null | undefined, outputText: string) {
  const jsonCandidate = extractJsonObject(outputText);
  if (!jsonCandidate) return null;

  const parsed = JSON.parse(jsonCandidate) as unknown;

  if (type === AiArtifactType.WORKSPACE_SNAPSHOT) {
    return workspaceSnapshotSchema.parse(parsed);
  }

  if (type === AiArtifactType.POST_MEETING) {
    return postMeetingSchema.parse(parsed);
  }

  return null;
}

function toUiWorkspaceSnapshot(value: unknown, updatedAt: Date): (UiAiWorkspaceSnapshot & { updatedAt: string }) | undefined {
  const parsed = workspaceSnapshotSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return {
    ...parsed.data,
    updatedAt: updatedAt.toISOString(),
  };
}

function toUiPostMeeting(value: unknown, updatedAt: Date): (UiAiPostMeeting & { updatedAt: string }) | undefined {
  const parsed = postMeetingSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return {
    ...parsed.data,
    updatedAt: updatedAt.toISOString(),
  };
}

type ActionSyncView = {
  synced: boolean;
  taskId?: string;
  taskName?: string;
  status?: string;
  assignee?: string;
  dueDate?: string;
  lastSyncedAt?: string;
};

function getActionState(sync?: ActionSyncView) {
  if (!sync?.synced) return "unsynced" as const;

  const normalized = (sync.status || "").toLowerCase().trim();
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
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

function prependActivityIfMissing(client: UiClient, entry: UiClient["activity"][number]) {
  const exists = client.activity.some((item) => item.text === entry.text && item.meta === entry.meta);
  if (!exists) {
    client.activity.unshift(entry);
  }
}

function appendChurnIfMissing(client: UiClient, text: string, color: string) {
  const exists = client.churn.some((item) => item.text === text);
  if (!exists) {
    client.churn.push({ text, color });
  }
}

function applyPostMeetingActionSignals(client: UiClient) {
  const postMeeting = client.aiArtifacts?.postMeeting;
  if (!postMeeting?.actionItems.length) {
    return client;
  }

  const actionDetails = postMeeting.actionItems.map((item) => {
    const state = getActionState(item.clickupSync);
    const dueDate = item.clickupSync?.dueDate || item.dueDate;
    return {
      ...item,
      state,
      overdue: state !== "completed" && state !== "missing" && isOverdue(dueDate),
    };
  });

  const openCount = actionDetails.filter((item) => item.state === "open").length;
  const completedCount = actionDetails.filter((item) => item.state === "completed").length;
  const missingCount = actionDetails.filter((item) => item.state === "missing").length;
  const unsyncedCount = actionDetails.filter((item) => item.state === "unsynced").length;
  const overdueCount = actionDetails.filter((item) => item.overdue).length;

  const healthBase = client.health ?? 72;
  const healthDelta = completedCount * 2 - openCount * 2 - overdueCount * 4 - missingCount * 8 - unsyncedCount;
  client.health = Math.max(0, Math.min(100, healthBase + healthDelta));
  client.openActions = Math.max(client.openActions || 0, openCount + missingCount + unsyncedCount);

  if (missingCount > 0 || overdueCount >= 2) {
    client.sentiment = "at-risk";
  } else if (completedCount > 0 && openCount === 0 && missingCount === 0 && client.sentiment !== "at-risk") {
    client.sentiment = "positive";
  }

  const riskFragments = [
    missingCount ? `${missingCount} missing in ClickUp` : null,
    overdueCount ? `${overdueCount} overdue` : null,
    unsyncedCount ? `${unsyncedCount} not yet pushed` : null,
    completedCount ? `${completedCount} completed` : null,
  ].filter(Boolean);

  if (riskFragments.length) {
    client.riskNote = `Post-meeting actions: ${riskFragments.join(", ")}.`;
  }

  client.context = [
    client.context,
    riskFragments.length ? `Action workflow status: ${riskFragments.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (missingCount > 0) {
    appendChurnIfMissing(client, `${missingCount} post-meeting action item(s) are missing in ClickUp.`, "#f5544f");
  }
  if (overdueCount > 0) {
    appendChurnIfMissing(client, `${overdueCount} post-meeting action item(s) are overdue.`, "#f5a524");
  }
  if (unsyncedCount > 0) {
    appendChurnIfMissing(client, `${unsyncedCount} post-meeting action item(s) still need to be pushed to ClickUp.`, "#4a9eff");
  }

  if (completedCount > 0) {
    prependActivityIfMissing(client, {
      text: `ClickUp workflow: ${completedCount} post-meeting action item(s) completed`,
      meta: `${openCount} open · ${missingCount} missing · ${overdueCount} overdue`,
      dot: "#34d399",
    });
  }

  if (missingCount > 0 || overdueCount > 0 || unsyncedCount > 0) {
    prependActivityIfMissing(client, {
      text: `ClickUp workflow attention needed for ${client.name}`,
      meta: `${missingCount} missing · ${overdueCount} overdue · ${unsyncedCount} unsynced`,
      dot: missingCount > 0 ? "#f5544f" : "#f5a524",
    });
  }

  return client;
}

export async function persistAiArtifact(args: {
  userId: string;
  clientId: string;
  type: AiArtifactType;
  title: string;
  taskType: string;
  routerModel: string;
  phase: string;
  promptTask: string;
  execution: ExecutedAiResult;
}) {
  const structuredData = parseArtifactStructuredData(args.type, args.execution.outputText);
  const dataPayload = structuredData ?? undefined;

  return prisma.aiArtifact.upsert({
    where: {
      userId_clientId_type: {
        userId: args.userId,
        clientId: args.clientId,
        type: args.type,
      },
    },
    update: {
      title: args.title,
      taskType: args.taskType,
      routerModel: args.routerModel,
      phase: args.phase,
      provider: args.execution.provider,
      model: args.execution.model,
      promptTask: args.promptTask,
      outputText: args.execution.outputText,
      structuredData: dataPayload,
      metadata: {
        usage: args.execution.usage,
        stopReason: args.execution.stopReason,
      },
    },
    create: {
      userId: args.userId,
      clientId: args.clientId,
      type: args.type,
      title: args.title,
      taskType: args.taskType,
      routerModel: args.routerModel,
      phase: args.phase,
      provider: args.execution.provider,
      model: args.execution.model,
      promptTask: args.promptTask,
      outputText: args.execution.outputText,
      structuredData: dataPayload,
      metadata: {
        usage: args.execution.usage,
        stopReason: args.execution.stopReason,
      },
    },
  });
}

export function mergeAiArtifactsIntoClients(args: {
  clients: UiClient[];
  artifacts: Array<{
    clientId: string;
    type: AiArtifactType;
    outputText: string;
    structuredData: unknown;
    updatedAt: Date;
  }>;
  postMeetingSyncs?: Array<{
    clientId: string;
    actionHash: string;
    clickupTaskId: string;
    clickupTaskName: string;
    clickupStatus: string | null;
    clickupAssignee: string | null;
    clickupDueDate: string | null;
    lastSyncedAt: Date;
  }>;
}) {
  const artifactsByClientId = new Map<string, UiAiArtifacts>();
  const syncByClientId = new Map<string, Map<string, {
    clickupTaskId: string;
    clickupTaskName: string;
    clickupStatus: string | null;
    clickupAssignee: string | null;
    clickupDueDate: string | null;
    lastSyncedAt: Date;
  }>>();

  for (const sync of args.postMeetingSyncs || []) {
    const current = syncByClientId.get(sync.clientId) || new Map();
    current.set(sync.actionHash, {
      clickupTaskId: sync.clickupTaskId,
      clickupTaskName: sync.clickupTaskName,
      clickupStatus: sync.clickupStatus,
      clickupAssignee: sync.clickupAssignee,
      clickupDueDate: sync.clickupDueDate,
      lastSyncedAt: sync.lastSyncedAt,
    });
    syncByClientId.set(sync.clientId, current);
  }

  for (const artifact of args.artifacts) {
    const current = artifactsByClientId.get(artifact.clientId) || {};

    if (artifact.type === AiArtifactType.WORKSPACE_SNAPSHOT) {
      current.workspaceSnapshot = toUiWorkspaceSnapshot(artifact.structuredData, artifact.updatedAt);
    }

    if (artifact.type === AiArtifactType.EXECUTIVE_BRIEF) {
      current.executiveBrief = {
        text: artifact.outputText,
        updatedAt: artifact.updatedAt.toISOString(),
      };
    }

    if (artifact.type === AiArtifactType.CLIENT_SUMMARY) {
      current.clientSummary = {
        text: artifact.outputText,
        updatedAt: artifact.updatedAt.toISOString(),
      };
    }

    if (artifact.type === AiArtifactType.CONNECTOR_DIAGNOSIS) {
      current.connectorDiagnosis = {
        text: artifact.outputText,
        updatedAt: artifact.updatedAt.toISOString(),
      };
    }

    if (artifact.type === AiArtifactType.POST_MEETING) {
      const postMeeting = toUiPostMeeting(artifact.structuredData, artifact.updatedAt);
      if (postMeeting) {
        const syncMap = syncByClientId.get(artifact.clientId) || new Map();
        current.postMeeting = {
          ...postMeeting,
          actionItems: postMeeting.actionItems.map((item) => {
            const sync = syncMap.get(buildPostMeetingActionHash(item));
            return {
              ...item,
              clickupSync: sync
                ? {
                    synced: true,
                    taskId: sync.clickupTaskId,
                    taskName: sync.clickupTaskName,
                    status: sync.clickupStatus || undefined,
                    assignee: sync.clickupAssignee || undefined,
                    dueDate: sync.clickupDueDate || undefined,
                    lastSyncedAt: sync.lastSyncedAt.toISOString(),
                  }
                : {
                    synced: false,
                  },
            };
          }),
        };
      }
    }

    artifactsByClientId.set(artifact.clientId, current);
  }

  return args.clients.map((client) =>
    applyPostMeetingActionSignals({
      ...client,
      aiArtifacts: artifactsByClientId.get(client.id),
    }),
  );
}

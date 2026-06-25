import { AiArtifactType, OAuthToken, Prisma } from "@prisma/client";
import { z } from "zod";

import { buildPostMeetingActionHash } from "@/lib/ai-artifacts";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import type { UiClient } from "@/lib/types";

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";
const CLICKUP_AUTH_BASE = "https://app.clickup.com/api";

type ClickUpTask = {
  id: string;
  name: string;
  description?: string;
  due_date?: string;
  status?: {
    status?: string;
  };
  assignees?: Array<{
    username?: string;
    email?: string;
  }>;
  custom_fields?: Array<{
    id: string;
    name: string;
    type: string;
    value?: unknown;
    type_config?: {
      options?: Array<{ id?: string; name?: string; orderindex?: number }>;
    };
  }>;
};

type ClickUpTaskPage = {
  tasks: ClickUpTask[];
  last_page?: boolean;
};

type ClickUpCreateTaskResponse = {
  id: string;
  name: string;
  due_date?: string;
  status?: {
    status?: string;
  };
  assignees?: Array<{
    username?: string;
    email?: string;
  }>;
};

const postMeetingActionItemSchema = z.object({
  department: z.string().min(1),
  owner: z.string().min(1),
  dueDate: z.string().min(1),
  task: z.string().min(1),
});

const postMeetingArtifactSchema = z.object({
  summary: z.string().min(1),
  sentiment: z.object({
    label: z.string().min(1),
    rationale: z.string().min(1),
  }),
  actionItems: z.array(postMeetingActionItemSchema).default([]),
  ticketRecommendations: z.array(z.string().min(1)).default([]),
  followUps: z.array(z.string().min(1)).default([]),
});

type ClickUpTeamResponse = {
  teams?: Array<{
    id: string;
    name: string;
  }>;
};

function sanitizeFieldName(value: string | null | undefined) {
  return (value || "")
    .normalize("NFKD")
    .replace(/[^\w\s%-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalize(value: string | null | undefined) {
  return (value || "").toLowerCase().trim();
}

function getCustomField(task: ClickUpTask, names: string[]) {
  const normalizedNames = names.map((name) => sanitizeFieldName(name));
  const field = (task.custom_fields || []).find((entry) =>
    names.some((name) => {
      const rawName = normalize(entry.name);
      const rawNeedle = normalize(name);
      return rawName === rawNeedle || rawName.includes(rawNeedle);
    }) ||
    normalizedNames.some((name) => {
      const entryName = sanitizeFieldName(entry.name);
      return entryName === name || entryName.endsWith(name) || entryName.includes(name);
    }),
  );
  if (!field) return null;

  if (field.type === "drop_down") {
    const rawValue = field.value;
    const options = field.type_config?.options || [];
    if (typeof rawValue === "number") {
      return options.find((option) => Number(option.orderindex) === rawValue)?.name || String(rawValue);
    }
    if (typeof rawValue === "string") {
      return options.find((option) => option.id === rawValue)?.name || rawValue;
    }
  }

  if (Array.isArray(field.value)) {
    return field.value.join(", ");
  }

  if (field.value == null) return null;
  return String(field.value);
}

function getField(task: ClickUpTask, primary: string, aliases: string[] = []) {
  return getCustomField(task, [primary, ...aliases]);
}

function deriveInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}

function derivePalette(seed: string): [string, string] {
  const palette: Array<[string, string]> = [
    ["#0d9488", "#5eead4"],
    ["#3b82f6", "#60a5fa"],
    ["#7c3aed", "#a78bfa"],
    ["#f59e36", "#fcd34d"],
    ["#10b981", "#6ee7b7"],
    ["#ef4444", "#fca5a5"],
  ];
  const index = seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
  return palette[index];
}

function parseList(value: string | null) {
  return value
    ? value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function parseNumber(value: string | null) {
  if (!value) return null;
  const cleaned = value.replace(/[^\d-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function inferHealth(sentiment: string) {
  if (normalize(sentiment) === "positive") return 84;
  if (normalize(sentiment) === "at-risk") return 52;
  if (normalize(sentiment) === "neutral") return 68;
  return null;
}

function getTrackerStatus(task: ClickUpTask) {
  return getField(task, "Status", ["Client Status", "Account Status"]) || task.status?.status || "";
}

function isActiveTrackerTask(task: ClickUpTask) {
  return normalize(getTrackerStatus(task)) === "active";
}

function serializeTaskToClient(task: ClickUpTask): UiClient {
  const name = task.name;
  const contactName =
    getField(task, "Client Contact", [
      "Client Name",
      "Primary Contact",
      "Contact Name",
      "Main Contact",
      "Decision Maker",
      "POC",
      "Customer Name",
      "Full Name",
    ]) || undefined;
  const industry = getField(task, "Industry", ["Vertical"]) || "—";
  const location = getField(task, "Location", ["City", "Market"]) || "—";
  const accountManager = getField(task, "Account Manager") || "";
  const sentiment = getField(task, "Sentiment", ["Health Sentiment"]) || "neutral";
  const health = parseNumber(getField(task, "Health Score", ["Health"])) ?? inferHealth(sentiment);
  const avatar = derivePalette(name);
  const riskNote = getField(task, "Risk Note", ["Risk", "Risk Summary"]) || "ClickUp row synced. Waiting on downstream KPI sources.";
  const context = task.description || getField(task, "Context", ["Notes"]) || "";

  return {
    id: task.id,
    name,
    contactName,
    industry,
    location,
    initials: getField(task, "Initials") || deriveInitials(name),
    avatar,
    accountManager,
    health,
    trend: getField(task, "Trend") || "—",
    sentiment,
    tenure: getField(task, "Tenure") || "—",
    mrr: getField(task, "MRR") || "—",
    nextTouch: getField(task, "Next Touch", ["Next Meeting"]) || "Not scheduled",
    openActions: parseNumber(getField(task, "Open Actions", ["Action Count"])) ?? 0,
    riskNote,
    context,
    kpis: [],
    churn: parseList(getField(task, "Churn Signals", ["Churn"])).map((text) => ({ text, color: "#f5a524" })),
    goals: parseList(getField(task, "Goals", ["Client Goals"])),
    activity: [],
  };
}

export function buildClickUpAuthorizeUrl({
  state,
}: {
  state: string;
}) {
  const clientId = process.env.CLICKUP_CLIENT_ID;
  const redirectUri = process.env.CLICKUP_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error("Missing CLICKUP_CLIENT_ID or CLICKUP_REDIRECT_URI.");
  }

  const url = new URL(CLICKUP_AUTH_BASE);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeClickUpCode(code: string) {
  const clientId = process.env.CLICKUP_CLIENT_ID;
  const clientSecret = process.env.CLICKUP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing CLICKUP_CLIENT_ID or CLICKUP_CLIENT_SECRET.");
  }

  const response = await fetch(`${CLICKUP_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ClickUp token exchange failed: ${body}`);
  }

  return response.json() as Promise<{
    access_token: string;
    token_type?: string;
  }>;
}

async function clickUpRequestWithAccessToken<T>(
  accessToken: string,
  path: string,
  init?: {
    method?: string;
    body?: Prisma.InputJsonValue;
  },
) {
  const response = await fetch(`${CLICKUP_API_BASE}${path}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: accessToken,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ClickUp API failed: ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function getClickUpTeams(accessToken: string) {
  const result = await clickUpRequestWithAccessToken<ClickUpTeamResponse>(accessToken, "/team");
  return result.teams || [];
}

export async function upsertClickUpToken(args: {
  userId: string;
  accountEmail: string;
  workspaceId?: string;
  workspaceName?: string;
  accessToken: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.oAuthToken.upsert({
    where: {
      userId_provider: {
        userId: args.userId,
        provider: "clickup",
      },
    },
    update: {
      accountEmail: args.accountEmail,
      workspaceId: args.workspaceId,
      workspaceName: args.workspaceName,
      accessToken: encryptSecret(args.accessToken),
      metadata: args.metadata,
    },
    create: {
      provider: "clickup",
      userId: args.userId,
      accountEmail: args.accountEmail,
      workspaceId: args.workspaceId,
      workspaceName: args.workspaceName,
      accessToken: encryptSecret(args.accessToken),
      metadata: args.metadata,
    },
  });
}

async function clickUpFetch<T>(token: OAuthToken, path: string) {
  const accessToken = decryptSecret(token.accessToken);
  return clickUpRequestWithAccessToken<T>(accessToken, path);
}

async function clickUpMutation<T>(token: OAuthToken, path: string, body: Prisma.InputJsonValue) {
  const accessToken = decryptSecret(token.accessToken);
  return clickUpRequestWithAccessToken<T>(accessToken, path, {
    method: "POST",
    body,
  });
}

async function clickUpUpdate<T>(token: OAuthToken, path: string, body: Prisma.InputJsonValue) {
  const accessToken = decryptSecret(token.accessToken);
  return clickUpRequestWithAccessToken<T>(accessToken, path, {
    method: "PUT",
    body,
  });
}

export async function getAssignedTrackerRows(userId: string, managerName: string) {
  const listId = process.env.CLICKUP_HEALTH_TRACKER_LIST_ID;
  if (!listId) {
    throw new Error("Missing CLICKUP_HEALTH_TRACKER_LIST_ID.");
  }

  const token = await prisma.oAuthToken.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "clickup",
      },
    },
  });

  if (!token) {
    throw new Error("ClickUp is not connected for this user.");
  }

  const tasks: ClickUpTask[] = [];
  let page = 0;
  let keepGoing = true;

  while (keepGoing) {
    const result = await clickUpFetch<ClickUpTaskPage>(token, `/list/${listId}/task?page=${page}&subtasks=true`);
    tasks.push(...result.tasks);
    keepGoing = !result.last_page;
    page += 1;
  }

  return tasks
    .filter((task) => normalize(getField(task, "Account Manager")) === normalize(managerName))
    .filter((task) => isActiveTrackerTask(task))
    .map((task) => serializeTaskToClient(task));
}

export async function persistSyncedClients(args: {
  userId: string;
  selectedIds: string[];
  managerName: string;
}) {
  const clients = await getAssignedTrackerRows(args.userId, args.managerName);
  const allowedIds = new Set(clients.map((client) => client.id));
  const safeSelection = args.selectedIds.filter((id) => allowedIds.has(id));

  const run = await prisma.syncRun.create({
    data: {
      provider: "clickup",
      userId: args.userId,
      status: "RUNNING",
      total: safeSelection.length,
      selectedIds: safeSelection,
    },
  });

  await prisma.syncedClient.deleteMany({
    where: {
      userId: args.userId,
      clientId: { notIn: safeSelection },
    },
  });

  const selectedClients = clients.filter((client) => safeSelection.includes(client.id));

  for (const client of selectedClients) {
    await prisma.client.upsert({
      where: { id: client.id },
      update: {
        name: client.name,
        industry: client.industry,
        location: client.location,
        initials: client.initials,
        avatarStart: client.avatar[0],
        avatarEnd: client.avatar[1],
        accountManager: client.accountManager,
        health: client.health,
        trend: client.trend,
        sentiment: client.sentiment,
        tenure: client.tenure,
        mrr: client.mrr,
        nextTouch: client.nextTouch,
        openActions: client.openActions,
        riskNote: client.riskNote,
        context: client.context,
        clickupTaskId: client.id,
        rawPayload: client as Prisma.InputJsonValue,
        kpis: {
          deleteMany: {},
        },
        churnSignals: {
          deleteMany: {},
        },
        goals: {
          deleteMany: {},
        },
        activities: {
          deleteMany: {},
        },
      },
      create: {
        id: client.id,
        name: client.name,
        industry: client.industry,
        location: client.location,
        initials: client.initials,
        avatarStart: client.avatar[0],
        avatarEnd: client.avatar[1],
        accountManager: client.accountManager,
        health: client.health,
        trend: client.trend,
        sentiment: client.sentiment,
        tenure: client.tenure,
        mrr: client.mrr,
        nextTouch: client.nextTouch,
        openActions: client.openActions,
        riskNote: client.riskNote,
        context: client.context,
        clickupTaskId: client.id,
        rawPayload: client as Prisma.InputJsonValue,
      },
    });

    if (client.churn.length) {
      await prisma.clientChurnSignal.createMany({
        data: client.churn.map((signal) => ({
          clientId: client.id,
          text: signal.text,
          color: signal.color,
        })),
      });
    }

    if (client.goals.length) {
      await prisma.clientGoal.createMany({
        data: client.goals.map((text) => ({
          clientId: client.id,
          text,
        })),
      });
    }

    await prisma.syncedClient.upsert({
      where: {
        userId_clientId: {
          userId: args.userId,
          clientId: client.id,
        },
      },
      update: { syncedAt: new Date() },
      create: {
        userId: args.userId,
        clientId: client.id,
      },
    });

    await prisma.syncRun.update({
      where: { id: run.id },
      data: { completed: { increment: 1 } },
    });
  }

  await prisma.syncRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      completed: safeSelection.length,
    },
  });

  return {
    syncRunId: run.id,
    count: safeSelection.length,
  };
}

function toDueDateMilliseconds(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? String(parsed) : undefined;
}

function fromClickUpDueDateMilliseconds(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function getClickUpAssigneeLabel(task: ClickUpTask) {
  const primary = task.assignees?.[0];
  return primary?.username || primary?.email || null;
}

function buildPostMeetingTaskName(args: { clientName: string; department: string; task: string }) {
  const base = `[${args.clientName}] ${args.department}: ${args.task}`.replace(/\s+/g, " ").trim();
  return base.length > 255 ? `${base.slice(0, 252)}...` : base;
}

export async function pushPostMeetingActionItemsToClickUp(args: {
  userId: string;
  clientId: string;
}) {
  const listId = process.env.CLICKUP_POST_MEETING_LIST_ID;
  if (!listId) {
    throw new Error("Missing CLICKUP_POST_MEETING_LIST_ID.");
  }

  const [token, client, artifact, existingSyncs] = await Promise.all([
    prisma.oAuthToken.findUnique({
      where: {
        userId_provider: {
          userId: args.userId,
          provider: "clickup",
        },
      },
    }),
    prisma.client.findUnique({
      where: { id: args.clientId },
      select: {
        id: true,
        name: true,
        accountManager: true,
      },
    }),
    prisma.aiArtifact.findUnique({
      where: {
        userId_clientId_type: {
          userId: args.userId,
          clientId: args.clientId,
          type: AiArtifactType.POST_MEETING,
        },
      },
      select: {
        structuredData: true,
      },
    }),
    prisma.postMeetingActionSync.findMany({
      where: {
        userId: args.userId,
        clientId: args.clientId,
      },
    }),
  ]);

  if (!token) {
    throw new Error("ClickUp is not connected for this user.");
  }

  if (!client) {
    throw new Error("Client not found.");
  }

  if (!artifact?.structuredData) {
    throw new Error("No saved post-meeting artifact was found for this client.");
  }

  const postMeeting = postMeetingArtifactSchema.parse(artifact.structuredData);
  if (!postMeeting.actionItems.length) {
    throw new Error("The saved post-meeting artifact has no action items to sync.");
  }

  const existingTasks: ClickUpTask[] = [];
  let page = 0;
  let keepGoing = true;

  while (keepGoing) {
    const result = await clickUpFetch<ClickUpTaskPage>(token, `/list/${listId}/task?page=${page}&subtasks=true`);
    existingTasks.push(...result.tasks);
    keepGoing = !result.last_page;
    page += 1;
  }

  const existingTaskNames = new Set(existingTasks.map((task) => normalize(task.name)));
  const existingTasksById = new Map(existingTasks.map((task) => [task.id, task]));
  const syncsByActionHash = new Map(existingSyncs.map((sync) => [sync.actionHash, sync]));
  const createdTasks: Array<{ id: string; name: string }> = [];
  const updatedTasks: Array<{ id: string; name: string }> = [];
  const skippedTasks: Array<{ name: string; reason: string }> = [];

  for (const item of postMeeting.actionItems) {
    const actionHash = buildPostMeetingActionHash(item);
    const taskName = buildPostMeetingTaskName({
      clientName: client.name,
      department: item.department,
      task: item.task,
    });
    const existingSync = syncsByActionHash.get(actionHash);

    const payload = {
      name: taskName,
      description: [
      `Client: ${client.name}`,
      `Department: ${item.department}`,
      `Owner: ${item.owner}`,
      `Due Date: ${item.dueDate}`,
      `Account Manager: ${client.accountManager}`,
      "",
      `Post-Meeting Summary: ${postMeeting.summary}`,
      "",
      `Client Sentiment: ${postMeeting.sentiment.label}`,
      postMeeting.sentiment.rationale,
    ]
      .filter(Boolean)
      .join("\n"),
      due_date: toDueDateMilliseconds(item.dueDate),
      notify_all: false,
    };

    if (existingSync?.clickupTaskId) {
      const updated = await clickUpUpdate<ClickUpCreateTaskResponse>(token, `/task/${existingSync.clickupTaskId}`, payload);
      await prisma.postMeetingActionSync.upsert({
        where: {
          userId_clientId_actionHash: {
            userId: args.userId,
            clientId: args.clientId,
            actionHash,
          },
        },
        update: {
          department: item.department,
          owner: item.owner,
          dueDate: item.dueDate,
          task: item.task,
          clickupTaskName: updated.name,
          clickupStatus: updated.status?.status || existingTasksById.get(updated.id)?.status?.status || null,
          clickupAssignee: getClickUpAssigneeLabel(updated) || existingSync.clickupAssignee || null,
          clickupDueDate: fromClickUpDueDateMilliseconds(updated.due_date) || existingSync.clickupDueDate || item.dueDate,
          lastSyncedAt: new Date(),
        },
        create: {
          userId: args.userId,
          clientId: args.clientId,
          actionHash,
          department: item.department,
          owner: item.owner,
          dueDate: item.dueDate,
          task: item.task,
          clickupTaskId: updated.id,
          clickupTaskName: updated.name,
          clickupStatus: updated.status?.status || null,
          clickupAssignee: getClickUpAssigneeLabel(updated),
          clickupDueDate: fromClickUpDueDateMilliseconds(updated.due_date) || item.dueDate,
          lastSyncedAt: new Date(),
        },
      });
      updatedTasks.push({
        id: updated.id,
        name: updated.name,
      });
      existingTaskNames.add(normalize(updated.name));
      continue;
    }

    const sameNameTask = existingTasks.find((task) => normalize(task.name) === normalize(taskName));
    if (sameNameTask) {
      await prisma.postMeetingActionSync.upsert({
        where: {
          userId_clientId_actionHash: {
            userId: args.userId,
            clientId: args.clientId,
            actionHash,
          },
        },
        update: {
          department: item.department,
          owner: item.owner,
          dueDate: item.dueDate,
          task: item.task,
          clickupTaskId: sameNameTask.id,
          clickupTaskName: sameNameTask.name,
          clickupStatus: sameNameTask.status?.status || null,
          clickupAssignee: getClickUpAssigneeLabel(sameNameTask),
          clickupDueDate: fromClickUpDueDateMilliseconds(sameNameTask.due_date) || item.dueDate,
          lastSyncedAt: new Date(),
        },
        create: {
          userId: args.userId,
          clientId: args.clientId,
          actionHash,
          department: item.department,
          owner: item.owner,
          dueDate: item.dueDate,
          task: item.task,
          clickupTaskId: sameNameTask.id,
          clickupTaskName: sameNameTask.name,
          clickupStatus: sameNameTask.status?.status || null,
          clickupAssignee: getClickUpAssigneeLabel(sameNameTask),
          clickupDueDate: fromClickUpDueDateMilliseconds(sameNameTask.due_date) || item.dueDate,
          lastSyncedAt: new Date(),
        },
      });
      skippedTasks.push({
        name: sameNameTask.name,
        reason: "Matched existing ClickUp task by title and linked it to this MTOS action item.",
      });
      continue;
    }

    const created = await clickUpMutation<ClickUpCreateTaskResponse>(token, `/list/${listId}/task`, payload);

    await prisma.postMeetingActionSync.upsert({
      where: {
        userId_clientId_actionHash: {
          userId: args.userId,
          clientId: args.clientId,
          actionHash,
        },
      },
      update: {
        department: item.department,
        owner: item.owner,
        dueDate: item.dueDate,
        task: item.task,
        clickupTaskId: created.id,
        clickupTaskName: created.name,
        clickupStatus: created.status?.status || null,
        clickupAssignee: getClickUpAssigneeLabel(created),
        clickupDueDate: fromClickUpDueDateMilliseconds(created.due_date) || item.dueDate,
        lastSyncedAt: new Date(),
      },
      create: {
        userId: args.userId,
        clientId: args.clientId,
        actionHash,
        department: item.department,
        owner: item.owner,
        dueDate: item.dueDate,
        task: item.task,
        clickupTaskId: created.id,
        clickupTaskName: created.name,
        clickupStatus: created.status?.status || null,
        clickupAssignee: getClickUpAssigneeLabel(created),
        clickupDueDate: fromClickUpDueDateMilliseconds(created.due_date) || item.dueDate,
        lastSyncedAt: new Date(),
      },
    });

    createdTasks.push({
      id: created.id,
      name: created.name,
    });
    existingTaskNames.add(normalize(created.name));
  }

  return {
    clientName: client.name,
    createdCount: createdTasks.length,
    updatedCount: updatedTasks.length,
    skippedCount: skippedTasks.length,
    createdTasks,
    updatedTasks,
    skippedTasks,
  };
}

export async function refreshPostMeetingActionSyncs(args: {
  userId: string;
  clientIds?: string[];
}) {
  const token = await prisma.oAuthToken.findUnique({
    where: {
      userId_provider: {
        userId: args.userId,
        provider: "clickup",
      },
    },
  });

  if (!token) {
    return { refreshedCount: 0 };
  }

  const syncs = await prisma.postMeetingActionSync.findMany({
    where: {
      userId: args.userId,
      ...(args.clientIds?.length
        ? {
            clientId: {
              in: args.clientIds,
            },
          }
        : {}),
    },
  });

  let refreshedCount = 0;

  for (const sync of syncs) {
    try {
      const task = await clickUpFetch<ClickUpTask>(token, `/task/${sync.clickupTaskId}`);
      await prisma.postMeetingActionSync.update({
        where: { id: sync.id },
        data: {
          clickupTaskName: task.name,
          clickupStatus: task.status?.status || null,
          clickupAssignee: getClickUpAssigneeLabel(task),
          clickupDueDate: fromClickUpDueDateMilliseconds(task.due_date) || sync.clickupDueDate || sync.dueDate,
          lastSyncedAt: new Date(),
        },
      });
      refreshedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("not found") || message.includes("Task not found") || message.includes("deleted")) {
        await prisma.postMeetingActionSync.update({
          where: { id: sync.id },
          data: {
            clickupStatus: "missing",
            lastSyncedAt: new Date(),
          },
        });
      }
    }
  }

  return { refreshedCount };
}

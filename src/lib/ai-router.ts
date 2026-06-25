import { AiArtifactType } from "@prisma/client";
import { z } from "zod";

import { aiArtifactTypeSchema, buildArtifactInstructions } from "@/lib/ai-artifacts";
import type { AuthedUser } from "@/lib/auth";
import { getMasterPrompt } from "@/lib/master-prompt";
import { ADMIN_SOURCES, INTEGRATIONS } from "@/lib/prototype-data";
import { prisma } from "@/lib/prisma";
import { serializeClient } from "@/lib/serializers";

export const AI_TASK_TYPES = [
  "data_collection",
  "context_collection",
  "analysis",
  "deliverable_generation",
  "post_meeting",
  "connector_diagnosis",
  "general_strategy",
] as const;

export const aiRouterRequestSchema = z.object({
  task: z.string().min(1, "Task is required."),
  taskType: z.enum(AI_TASK_TYPES).optional(),
  clientId: z.string().min(1).optional(),
  artifactType: aiArtifactTypeSchema.optional(),
  artifactTitle: z.string().min(1).optional(),
  includeMasterPrompt: z.boolean().optional().default(true),
  includeClientsSnapshot: z.boolean().optional().default(true),
  execute: z.boolean().optional().default(false),
  maxTokens: z.number().int().min(256).max(8192).optional(),
  temperature: z.number().min(0).max(1).optional(),
});

export type AiTaskType = (typeof AI_TASK_TYPES)[number];

type ModelTarget = "gemini" | "claude";

type ConnectedSystem = {
  key: string;
  name: string;
  status: "connected" | "not_connected";
  scope: "user" | "admin";
  accountEmail: string | null;
  workspaceName: string | null;
};

type RouterRequestSummary = {
  task: string;
  taskType: AiTaskType;
  clientId: string | null;
  artifactType: AiArtifactType | null;
  artifactTitle: string | null;
  execute: boolean;
  maxTokens: number | null;
  temperature: number | null;
};

type RouterDecision = {
  model: ModelTarget;
  phase: "collection" | "reasoning";
  taskType: AiTaskType;
  reason: string;
};

export type AiRouterPayload = {
  router: RouterDecision & {
    readyForExecution: boolean;
    reason: string;
  };
  promptPackage: {
    sourceFile: string;
    masterPrompt?: string;
    runtimeInstructions: string[];
    artifactInstructions: string[];
    userPrompt: string;
  };
  intelligencePackage: {
    generatedAt: string;
    user: {
      id: string;
      name: string;
      email: string;
      role: AuthedUser["role"];
    };
    request: RouterRequestSummary;
    coverage: {
      connectedSystems: ConnectedSystem[];
      connectedCount: number;
      disconnectedCount: number;
    };
    clients: {
      totalSynced: number;
      targetClient: ReturnType<typeof serializeClient> | null;
      roster?:
        | Array<{
            id: string;
            name: string;
            contactName: string | null;
            accountManager: string;
            health: number | null;
            industry: string;
            location: string;
            nextTouch: string;
            openActions: number;
          }>
        | undefined;
    };
  };
};

function normalizeText(value: string) {
  return value.toLowerCase().trim();
}

function detectTaskType(task: string): AiTaskType {
  const normalized = normalizeText(task);

  if (
    /(collect|gather|pull|fetch|retrieve|load|query|connector|integration|source of truth|intelligence package)/.test(
      normalized,
    )
  ) {
    return normalized.includes("context") ? "context_collection" : "data_collection";
  }

  if (/(diagnose|debug|broken|status|not working|connector issue|oauth|sync)/.test(normalized)) {
    return "connector_diagnosis";
  }

  if (/(agenda|brief|playbook|summary|report|deliverable|talking points|recommendation)/.test(normalized)) {
    return "deliverable_generation";
  }

  if (/(post meeting|follow up|sentiment|action items|ticket creation|due dates|owner)/.test(normalized)) {
    return "post_meeting";
  }

  if (/(analy|risk|opportunit|retention|health score|upsell|why did|what happened)/.test(normalized)) {
    return "analysis";
  }

  return "general_strategy";
}

function buildDecision(task: string, taskType?: AiTaskType): RouterDecision {
  const resolvedTaskType = taskType || detectTaskType(task);

  switch (resolvedTaskType) {
    case "data_collection":
    case "context_collection":
    case "connector_diagnosis":
      return {
        model: "gemini",
        phase: "collection",
        taskType: resolvedTaskType,
        reason: "This task is primarily about collecting, verifying, or diagnosing source-system data before analysis.",
      };
    case "analysis":
    case "deliverable_generation":
    case "post_meeting":
    case "general_strategy":
    default:
      return {
        model: "claude",
        phase: "reasoning",
        taskType: resolvedTaskType,
        reason: "This task is primarily about analysis, synthesis, decision-making, or deliverable generation.",
      };
  }
}

function buildRuntimeInstructions(decision: RouterDecision) {
  const common = [
    "Use the MTOS master prompt as the governing instruction set.",
    "Treat connected systems and supplied MTOS data as the primary source of truth.",
    "Never fabricate missing data. If data is unavailable, explicitly return DATA NOT AVAILABLE, explain why, and recommend the next step.",
    "Keep outputs aligned to client growth and relationship strength with Map Ranking.",
  ];

  if (decision.model === "gemini") {
    return [
      ...common,
      "Operate as the MTOS data collection and connector orchestration layer.",
      "Focus on retrieval, normalization, validation, confidence, and missing-data detection.",
      "Do not perform the final client strategy analysis unless the task explicitly requires diagnosis of a broken connector or sync flow.",
    ];
  }

  return [
    ...common,
    "Operate as the MTOS reasoning and deliverables layer.",
    "Assume the provided intelligence package is the current working context.",
    "Focus on wins, risks, opportunities, retention threats, next steps, and client-friendly narratives.",
  ];
}

function buildConnectedSystems(args: {
  userTokens: Array<{
    provider: string;
    accountEmail: string | null;
    workspaceName: string | null;
  }>;
  adminTokens: Array<{
    provider: string;
    accountEmail: string | null;
    workspaceName: string | null;
  }>;
}) {
  const userTokenMap = new Map(args.userTokens.map((token) => [token.provider, token]));
  const adminTokenMap = new Map(args.adminTokens.map((token) => [token.provider, token]));

  const userSystems: ConnectedSystem[] = INTEGRATIONS.filter((item) => item.scope === "user").map((item) => {
    const token = userTokenMap.get(item.slug);
    return {
      key: item.slug,
      name: item.name,
      status: token ? "connected" : "not_connected",
      scope: "user",
      accountEmail: token?.accountEmail || null,
      workspaceName: token?.workspaceName || null,
    };
  });

  const adminSystems: ConnectedSystem[] = Object.entries(ADMIN_SOURCES).map(([key, source]) => {
    const providerKey = key === "mcc" ? "admin:mcc" : key === "adg" ? "admin:adg" : key;
    const token = adminTokenMap.get(providerKey);
    const isEnvBackedMapRanking =
      key === "mrapi" && Boolean(process.env.MAPRANKING_API_BASE_URL && process.env.MAPRANKING_API_KEY);

    return {
      key,
      name: source.label,
      status: token || isEnvBackedMapRanking ? "connected" : "not_connected",
      scope: "admin",
      accountEmail: token?.accountEmail || (isEnvBackedMapRanking ? "Environment token" : null),
      workspaceName: token?.workspaceName || (isEnvBackedMapRanking ? "Map Ranking Ops API" : null),
    };
  });

  return [...userSystems, ...adminSystems];
}

export async function buildAiRouterPayload(args: {
  user: AuthedUser;
  request: z.infer<typeof aiRouterRequestSchema>;
}): Promise<AiRouterPayload> {
  const decision = buildDecision(args.request.task, args.request.taskType);
  const [masterPrompt, userTokens, adminTokens, synced] = await Promise.all([
    getMasterPrompt(),
    prisma.oAuthToken.findMany({
      where: { userId: args.user.id },
      select: {
        provider: true,
        accountEmail: true,
        workspaceName: true,
      },
    }),
    prisma.oAuthToken.findMany({
      where: {
        provider: {
          in: ["admin:mcc", "admin:adg", "ghl"],
        },
        user: {
          role: "ADMIN",
        },
      },
      select: {
        provider: true,
        accountEmail: true,
        workspaceName: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
    prisma.syncedClient.findMany({
      where: { userId: args.user.id },
      include: {
        client: {
          include: {
            kpis: true,
            churnSignals: true,
            goals: true,
            activities: true,
          },
        },
      },
      orderBy: {
        syncedAt: "desc",
      },
    }),
  ]);

  const clients = synced.map((entry) => serializeClient(entry.client));
  const targetClient = args.request.clientId ? clients.find((client) => client.id === args.request.clientId) || null : null;

  if (args.request.clientId && !targetClient) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  const connectedSystems = buildConnectedSystems({ userTokens, adminTokens });
  const runtimeInstructions = buildRuntimeInstructions(decision);
  const artifactInstructions = buildArtifactInstructions(args.request.artifactType);
  const userPrompt = args.request.task;

  return {
    router: {
      ...decision,
      readyForExecution: true,
      reason: `${decision.reason} The routed prompt package includes the MTOS master prompt, runtime instructions, and live workspace context for execution.`,
    },
    promptPackage: {
      sourceFile: "MTOS Master Operating System Prompt.md",
      masterPrompt: args.request.includeMasterPrompt ? masterPrompt : undefined,
      runtimeInstructions,
      artifactInstructions,
      userPrompt,
    },
    intelligencePackage: {
      generatedAt: new Date().toISOString(),
      user: {
        id: args.user.id,
        name: args.user.name,
        email: args.user.email,
        role: args.user.role,
      },
      request: {
        task: args.request.task,
        taskType: decision.taskType,
        clientId: args.request.clientId || null,
        artifactType: args.request.artifactType || null,
        artifactTitle: args.request.artifactTitle || null,
        execute: args.request.execute,
        maxTokens: args.request.maxTokens ?? null,
        temperature: args.request.temperature ?? null,
      },
      coverage: {
        connectedSystems,
        connectedCount: connectedSystems.filter((system) => system.status === "connected").length,
        disconnectedCount: connectedSystems.filter((system) => system.status === "not_connected").length,
      },
      clients: {
        totalSynced: clients.length,
        targetClient,
        roster: args.request.includeClientsSnapshot
          ? clients.map((client) => ({
              id: client.id,
              name: client.name,
              contactName: client.contactName || null,
              accountManager: client.accountManager,
              health: client.health,
              industry: client.industry,
              location: client.location,
              nextTouch: client.nextTouch,
              openActions: client.openActions,
            }))
          : undefined,
      },
    },
  };
}

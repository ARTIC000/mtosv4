import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { UiClient } from "@/lib/types";

type Snapshot = {
  clientId: string;
  createdAt: Date;
  health: number;
  risk: number;
  upsellReadiness: number;
  factors: Prisma.JsonValue | null;
};

export async function loadRecentMtosScoreSnapshots(args: {
  userId: string;
  clientIds: string[];
  perClient: number;
}) {
  if (!args.clientIds.length) {
    return {
      latestByClientId: new Map<string, Snapshot>(),
      previousByClientId: new Map<string, Snapshot>(),
    };
  }

  const rows = await prisma.mtosScoreSnapshot.findMany({
    where: {
      userId: args.userId,
      clientId: { in: args.clientIds },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(2000, args.clientIds.length * Math.max(2, args.perClient)),
  });

  const latestByClientId = new Map<string, Snapshot>();
  const previousByClientId = new Map<string, Snapshot>();

  for (const row of rows) {
    const current = latestByClientId.get(row.clientId);
    if (!current) {
      latestByClientId.set(row.clientId, {
        clientId: row.clientId,
        createdAt: row.createdAt,
        health: row.health,
        risk: row.risk,
        upsellReadiness: row.upsellReadiness,
        factors: row.factors,
      });
      continue;
    }

    if (!previousByClientId.has(row.clientId)) {
      previousByClientId.set(row.clientId, {
        clientId: row.clientId,
        createdAt: row.createdAt,
        health: row.health,
        risk: row.risk,
        upsellReadiness: row.upsellReadiness,
        factors: row.factors,
      });
    }
  }

  return { latestByClientId, previousByClientId };
}

export async function persistMtosScoreSnapshots(args: {
  userId: string;
  clients: UiClient[];
  latestByClientId: Map<string, Snapshot>;
  minIntervalMs?: number;
}) {
  const minIntervalMs = args.minIntervalMs ?? 1000 * 60 * 60;
  const now = Date.now();

  const rows = args.clients
    .filter((client) => client.mtosScores)
    .map((client) => {
      const scores = client.mtosScores!;
      const latest = args.latestByClientId.get(client.id);
      const isSame =
        latest &&
        latest.health === scores.health &&
        latest.risk === scores.risk &&
        latest.upsellReadiness === scores.upsellReadiness;
      const isTooSoon = latest ? now - latest.createdAt.getTime() < minIntervalMs : false;

      if (latest && isSame && isTooSoon) {
        return null;
      }

      return {
        userId: args.userId,
        clientId: client.id,
        health: scores.health,
        risk: scores.risk,
        upsellReadiness: scores.upsellReadiness,
        factors: scores.factors as Prisma.InputJsonValue,
      };
    })
    .filter(Boolean) as Array<{
    userId: string;
    clientId: string;
    health: number;
    risk: number;
    upsellReadiness: number;
    factors: Prisma.InputJsonValue;
  }>;

  if (!rows.length) {
    return { createdCount: 0 };
  }

  const result = await prisma.mtosScoreSnapshot.createMany({
    data: rows,
  });

  return { createdCount: result.count };
}

import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getMapRankingHealth } from "@/lib/mapranking";
import { ADMIN_SOURCES, INTEGRATIONS } from "@/lib/prototype-data";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireUser();
    const [tokens, adminTokens, mapRankingHealth] = await Promise.all([
      prisma.oAuthToken.findMany({
        where: { userId: user.id },
        select: {
          provider: true,
          accountEmail: true,
          workspaceId: true,
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
          workspaceId: true,
          workspaceName: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),
      getMapRankingHealth(),
    ]);

    const tokenMap = new Map(tokens.map((token) => [token.provider, token]));
    const adminTokenMap = new Map<string, (typeof adminTokens)[number]>();
    for (const token of adminTokens) {
      if (!adminTokenMap.has(token.provider)) {
        adminTokenMap.set(token.provider, token);
      }
    }

    const sourceStatuses = {
      mcc: adminTokenMap.get("admin:mcc"),
      adg: adminTokenMap.get("admin:adg"),
      ghl: adminTokenMap.get("ghl"),
      mrapi: mapRankingHealth.ok
        ? {
            accountEmail: "Environment token",
            workspaceId: null,
            workspaceName: "Map Ranking Ops API",
          }
        : process.env.MAPRANKING_API_BASE_URL
          ? {
              accountEmail: "Environment token",
              workspaceId: null,
              workspaceName: mapRankingHealth.message,
            }
        : null,
    } as const;

    return NextResponse.json({
      integrations: INTEGRATIONS.map((item) => {
        const token =
          item.scope === "user"
            ? tokenMap.get(item.slug)
            : item.sourceKey
              ? sourceStatuses[item.sourceKey as keyof typeof sourceStatuses]
              : null;
        const isConnected = item.sourceKey === "mrapi" ? mapRankingHealth.ok : Boolean(token);

        return {
          ...item,
          status: isConnected ? "connected" : "not_connected",
          accountEmail: token?.accountEmail || null,
          workspaceName: token?.workspaceName || null,
        };
      }),
      adminSources: Object.entries(ADMIN_SOURCES).map(([key, source]) => {
        const token = sourceStatuses[key as keyof typeof sourceStatuses];
        const isConnected = key === "mrapi" ? mapRankingHealth.ok : Boolean(token);

        return {
          key,
          ...source,
          status: isConnected ? "connected" : "not_connected",
          accountEmail: token?.accountEmail || null,
          workspaceName: token?.workspaceName || null,
        };
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    return NextResponse.json({ error: "Unable to load integration status." }, { status: 500 });
  }
}

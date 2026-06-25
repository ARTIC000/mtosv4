import { NextResponse } from "next/server";

import { mergeAiArtifactsIntoClients } from "@/lib/ai-artifacts";
import { requireUser } from "@/lib/auth";
import { refreshPostMeetingActionSyncs } from "@/lib/clickup";
import { enrichClientsWithLiveData } from "@/lib/live-enrichment";
import { persistIntegrationLinks } from "@/lib/integration-links";
import { applyMtosScoringToClients } from "@/lib/mtos-scoring";
import { loadRecentMtosScoreSnapshots, persistMtosScoreSnapshots } from "@/lib/mtos-score-snapshots";
import { prisma } from "@/lib/prisma";
import { serializeClient } from "@/lib/serializers";

export async function GET() {
  try {
    const user = await requireUser();
    const synced = await prisma.syncedClient.findMany({
      where: { userId: user.id },
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
    });

    const serialized = synced.map((entry) => serializeClient(entry.client));
    const enrichment = await enrichClientsWithLiveData({
      userId: user.id,
      clients: serialized,
    });
    await persistIntegrationLinks(enrichment.matchesByClientId);
    await refreshPostMeetingActionSyncs({
      userId: user.id,
      clientIds: enrichment.clients.map((client) => client.id),
    });

    const artifacts = await prisma.aiArtifact.findMany({
      where: {
        userId: user.id,
        clientId: {
          in: enrichment.clients.map((client) => client.id),
        },
      },
      select: {
        clientId: true,
        type: true,
        outputText: true,
        structuredData: true,
        updatedAt: true,
      },
    });

    const postMeetingSyncs = await prisma.postMeetingActionSync.findMany({
      where: {
        userId: user.id,
        clientId: {
          in: enrichment.clients.map((client) => client.id),
        },
      },
      select: {
        clientId: true,
        actionHash: true,
        clickupTaskId: true,
        clickupTaskName: true,
        clickupStatus: true,
        clickupAssignee: true,
        clickupDueDate: true,
        lastSyncedAt: true,
      },
    });

    const clients = mergeAiArtifactsIntoClients({
      clients: enrichment.clients,
      artifacts,
      postMeetingSyncs,
    });
    const scoredClients = applyMtosScoringToClients(clients);
    const snapshotLookup = await loadRecentMtosScoreSnapshots({
      userId: user.id,
      clientIds: scoredClients.map((client) => client.id),
      perClient: 2,
    });

    const enrichedClients = scoredClients.map((client) => {
      const scores = client.mtosScores;
      if (!scores) return client;
      const latest = snapshotLookup.latestByClientId.get(client.id);
      const previous = snapshotLookup.previousByClientId.get(client.id);
      const compare = previous ?? latest ?? null;

      return {
        ...client,
        mtosScores: {
          ...scores,
          deltas: compare
            ? {
                health: scores.health - compare.health,
                risk: scores.risk - compare.risk,
                upsellReadiness: scores.upsellReadiness - compare.upsellReadiness,
              }
            : {
                health: null,
                risk: null,
                upsellReadiness: null,
              },
        },
      };
    });

    await persistMtosScoreSnapshots({
      userId: user.id,
      clients: enrichedClients,
      latestByClientId: snapshotLookup.latestByClientId,
      minIntervalMs: 1000 * 60 * 30,
    });

    return NextResponse.json({ clients: enrichedClients });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    return NextResponse.json({ error: "Unable to load clients." }, { status: 500 });
  }
}

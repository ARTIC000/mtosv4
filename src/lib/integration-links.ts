import type { Prisma } from "@prisma/client";

import type { EnrichmentLink } from "@/lib/live-enrichment";
import { prisma } from "@/lib/prisma";

const LINKED_PROVIDERS = ["gcalendar", "gdrive", "ranktracker", "mapcheckins", "gads", "gbp", "ghl"] as const;

export async function persistIntegrationLinks(matchesByClientId: Record<string, EnrichmentLink[]>) {
  for (const [clientId, links] of Object.entries(matchesByClientId)) {
    const providers = new Set(links.map((link) => link.provider));

    await prisma.integrationLink.deleteMany({
      where: {
        clientId,
        provider: {
          in: LINKED_PROVIDERS.filter((provider) => !providers.has(provider)),
        },
      },
    });

    for (const link of links) {
      await prisma.integrationLink.upsert({
        where: {
          clientId_provider: {
            clientId,
            provider: link.provider,
          },
        },
        update: {
          state: link.state,
          profileName: link.profileName,
          confidence: link.confidence,
          metadata: link.metadata as Prisma.InputJsonValue,
        },
        create: {
          clientId,
          provider: link.provider,
          state: link.state,
          profileName: link.profileName,
          confidence: link.confidence,
          metadata: link.metadata as Prisma.InputJsonValue,
        },
      });
    }
  }
}

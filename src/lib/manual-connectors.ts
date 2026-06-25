import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

export type ManualConnectorTarget = "ghl" | "ahrefs" | "meta";

type ManualConnectorConfig = {
  provider: string;
  label: string;
  accountLabel: string;
  scope: "admin" | "user";
};

const MANUAL_CONNECTOR_TARGETS: Record<ManualConnectorTarget, ManualConnectorConfig> = {
  ghl: {
    provider: "ghl",
    label: "GoHighLevel",
    accountLabel: "Agency token",
    scope: "admin",
  },
  ahrefs: {
    provider: "ahrefs",
    label: "Ahrefs",
    accountLabel: "Ahrefs account",
    scope: "user",
  },
  meta: {
    provider: "meta",
    label: "Meta Ads",
    accountLabel: "Meta Ads account",
    scope: "user",
  },
};

export function getManualConnectorConfig(target: ManualConnectorTarget) {
  return MANUAL_CONNECTOR_TARGETS[target];
}

export function isAdminManualConnectorTarget(target: ManualConnectorTarget) {
  return getManualConnectorConfig(target).scope === "admin";
}

export async function upsertManualConnectorToken(args: {
  userId: string;
  target: ManualConnectorTarget;
  accessToken: string;
  refreshToken?: string;
  accountEmail?: string;
  workspaceName?: string;
  scope?: string;
  expiresIn?: number;
  metadata?: Prisma.InputJsonValue;
}) {
  const config = getManualConnectorConfig(args.target);
  const expiresAt = args.expiresIn ? new Date(Date.now() + args.expiresIn * 1000) : null;
  const accountEmail = args.accountEmail?.trim() || null;
  const workspaceName = args.workspaceName?.trim() || config.accountLabel;

  return prisma.oAuthToken.upsert({
    where: {
      userId_provider: {
        userId: args.userId,
        provider: config.provider,
      },
    },
    update: {
      accountEmail,
      workspaceName,
      accessToken: encryptSecret(args.accessToken),
      refreshToken: args.refreshToken ? encryptSecret(args.refreshToken) : null,
      tokenType: "Bearer",
      scope: args.scope?.trim() || null,
      expiresAt,
      metadata: args.metadata,
    },
    create: {
      userId: args.userId,
      provider: config.provider,
      accountEmail,
      workspaceName,
      accessToken: encryptSecret(args.accessToken),
      refreshToken: args.refreshToken ? encryptSecret(args.refreshToken) : null,
      tokenType: "Bearer",
      scope: args.scope?.trim() || null,
      expiresAt,
      metadata: args.metadata,
    },
  });
}

export async function deleteManualConnectorToken(userId: string, target: ManualConnectorTarget) {
  const config = getManualConnectorConfig(target);
  return prisma.oAuthToken.deleteMany({
    where: {
      userId,
      provider: config.provider,
    },
  });
}

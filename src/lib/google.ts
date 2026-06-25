import type { OAuthToken, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export type GoogleTarget = "gcalendar" | "gdrive" | "gmail" | "meet" | "mcc" | "adg";

type GoogleTargetConfig = {
  provider: string;
  label: string;
  scopes: string[];
  accountLabel: string;
};

const GOOGLE_TARGETS: Record<GoogleTarget, GoogleTargetConfig> = {
  gcalendar: {
    provider: "gcalendar",
    label: "Google Calendar",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    accountLabel: "Calendar account",
  },
  gdrive: {
    provider: "gdrive",
    label: "Google Drive",
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    accountLabel: "Drive account",
  },
  gmail: {
    provider: "gmail",
    label: "Gmail",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    accountLabel: "Gmail account",
  },
  meet: {
    provider: "meet",
    label: "Google Meet",
    scopes: [
      "https://www.googleapis.com/auth/meetings.space.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
    accountLabel: "Meet account",
  },
  mcc: {
    provider: "admin:mcc",
    label: "Google MCC",
    scopes: [
      "https://www.googleapis.com/auth/adwords",
      "https://www.googleapis.com/auth/business.manage",
    ],
    accountLabel: "Agency Google MCC",
  },
  adg: {
    provider: "admin:adg",
    label: "Agency Google Account",
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ],
    accountLabel: "Agency analytics account",
  },
};

function getRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL || "http://localhost:3000"}/api/integrations/google/callback`;
}

export function getGoogleTargetConfig(target: GoogleTarget) {
  return GOOGLE_TARGETS[target];
}

export function buildGoogleAuthUrl(target: GoogleTarget, state: string) {
  const config = getGoogleTargetConfig(target);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: getRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    scope: [...config.scopes, "openid", "email", "profile"].join(" "),
  });

  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${await response.text()}`);
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  }>;
}

async function refreshGoogleToken(refreshToken: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${await response.text()}`);
  }

  return response.json() as Promise<{
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  }>;
}

export async function getGoogleUserInfo(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Google user info failed: ${await response.text()}`);
  }

  return response.json() as Promise<{
    email?: string;
    name?: string;
  }>;
}

export async function upsertGoogleToken(args: {
  userId: string;
  target: GoogleTarget;
  accountEmail: string;
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  expiresIn?: number;
  metadata?: Prisma.InputJsonValue;
}) {
  const config = getGoogleTargetConfig(args.target);
  const expiresAt = args.expiresIn ? new Date(Date.now() + args.expiresIn * 1000) : null;

  return prisma.oAuthToken.upsert({
    where: {
      userId_provider: {
        userId: args.userId,
        provider: config.provider,
      },
    },
    update: {
      accountEmail: args.accountEmail,
      workspaceName: config.accountLabel,
      accessToken: encryptSecret(args.accessToken),
      refreshToken: args.refreshToken ? encryptSecret(args.refreshToken) : undefined,
      tokenType: "Bearer",
      scope: args.scope,
      expiresAt,
      metadata: args.metadata,
    },
    create: {
      userId: args.userId,
      provider: config.provider,
      accountEmail: args.accountEmail,
      workspaceName: config.accountLabel,
      accessToken: encryptSecret(args.accessToken),
      refreshToken: args.refreshToken ? encryptSecret(args.refreshToken) : null,
      tokenType: "Bearer",
      scope: args.scope,
      expiresAt,
      metadata: args.metadata,
    },
  });
}

export async function deleteGoogleToken(userId: string, target: GoogleTarget) {
  const config = getGoogleTargetConfig(target);
  return prisma.oAuthToken.deleteMany({
    where: {
      userId,
      provider: config.provider,
    },
  });
}

export async function getGoogleTokenForUser(userId: string, target: GoogleTarget) {
  const config = getGoogleTargetConfig(target);
  return prisma.oAuthToken.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: config.provider,
      },
    },
  });
}

export function readGoogleAccessToken(encryptedValue: string) {
  return decryptSecret(encryptedValue);
}

async function ensureFreshGoogleAccessToken(token: OAuthToken) {
  const now = Date.now();
  const expiresSoon = token.expiresAt ? token.expiresAt.getTime() <= now + 60_000 : false;

  if (!expiresSoon) {
    return decryptSecret(token.accessToken);
  }

  const refreshToken = decryptSecret(token.refreshToken);
  if (!refreshToken) {
    return decryptSecret(token.accessToken);
  }

  const refreshed = await refreshGoogleToken(refreshToken);
  const expiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : token.expiresAt;

  await prisma.oAuthToken.update({
    where: { id: token.id },
    data: {
      accessToken: encryptSecret(refreshed.access_token),
      tokenType: refreshed.token_type || token.tokenType,
      scope: refreshed.scope || token.scope,
      expiresAt,
    },
  });

  return refreshed.access_token;
}

export async function getGoogleAccessTokenForUser(userId: string, target: GoogleTarget) {
  const token = await getGoogleTokenForUser(userId, target);
  if (!token) return null;
  return ensureFreshGoogleAccessToken(token);
}

export async function getGoogleTokenForAdmin(target: "mcc" | "adg") {
  const config = getGoogleTargetConfig(target);
  return prisma.oAuthToken.findFirst({
    where: {
      provider: config.provider,
      user: {
        role: "ADMIN",
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function getGoogleAccessTokenForAdmin(target: "mcc" | "adg") {
  const token = await getGoogleTokenForAdmin(target);
  if (!token) return null;
  return ensureFreshGoogleAccessToken(token);
}

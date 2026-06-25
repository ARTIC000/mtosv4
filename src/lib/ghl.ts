import type { OAuthToken } from "@prisma/client";

import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export type GhlContact = {
  id: string;
  locationId?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  tags: string[];
  source?: string;
  dateAdded?: string;
  lastActivity?: string;
};

export type GhlOpportunity = {
  id: string;
  contactId?: string;
  locationId?: string;
  name?: string;
  status?: string;
  pipelineId?: string;
  pipelineName?: string;
  stageId?: string;
  stageName?: string;
  monetaryValue?: number;
  assignedTo?: string;
  updatedAt?: string;
};

export type GhlConversation = {
  id: string;
  contactId?: string;
  locationId?: string;
  unreadCount: number;
  lastMessageType?: string;
  lastMessageBody?: string;
  lastMessageAt?: string;
};

function extractArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const directArrayKeys = ["contacts", "opportunities", "conversations", "data", "items", "results"];
  for (const key of directArrayKeys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }

  const nestedData = record.data;
  if (nestedData && typeof nestedData === "object" && !Array.isArray(nestedData)) {
    const nestedRecord = nestedData as Record<string, unknown>;
    for (const key of directArrayKeys) {
      const candidate = nestedRecord[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }

  return [];
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function parseContact(raw: unknown): GhlContact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const id = asString(item.id) || asString(item._id);
  if (!id) return null;

  return {
    id,
    locationId: asString(item.locationId),
    name: asString(item.name) || asString(item.contactName),
    firstName: asString(item.firstName),
    lastName: asString(item.lastName),
    companyName: asString(item.companyName) || asString(item.company),
    email: asString(item.email),
    phone: asString(item.phone),
    tags: asStringArray(item.tags),
    source: asString(item.source),
    dateAdded: asString(item.dateAdded) || asString(item.createdAt),
    lastActivity: asString(item.lastActivityDate) || asString(item.lastActivity),
  };
}

function parseOpportunity(raw: unknown): GhlOpportunity | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const id = asString(item.id) || asString(item._id);
  if (!id) return null;

  return {
    id,
    contactId: asString(item.contactId),
    locationId: asString(item.locationId),
    name: asString(item.name),
    status: asString(item.status),
    pipelineId: asString(item.pipelineId),
    pipelineName: asString(item.pipelineName),
    stageId: asString(item.pipelineStageId) || asString(item.stageId),
    stageName: asString(item.pipelineStageName) || asString(item.stageName),
    monetaryValue: asNumber(item.monetaryValue),
    assignedTo: asString(item.assignedTo),
    updatedAt: asString(item.updatedAt) || asString(item.lastStatusChangeAt),
  };
}

function parseConversation(raw: unknown): GhlConversation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const id = asString(item.id) || asString(item._id);
  if (!id) return null;

  return {
    id,
    contactId: asString(item.contactId),
    locationId: asString(item.locationId),
    unreadCount: asNumber(item.unreadCount) || 0,
    lastMessageType: asString(item.lastMessageType) || asString(item.messageType),
    lastMessageBody: asString(item.lastMessageBody) || asString(item.snippet) || asString(item.lastMessage),
    lastMessageAt: asString(item.lastMessageDate) || asString(item.updatedAt) || asString(item.lastManualMessageDate),
  };
}

async function getAdminGhlToken(): Promise<OAuthToken | null> {
  return prisma.oAuthToken.findFirst({
    where: {
      provider: "ghl",
      user: {
        role: "ADMIN",
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

async function ghlFetchJson<T>(path: string, token: OAuthToken, init?: { method?: string; body?: string }) {
  const accessToken = decryptSecret(token.accessToken);
  if (!accessToken) {
    throw new Error("Missing GoHighLevel access token.");
  }

  const response = await fetch(`${GHL_BASE_URL}${path}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init?.body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

async function loadContacts(token: OAuthToken) {
  const response = await ghlFetchJson<unknown>("/contacts/search", token, {
    method: "POST",
    body: JSON.stringify({ pageLimit: 100 }),
  });

  return extractArray(response).map(parseContact).filter(Boolean) as GhlContact[];
}

async function loadOpportunities(token: OAuthToken) {
  const response = await ghlFetchJson<unknown>("/opportunities/search", token, {
    method: "POST",
    body: JSON.stringify({ limit: 100 }),
  });

  return extractArray(response).map(parseOpportunity).filter(Boolean) as GhlOpportunity[];
}

async function loadConversations(token: OAuthToken) {
  const response = await ghlFetchJson<unknown>("/conversations/search?limit=100", token);
  return extractArray(response).map(parseConversation).filter(Boolean) as GhlConversation[];
}

export async function loadGhlSnapshot() {
  const token = await getAdminGhlToken();
  if (!token) {
    return {
      contacts: [] as GhlContact[],
      opportunities: [] as GhlOpportunity[],
      conversations: [] as GhlConversation[],
    };
  }

  const [contactsResult, opportunitiesResult, conversationsResult] = await Promise.allSettled([
    loadContacts(token),
    loadOpportunities(token),
    loadConversations(token),
  ]);

  return {
    contacts: contactsResult.status === "fulfilled" ? contactsResult.value : [],
    opportunities: opportunitiesResult.status === "fulfilled" ? opportunitiesResult.value : [],
    conversations: conversationsResult.status === "fulfilled" ? conversationsResult.value : [],
  };
}

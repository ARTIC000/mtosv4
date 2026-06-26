type PaginatedResponse<T> = {
  data?: T[];
  pagination?: {
    currentPage?: number;
    totalPages?: number;
    totalItems?: number;
    itemsPerPage?: number;
  };
};

export type RankTrackerBusiness = {
  _id: string;
  business_name?: string;
  place_id?: string;
  status?: string;
  integration_status?: {
    gbp?: boolean;
    website?: boolean;
  };
};

export type CheckinBusiness = {
  _id: string;
  business_name?: string;
  place_id?: string;
};

function getAuthHeader(value: string | undefined) {
  return value?.trim() || "";
}

let cachedToken: { token: string; expiresAt: number } | null = null;

type LoginResponse = {
  success: boolean;
  data?: {
    token: string;
    user?: { id: string };
  };
};

async function loginMapRanking(baseUrl: string): Promise<string> {
  const email = process.env.MAPRANKING_LOGIN_EMAIL;
  const password = process.env.MAPRANKING_LOGIN_PASSWORD;

  if (!email || !password) {
    return "";
  }

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "email", email, password }),
    cache: "no-store",
  });

  if (!response.ok) {
    return "";
  }

  const body = (await response.json()) as LoginResponse;
  return body.success && body.data?.token ? `Bearer ${body.data.token}` : "";
}

function getLoginBaseUrl(): string {
  return process.env.MAPRANKING_API_BASE_URL || "https://dashboardapi.mapranking.com";
}

async function resolveRankTrackerToken(): Promise<string> {
  const staticToken = getAuthHeader(process.env.RANK_TRACKER_AUTH_TYPE);
  if (staticToken) {
    return staticToken;
  }

  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const fresh = await loginMapRanking(getLoginBaseUrl());
  if (fresh) {
    const decoded = decodeJwtPayload(fresh);
    const exp = decoded?.exp ? decoded.exp * 1000 : Date.now() + 25 * 60 * 1000;
    cachedToken = { token: fresh, expiresAt: exp };
    return fresh;
  }

  return "";
}

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split(" ");
    const jwt = parts[parts.length - 1];
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    return payload;
  } catch {
    return null;
  }
}

async function fetchMapRankingPage<T>(baseUrl: string, endpoint: string, authHeader: string, page: number, pageSize: number, workspaceId?: string) {
  const url = new URL(endpoint, baseUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(pageSize));
  if (workspaceId) {
    url.searchParams.set("workspaceId", workspaceId);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Map Ranking API failed: ${await response.text()}`);
  }

  return response.json() as Promise<PaginatedResponse<T>>;
}

async function fetchAllPages<T>(baseUrl: string, endpoint: string, authHeader: string, maxPageSize: number, workspaceId?: string) {
  const collected: T[] = [];
  let currentPage = 1;
  let totalPages = 1;

  while (currentPage <= totalPages) {
    const result = await fetchMapRankingPage<T>(baseUrl, endpoint, authHeader, currentPage, maxPageSize, workspaceId);
    collected.push(...(result.data || []));
    totalPages = Math.max(result.pagination?.totalPages || currentPage, currentPage);
    currentPage += 1;
  }

  return collected;
}

export async function fetchRankTrackerBusinesses() {
  const baseUrl = process.env.RANK_TRACKER_BASE_URL || process.env.MAPRANKING_API_BASE_URL;
  const endpoint = process.env.RANK_TRACKER_SAMPLE_ENDPOINT;
  const pageSize = Number(process.env.RANK_TRACKER_PAGE_SIZE_MAX || "100");

  if (!baseUrl || !endpoint) {
    return [];
  }

  const token = await resolveRankTrackerToken();
  if (!token) {
    return [];
  }

  try {
    return await fetchAllPages<RankTrackerBusiness>(baseUrl, endpoint, token, pageSize);
  } catch {
    cachedToken = null;
    const retryToken = await loginMapRanking(baseUrl);
    if (!retryToken) {
      return [];
    }
    cachedToken = { token: retryToken, expiresAt: Date.now() + 25 * 60 * 1000 };
    return fetchAllPages<RankTrackerBusiness>(baseUrl, endpoint, retryToken, pageSize);
  }
}

export async function fetchCheckinBusinesses() {
  return [];
}

export async function getMapRankingHealth() {
  try {
    const data = await fetchRankTrackerBusinesses();
    return {
      ok: true,
      message: `Map Ranking Ops API connected (${data.length} businesses).`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Map Ranking Ops API failed.",
    };
  }
}

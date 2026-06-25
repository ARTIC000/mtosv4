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

async function fetchMapRankingPage<T>(baseUrl: string, endpoint: string, authHeader: string, page: number, pageSize: number) {
  const url = new URL(endpoint, baseUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(pageSize));

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

async function fetchAllPages<T>(baseUrl: string, endpoint: string, authHeader: string, maxPageSize: number) {
  const collected: T[] = [];
  let currentPage = 1;
  let totalPages = 1;

  while (currentPage <= totalPages) {
    const result = await fetchMapRankingPage<T>(baseUrl, endpoint, authHeader, currentPage, maxPageSize);
    collected.push(...(result.data || []));
    totalPages = Math.max(result.pagination?.totalPages || currentPage, currentPage);
    currentPage += 1;
  }

  return collected;
}

export async function fetchRankTrackerBusinesses() {
  const baseUrl = process.env.RANK_TRACKER_BASE_URL || process.env.MAPRANKING_API_BASE_URL;
  const endpoint = process.env.RANK_TRACKER_SAMPLE_ENDPOINT;
  const authHeader = getAuthHeader(process.env.RANK_TRACKER_AUTH_TYPE);
  const pageSize = Number(process.env.RANK_TRACKER_PAGE_SIZE_MAX || "100");

  if (!baseUrl || !endpoint || !authHeader) {
    return [];
  }

  return fetchAllPages<RankTrackerBusiness>(baseUrl, endpoint, authHeader, pageSize);
}

export async function fetchCheckinBusinesses() {
  const baseUrl = process.env.MAP_CHECKINS_BASE_URL || process.env.MAPRANKING_API_BASE_URL;
  const endpoint = process.env.MAP_CHECKINS_SAMPLE_ENDPOINT || process.env.MAP_CHECKINS_BUSINESS_ENDPOINT;
  const authHeader = getAuthHeader(process.env.MAP_CHECKINS_AUTH_TYPE);
  const pageSize = Number(process.env.MAP_CHECKINS_PAGE_SIZE_MAX || "100");

  if (!baseUrl || !endpoint || !authHeader) {
    return [];
  }

  return fetchAllPages<CheckinBusiness>(baseUrl, endpoint, authHeader, pageSize);
}

export async function getMapRankingHealth() {
  try {
    await Promise.all([fetchRankTrackerBusinesses(), fetchCheckinBusinesses()]);
    return {
      ok: true,
      message: "Map Ranking Ops API connected.",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Map Ranking Ops API failed.",
    };
  }
}

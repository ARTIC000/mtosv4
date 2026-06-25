import type { UiClient } from "@/lib/types";

import { loadGhlSnapshot, type GhlContact, type GhlConversation, type GhlOpportunity } from "@/lib/ghl";
import { getGoogleAccessTokenForAdmin, getGoogleAccessTokenForUser } from "@/lib/google";
import { fetchCheckinBusinesses, fetchRankTrackerBusinesses, type CheckinBusiness, type RankTrackerBusiness } from "@/lib/mapranking";

type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: {
    date?: string;
    dateTime?: string;
  };
  attendees?: Array<{ email?: string; displayName?: string }>;
};

type DriveFile = {
  id: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
  mimeType?: string;
};

type GoogleAdsAccount = {
  id: string;
  name: string;
  currencyCode?: string;
  timeZone?: string;
};

type GbpLocation = {
  name: string;
  title?: string;
  storeCode?: string;
  websiteUri?: string;
  phoneNumbers?: {
    primaryPhone?: string;
  };
  metadata?: {
    placeId?: string;
  };
};

function buildGhlContactName(contact: GhlContact) {
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return contact.name || fullName || contact.companyName || contact.email || contact.phone || contact.id;
}

function formatCurrency(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export type EnrichmentLink = {
  provider: string;
  profileName: string;
  confidence: number;
  state: "matched";
  metadata: Record<string, unknown>;
};

function normalizeText(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCalendarPrefix(value: string) {
  return value
    .replace(/^(appointment|meeting|call|consultation|monthly touch)\s+with\s+/i, "")
    .replace(/^(appointment|meeting|call|consultation|monthly touch)\s*[-:/|]\s*/i, "")
    .replace(/^(rescheduled|reschedule|scheduled)\s*[-:/|]\s*/i, "")
    .trim();
}

type CalendarMatchPhrase = {
  phrase: string;
  confidence: number;
};

function buildContactNameVariants(contactName: string | undefined) {
  const normalized = normalizeText(contactName);
  if (!normalized) return [] as CalendarMatchPhrase[];

  const parts = normalized.split(" ").filter(Boolean);
  const phrases = compact<CalendarMatchPhrase>([
    normalized.split(" ").length >= 2
      ? {
          phrase: normalized,
          confidence: 4,
        }
      : null,
    parts.length >= 2
      ? {
          phrase: `${parts[0]} ${parts[parts.length - 1]}`,
          confidence: 3,
        }
      : null,
  ]);

  return Array.from(new Map(phrases.map((item) => [item.phrase, item])).values());
}

function compact<T>(values: Array<T | null | undefined | false>) {
  return values.filter(Boolean) as T[];
}

function formatWhen(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildNeedles(client: UiClient) {
  const name = normalizeText(client.name);
  const contactName = normalizeText(client.contactName);
  const location = normalizeText(client.location);
  return compact([name, contactName, location && `${name} ${location}`]);
}

function matchesClient(client: UiClient, candidates: Array<string | null | undefined>) {
  const needles = buildNeedles(client);
  const haystacks = candidates.map((item) => normalizeText(item));
  return haystacks.some((haystack) => needles.some((needle) => haystack.includes(needle) || needle.includes(haystack)));
}

function containsWholePhrase(value: string, phrase: string) {
  if (!value || !phrase) return false;
  return ` ${value} `.includes(` ${phrase} `);
}

function getCalendarMatchPhrases(client: UiClient) {
  const businessName = normalizeText(client.name);
  return compact<CalendarMatchPhrase>([
    businessName && businessName.length >= 4
      ? {
          phrase: businessName,
          confidence: 2,
        }
      : null,
    ...buildContactNameVariants(client.contactName),
  ]);
}

function getEventTitleMatchScore(client: UiClient, event?: CalendarEvent) {
  const rawSummary = event?.summary || "";
  const summaryCandidates = compact([
    normalizeText(rawSummary),
    normalizeText(stripCalendarPrefix(rawSummary)),
  ]);
  if (!summaryCandidates.length) return 0;

  const candidatePhrases = getCalendarMatchPhrases(client);
  if (!candidatePhrases.length) return 0;

  let bestScore = 0;
  for (const summary of summaryCandidates) {
    for (const candidate of candidatePhrases) {
      if (containsWholePhrase(summary, candidate.phrase)) {
        bestScore = Math.max(bestScore, candidate.confidence);
      }
    }
  }

  return bestScore;
}

function assignCalendarEventsToClients(clients: UiClient[], calendarEvents: CalendarEvent[]) {
  const assignedEventsByClientId: Record<string, CalendarEvent | undefined> = {};

  for (const event of calendarEvents) {
    let bestMatch: { clientId: string; score: number } | null = null;
    let isTie = false;

    for (const client of clients) {
      if (assignedEventsByClientId[client.id]) continue;

      const score = getEventTitleMatchScore(client, event);
      if (!score) continue;

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { clientId: client.id, score };
        isTie = false;
        continue;
      }

      if (score === bestMatch.score) {
        isTie = true;
      }
    }

    if (bestMatch && !isTie) {
      assignedEventsByClientId[bestMatch.clientId] = event;
    }
  }

  return assignedEventsByClientId;
}

function upsertKpi(
  list: UiClient["kpis"],
  next: { label: string; value: string; delta?: string; good: boolean },
) {
  const existingIndex = list.findIndex((item) => item.label === next.label);
  const item = {
    label: next.label,
    value: next.value,
    delta: next.delta || "Live",
    good: next.good,
  };

  if (existingIndex >= 0) {
    list[existingIndex] = item;
  } else {
    list.push(item);
  }
}

function prependActivity(list: UiClient["activity"], item: UiClient["activity"][number]) {
  const exists = list.some((entry) => entry.text === item.text && entry.meta === item.meta);
  if (!exists) {
    list.unshift(item);
  }
}

async function googleFetchJson<T>(
  url: string,
  accessToken: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) {
  const response = await fetch(url, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
    body: init?.body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

async function loadCalendarEvents(userId: string) {
  const accessToken = await getGoogleAccessTokenForUser(userId, "gcalendar");
  if (!accessToken) return [] as CalendarEvent[];

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", new Date().toISOString());
  url.searchParams.set("maxResults", "100");

  const result = await googleFetchJson<{ items?: CalendarEvent[] }>(url.toString(), accessToken);
  return result.items || [];
}

async function loadDriveFiles(userId: string) {
  const accessToken = await getGoogleAccessTokenForUser(userId, "gdrive");
  if (!accessToken) return [] as DriveFile[];

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("fields", "files(id,name,webViewLink,modifiedTime,mimeType)");
  url.searchParams.set("q", "trashed = false");

  const result = await googleFetchJson<{ files?: DriveFile[] }>(url.toString(), accessToken);
  return result.files || [];
}

async function loadGoogleAdsAccounts() {
  const accessToken = await getGoogleAccessTokenForAdmin("mcc");
  const developerToken = process.env.GOOGLE_ADS_API_KEY;
  if (!accessToken || !developerToken) return [] as GoogleAdsAccount[];

  const accessible = await googleFetchJson<{ resourceNames?: string[] }>(
    "https://googleads.googleapis.com/v19/customers:listAccessibleCustomers",
    accessToken,
    { headers: { "developer-token": developerToken } },
  );

  const customerIds = (accessible.resourceNames || [])
    .map((name) => name.split("/").pop())
    .filter(Boolean)
    .slice(0, 25) as string[];

  const accounts = await Promise.all(
    customerIds.map(async (customerId) => {
      const rows = await googleFetchJson<
        Array<{
          results?: Array<{
            customer?: {
              id?: string;
              descriptiveName?: string;
              currencyCode?: string;
              timeZone?: string;
            };
          }>;
        }>
      >(
        `https://googleads.googleapis.com/v19/customers/${customerId}/googleAds:searchStream`,
        accessToken,
        {
          method: "POST",
          headers: {
            "developer-token": developerToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1",
          }),
        },
      ).catch(() => []);

      const firstResult = rows[0]?.results?.[0]?.customer;
      if (!firstResult?.descriptiveName) return null;

      return {
        id: String(firstResult.id || customerId),
        name: firstResult.descriptiveName,
        currencyCode: firstResult.currencyCode,
        timeZone: firstResult.timeZone,
      };
    }),
  );

  return accounts.filter(Boolean) as GoogleAdsAccount[];
}

async function loadGbpLocations() {
  const accessToken = await getGoogleAccessTokenForAdmin("mcc");
  if (!accessToken) return [] as GbpLocation[];

  const accountsResponse = await googleFetchJson<{ accounts?: Array<{ name: string }> }>(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    accessToken,
  ).catch(() => ({ accounts: [] }));

  const accounts = accountsResponse.accounts || [];
  const locations = await Promise.all(
    accounts.slice(0, 10).map(async (account) => {
      const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`);
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("readMask", "name,title,storeCode,websiteUri,phoneNumbers,metadata");
      const result = await googleFetchJson<{ locations?: GbpLocation[] }>(url.toString(), accessToken).catch(() => ({
        locations: [],
      }));
      return result.locations || [];
    }),
  );

  return locations.flat();
}

function applyMapRanking(client: UiClient, rankBusiness?: RankTrackerBusiness, checkinBusiness?: CheckinBusiness) {
  if (rankBusiness) {
    upsertKpi(client.kpis, {
      label: "Rank Tracker",
      value: rankBusiness.status === "active" ? "Active" : "Linked",
      delta: rankBusiness.place_id ? "Place ID linked" : "Live",
      good: rankBusiness.status === "active",
    });

    prependActivity(client.activity, {
      text: `Map Ranking rank tracker linked to ${rankBusiness.business_name || client.name}`,
      meta: rankBusiness.place_id ? `Place ID ${rankBusiness.place_id}` : "Live business record",
      dot: "#2dd4bf",
    });
  }

  if (checkinBusiness) {
    upsertKpi(client.kpis, {
      label: "Check-Ins",
      value: "Tracked",
      delta: checkinBusiness.place_id ? "Place ID matched" : "Live",
      good: true,
    });

    prependActivity(client.activity, {
      text: `Map Check-Ins business matched for ${checkinBusiness.business_name || client.name}`,
      meta: checkinBusiness.place_id ? `Place ID ${checkinBusiness.place_id}` : "Live check-in business",
      dot: "#f5a524",
    });
  }
}

function buildMapRankingLinks(rankBusiness?: RankTrackerBusiness, checkinBusiness?: CheckinBusiness) {
  return compact<EnrichmentLink>([
    rankBusiness
      ? {
          provider: "ranktracker",
          profileName: rankBusiness.business_name || rankBusiness._id,
          confidence: rankBusiness.place_id ? 96 : 86,
          state: "matched",
          metadata: {
            businessId: rankBusiness._id,
            placeId: rankBusiness.place_id || null,
            status: rankBusiness.status || null,
            integrationStatus: rankBusiness.integration_status || null,
          },
        }
      : null,
    checkinBusiness
      ? {
          provider: "mapcheckins",
          profileName: checkinBusiness.business_name || checkinBusiness._id,
          confidence: checkinBusiness.place_id ? 95 : 84,
          state: "matched",
          metadata: {
            businessId: checkinBusiness._id,
            placeId: checkinBusiness.place_id || null,
          },
        }
      : null,
  ]);
}

function applyGhl(client: UiClient, contact?: GhlContact, opportunities: GhlOpportunity[] = [], conversations: GhlConversation[] = []) {
  if (contact) {
    upsertKpi(client.kpis, {
      label: "GHL CRM",
      value: "Linked",
      delta: contact.companyName || contact.email || contact.phone || "Contact matched",
      good: true,
    });

    prependActivity(client.activity, {
      text: `GoHighLevel contact matched: ${buildGhlContactName(contact)}`,
      meta: contact.tags.length ? `Tags: ${contact.tags.slice(0, 3).join(", ")}` : contact.source || "Live CRM contact",
      dot: "#f5a524",
    });
  }

  if (opportunities.length) {
    const primaryOpportunity = opportunities[0];
    const valueLabel = formatCurrency(primaryOpportunity.monetaryValue);
    upsertKpi(client.kpis, {
      label: "GHL Pipeline",
      value: primaryOpportunity.stageName || primaryOpportunity.status || "Active",
      delta: valueLabel ? `${opportunities.length} open · ${valueLabel}` : `${opportunities.length} open`,
      good: true,
    });

    prependActivity(client.activity, {
      text: `GHL opportunity: ${primaryOpportunity.name || client.name}`,
      meta:
        primaryOpportunity.pipelineName && primaryOpportunity.stageName
          ? `${primaryOpportunity.pipelineName} · ${primaryOpportunity.stageName}`
          : primaryOpportunity.status || "Pipeline matched",
      dot: "#fb7185",
    });
  }

  if (conversations.length) {
    const primaryConversation = conversations[0];
    const unreadCount = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
    upsertKpi(client.kpis, {
      label: "GHL Inbox",
      value: unreadCount > 0 ? `${unreadCount} unread` : "Recent activity",
      delta: primaryConversation.lastMessageType || "Conversation matched",
      good: unreadCount === 0,
    });

    prependActivity(client.activity, {
      text: `GHL conversation synced for ${client.name}`,
      meta: primaryConversation.lastMessageBody || primaryConversation.lastMessageType || "Recent conversation",
      dot: "#22c55e",
    });
  }
}

function buildGhlLinks(contact?: GhlContact, opportunities: GhlOpportunity[] = [], conversations: GhlConversation[] = []) {
  if (!contact && !opportunities.length && !conversations.length) return [] as EnrichmentLink[];

  return [
    {
      provider: "ghl",
      profileName: contact ? buildGhlContactName(contact) : opportunities[0]?.name || conversations[0]?.id || "GoHighLevel record",
      confidence: contact ? 88 : 74,
      state: "matched" as const,
      metadata: {
        contactId: contact?.id || null,
        locationId: contact?.locationId || opportunities[0]?.locationId || conversations[0]?.locationId || null,
        tags: contact?.tags || [],
        opportunityCount: opportunities.length,
        openOpportunityValue: opportunities.reduce((sum, item) => sum + (item.monetaryValue || 0), 0),
        stages: opportunities.map((item) => item.stageName || item.status).filter(Boolean),
        unreadConversationCount: conversations.reduce((sum, item) => sum + item.unreadCount, 0),
        lastConversationAt: conversations[0]?.lastMessageAt || null,
      },
    },
  ];
}

function applyGoogleUserData(client: UiClient, event?: CalendarEvent, file?: DriveFile) {
  if (event) {
    const when = formatWhen(event.start?.dateTime || event.start?.date);
    if (when) {
      client.nextTouch = when;
    }

    upsertKpi(client.kpis, {
      label: "Next Meeting",
      value: when || "Scheduled",
      delta: `${event.attendees?.length || 0} attendees`,
      good: true,
    });

    prependActivity(client.activity, {
      text: `Google Calendar: ${event.summary || `Upcoming meeting for ${client.name}`}`,
      meta: when || "Upcoming event",
      dot: "#4a9eff",
    });
  }

  if (file) {
    upsertKpi(client.kpis, {
      label: "Drive Docs",
      value: "Linked",
      delta: file.modifiedTime ? `Updated ${formatWhen(file.modifiedTime)}` : "Live",
      good: true,
    });

    prependActivity(client.activity, {
      text: `Google Drive: ${file.name}`,
      meta: file.webViewLink ? "Live document linked" : "Recent file",
      dot: "#34d399",
    });
  }
}

function buildGoogleUserLinks(event?: CalendarEvent, file?: DriveFile) {
  return compact<EnrichmentLink>([
    event
      ? {
          provider: "gcalendar",
          profileName: event.summary || event.id,
          confidence: 80,
          state: "matched",
          metadata: {
            eventId: event.id,
            htmlLink: event.htmlLink || null,
            start: event.start || null,
            attendeeCount: event.attendees?.length || 0,
          },
        }
      : null,
    file
      ? {
          provider: "gdrive",
          profileName: file.name,
          confidence: 78,
          state: "matched",
          metadata: {
            fileId: file.id,
            webViewLink: file.webViewLink || null,
            modifiedTime: file.modifiedTime || null,
            mimeType: file.mimeType || null,
          },
        }
      : null,
  ]);
}

function applyAdminGoogle(client: UiClient, adsAccount?: GoogleAdsAccount, gbpLocation?: GbpLocation) {
  if (adsAccount) {
    upsertKpi(client.kpis, {
      label: "Google Ads",
      value: "Linked",
      delta: adsAccount.currencyCode ? `${adsAccount.id} · ${adsAccount.currencyCode}` : adsAccount.id,
      good: true,
    });

    prependActivity(client.activity, {
      text: `Google Ads account matched: ${adsAccount.name}`,
      meta: adsAccount.timeZone ? `Customer ${adsAccount.id} · ${adsAccount.timeZone}` : `Customer ${adsAccount.id}`,
      dot: "#4a9eff",
    });
  }

  if (gbpLocation) {
    upsertKpi(client.kpis, {
      label: "GBP",
      value: "Linked",
      delta: gbpLocation.metadata?.placeId || gbpLocation.storeCode || "Location matched",
      good: true,
    });

    prependActivity(client.activity, {
      text: `Google Business Profile matched: ${gbpLocation.title || client.name}`,
      meta: gbpLocation.phoneNumbers?.primaryPhone || gbpLocation.websiteUri || "Live GBP location",
      dot: "#34d399",
    });
  }
}

function buildAdminGoogleLinks(adsAccount?: GoogleAdsAccount, gbpLocation?: GbpLocation) {
  return compact<EnrichmentLink>([
    adsAccount
      ? {
          provider: "gads",
          profileName: adsAccount.name,
          confidence: 82,
          state: "matched",
          metadata: {
            customerId: adsAccount.id,
            currencyCode: adsAccount.currencyCode || null,
            timeZone: adsAccount.timeZone || null,
          },
        }
      : null,
    gbpLocation
      ? {
          provider: "gbp",
          profileName: gbpLocation.title || gbpLocation.name,
          confidence: gbpLocation.metadata?.placeId ? 92 : 82,
          state: "matched",
          metadata: {
            locationName: gbpLocation.name,
            storeCode: gbpLocation.storeCode || null,
            websiteUri: gbpLocation.websiteUri || null,
            placeId: gbpLocation.metadata?.placeId || null,
            phone: gbpLocation.phoneNumbers?.primaryPhone || null,
          },
        }
      : null,
  ]);
}

export async function enrichClientsWithLiveData(args: { userId: string; clients: UiClient[] }) {
  const [calendarResult, driveResult, rankResult, checkinResult, adsResult, gbpResult, ghlResult] = await Promise.allSettled([
    loadCalendarEvents(args.userId),
    loadDriveFiles(args.userId),
    fetchRankTrackerBusinesses(),
    fetchCheckinBusinesses(),
    loadGoogleAdsAccounts(),
    loadGbpLocations(),
    loadGhlSnapshot(),
  ]);

  const calendarEvents = calendarResult.status === "fulfilled" ? calendarResult.value : [];
  const driveFiles = driveResult.status === "fulfilled" ? driveResult.value : [];
  const rankBusinesses = rankResult.status === "fulfilled" ? rankResult.value : [];
  const checkinBusinesses = checkinResult.status === "fulfilled" ? checkinResult.value : [];
  const adsAccounts = adsResult.status === "fulfilled" ? adsResult.value : [];
  const gbpLocations = gbpResult.status === "fulfilled" ? gbpResult.value : [];
  const ghlSnapshot =
    ghlResult.status === "fulfilled"
      ? ghlResult.value
      : {
          contacts: [] as GhlContact[],
          opportunities: [] as GhlOpportunity[],
          conversations: [] as GhlConversation[],
        };

  const matchesByClientId: Record<string, EnrichmentLink[]> = {};
  const calendarEventsByClientId = assignCalendarEventsToClients(args.clients, calendarEvents);

  const clients = args.clients.map((client) => {
    const nextClient: UiClient = {
      ...client,
      kpis: [...client.kpis],
      churn: [...client.churn],
      goals: [...client.goals],
      activity: [...client.activity],
    };

    const calendarEvent = calendarEventsByClientId[nextClient.id];
    const driveFile = driveFiles.find((file) => matchesClient(nextClient, [file.name]));
    const rankBusiness = rankBusinesses.find((business) => matchesClient(nextClient, [business.business_name, business.place_id]));
    const checkinBusiness = checkinBusinesses.find((business) => matchesClient(nextClient, [business.business_name, business.place_id]));
    const adsAccount = adsAccounts.find((account) => matchesClient(nextClient, [account.name]));
    const gbpLocation = gbpLocations.find((location) =>
      matchesClient(nextClient, [location.title, location.storeCode, location.websiteUri]),
    );
    const ghlContact = ghlSnapshot.contacts.find((contact) =>
      matchesClient(nextClient, [
        contact.name,
        buildGhlContactName(contact),
        contact.companyName,
        contact.email,
        contact.phone,
      ]),
    );
    const ghlOpportunities = ghlSnapshot.opportunities
      .filter((opportunity) =>
        ghlContact
          ? opportunity.contactId === ghlContact.id
          : matchesClient(nextClient, [opportunity.name, opportunity.pipelineName, opportunity.stageName]),
      )
      .slice(0, 3);
    const ghlConversations = ghlSnapshot.conversations
      .filter((conversation) =>
        ghlContact ? conversation.contactId === ghlContact.id : matchesClient(nextClient, [conversation.lastMessageBody]),
      )
      .sort((left, right) => (right.lastMessageAt || "").localeCompare(left.lastMessageAt || ""))
      .slice(0, 3);

    applyGoogleUserData(nextClient, calendarEvent, driveFile);
    applyMapRanking(nextClient, rankBusiness, checkinBusiness);
    applyAdminGoogle(nextClient, adsAccount, gbpLocation);
    applyGhl(nextClient, ghlContact, ghlOpportunities, ghlConversations);
    matchesByClientId[nextClient.id] = [
      ...buildGoogleUserLinks(calendarEvent, driveFile),
      ...buildMapRankingLinks(rankBusiness, checkinBusiness),
      ...buildAdminGoogleLinks(adsAccount, gbpLocation),
      ...buildGhlLinks(ghlContact, ghlOpportunities, ghlConversations),
    ];

    nextClient.kpis = nextClient.kpis.slice(0, 8);
    nextClient.activity = nextClient.activity.slice(0, 8);

    return nextClient;
  });

  return {
    clients,
    matchesByClientId,
  };
}

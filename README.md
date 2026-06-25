# Handoff: Monthly Touch OS — ClickUp Auth + Live Data Integration

## Overview
**Monthly Touch OS** is an internal operating system for a local-SEO / marketing agency (Map Ranking). Account managers run a recurring "Monthly Touch" meeting with each client; the app is the cockpit for that — a client roster with a health tracker, per-client KPI dashboards, action items, recaps, testimonials, and a set of integrations (ClickUp, GoHighLevel, Google Ads/GBP/GA4/GSC, Meta, Ahrefs, Gmail, Google Meet).

The design in this bundle is **complete and approved**. What remains is engineering:

1. **A backend** that performs real OAuth with these providers and stores tokens securely.
2. **Live data** — replace the in-memory sample arrays with real API reads.
3. **The specific business rule** the product owner cares about most: when a manager (e.g. **Francisco**) connects ClickUp and clicks **Sync**, the app must import **only the accounts where that manager is the Account Manager** in the Client Health Tracker — nothing more, nothing invented.

## About the Design Files
The files in this bundle are **design references created in HTML** (a streaming "Design Component" prototype). They demonstrate the intended **look, copy, flow, and interaction** — they are **not** production code to ship as-is.

Your task is to **recreate these designs in a real codebase** using its established stack and patterns. There is no existing app codebase yet, so **choose an appropriate stack** — a sensible default is:

- **Frontend:** React + TypeScript (Vite or Next.js). The prototype's logic is already structured like a React class component (state + a `renderVals()` that returns view-model objects), so it ports cleanly to function components + hooks.
- **Backend:** Node (Next.js route handlers / Express / Fastify) or any language you prefer. You need server-side OAuth, a token store, and a small sync service.
- **DB:** Postgres (users, oauth_tokens, clients, integration_links, sync_runs).

The HTML is the **source of truth for UI**; this README is the source of truth for **behavior and data**.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, copy, and interaction states are final. Recreate the UI faithfully. Exact tokens are in the Design Tokens section; the live values also exist inline in `Monthly Touch OS.dc.html`.

---

## The Core Feature: ClickUp Connection + Manager-Scoped Sync

This is the part the product owner most wants finished. Read carefully.

### Intended end-to-end behavior
1. A manager signs in (login screen already designed — email + password).
2. They open **Integrations** and click **Connect your account** on the ClickUp card.
3. A ClickUp **OAuth consent screen** appears (account, workspace pick, scopes). They click **Authorize ClickUp**.
4. Real OAuth: redirect to ClickUp → user approves → callback returns an auth code → **backend** exchanges it for an access token → token stored against that manager.
5. The card flips to **Connected**, and a **Sync clients** button appears.
6. Clicking **Sync** opens a list of accounts **filtered to the rows where the signed-in manager is the Account Manager** in the Client Health Tracker. All are checked by default; the manager can deselect any.
7. Clicking **Sync N accounts** imports them (progress bar) → success screen → lands on the populated client roster.
8. Synced clients **persist** across logout/login.

### The filtering rule (critical — get this exactly right)
The roster shown in the sync step must be:

```
clients_assigned_to(manager) = healthTracker.filter(row => row.accountManager === manager.name)
```

- The source of truth is the **Client Health Tracker** — in production this is a ClickUp List (or a synced sheet) with an **Account Manager** column.
- The signed-in manager's name comes from their profile (the prototype derives it from the email local-part, e.g. `francisco@…` → `Francisco`; in production use the real user record).
- **Never** show accounts assigned to other managers. **Never** synthesize accounts that aren't in the tracker. If the manager has zero assigned rows, show the empty state ("No accounts assigned to {Manager} yet") — do **not** fall back to demo data.

In the prototype this is implemented as:
```js
this.healthTracker = [];                  // intentionally empty — no invented accounts
isMyAccount(c){ return c.accountManager?.toLowerCase().trim() === this.managerName().toLowerCase(); }
this.clickupRoster = (this.healthTracker || []).filter(c => this.isMyAccount(c));
```
Replace `this.healthTracker = []` with a real fetch of the ClickUp Client Health Tracker. Keep the filter.

### What "live data" requires (be honest with the user about scope)
A static/clickable prototype cannot hold OAuth tokens or call third-party APIs from the browser (CORS + secret-safety). Live data needs:

- **A server-side OAuth flow per provider** (authorization-code grant). The browser never sees client secrets.
- **A token store** (encrypted at rest) keyed by user + provider, with refresh-token rotation.
- **A sync service** that reads each provider's API and writes normalized rows into your DB, on a schedule and/or via webhooks.
- **A read API** the frontend calls (`GET /api/clients`, `GET /api/clients/:id`, etc.) returning your normalized data — the UI binds to this instead of the in-memory arrays.

### ClickUp specifics
- **Auth:** OAuth 2.0. Register an app in ClickUp → get `client_id` / `client_secret`. Authorize URL: `https://app.clickup.com/api` (OAuth), token exchange at `https://api.clickup.com/api/v2/oauth/token`.
- **API base:** `https://api.clickup.com/api/v2`
- **Useful endpoints:** `GET /team` (workspaces), `GET /team/{team_id}/space`, `GET /list/{list_id}/task` (tasks), custom fields on tasks carry the **Account Manager** value if the tracker is a ClickUp List.
- **Sync cadence:** hourly poll + webhooks for task changes (the prototype's spec text says "Hourly + webhook").
- **Write-back:** the design promises pushing action items back to ClickUp (`POST /list/{list_id}/task`). Scope the OAuth token for write if you implement this.

### Other integrations (same pattern)
All connector cards exist in the design with consent screens. Each needs the same OAuth-→-token-store-→-sync treatment. Two scopes exist in the UI:
- **User-scope** connectors (the manager connects their own): ClickUp, Gmail, Google Meet.
- **Admin/agency-scope** sources (connected once by an admin, cascading to many integrations): **Google MCC** → covers Google Ads, Google Business Profile, Local Services Ads; **Agency Google Account** → covers GA4 + Search Console; **GoHighLevel agency token** → covers GHL sub-accounts.

Provider notes captured in the prototype's `integrationSpecs` / `adminSources`:
- **GoHighLevel:** CRM — pipelines, leads, comms, appointments. Agency-level token, sub-accounts inherited.
- **Google Ads / GBP / LSA:** via a Google **MCC** (manager account).
- **GA4 / Search Console:** agency Google account.
- **Meta Ads, Ahrefs:** per the cards.

---

## Screens / Views

### 1. Login
- **Purpose:** Manager authenticates; also used to log out and switch to a manager account.
- **Layout:** Centered card on the dark app background. Brand mark, "Welcome back" heading, email + password fields, primary **Sign in** button, sign-in/sign-up toggle.
- **Behavior:** On success sets the authed flag and loads the manager's roster. On logout, returns here. Persisted clients survive the round-trip.

### 2. App shell
- **Left sidebar nav** (dark): Dashboard, Clients, Meetings, Wins, Issues, Recommendations, Integrations, Wiki/Field Manual, plus a sign-out control (`title="Sign out"`).
- **Main content area** swaps by `screen` state. Subtle `mtfade .35s ease` on view change.

### 3. Clients roster / Client Health Tracker
- Cards/rows per client with: avatar (two-color gradient + initials), name, industry · location, **health score**, trend, sentiment, tenure, MRR, next touch, open-action count, a short risk note. Color-coded by health (green / amber / red).
- **Empty by default** until a sync runs. Empty state must not invent clients.

### 4. Client detail
- KPI grid (6 metrics: value + delta, green/red by `good`), context paragraph, churn-signal list, goals, and an activity feed (each item: text, source · timeago, colored dot).

### 5. Integrations
- Grid of connector cards. Each: icon tile (provider tint), name, category, description, status pill (**connected** green / **syncing** amber / **connect** grey), and actions.
- **ClickUp card actions:** when connected, a **Sync clients** primary button (purple→cyan gradient) + **Disconnect**; when not, **Connect your account**. A **Data ›** button opens the detail/spec drawer.
- Admin vs. user scope respected (admin-only sources locked for non-admins).

### 6. ClickUp Connection Wizard (modal) — the new flow
Centered modal, `#0d1320` panel, 18px radius, gradient ClickUp glyph header. Steps driven by `cu.step`:

- **authorize:** shield callout ("Monthly Touch OS wants to access your ClickUp workspace"), account email input, workspace radio list, **permissions** checklist (green checks), `Cancel` / **Authorize ClickUp** (gradient).
- **connecting:** centered spinner, "Connecting to ClickUp…".
- **sync:** "Connected as {email}" + workspace pill, a teal banner **"Filtered to rows where {Manager} is the Account Manager in the Client Health Tracker."**, an **account list** (checkbox, avatar, name, industry · location, task-count chip), Select all / Clear, `Cancel` / **Sync N accounts** (teal). If no assigned rows: **empty state** ("No accounts assigned to {Manager} yet") with a single Close button — never demo data.
- **syncing:** title + `done / total` counter, gradient progress bar, "Importing {client} · tasks, KPIs & activity".
- **done:** green check, "{N} clients synced", **Go to clients**.

---

## Interactions & Behavior
- **Modal step machine:** `cu.step` ∈ `authorize → connecting → sync → syncing → done`. `Cancel`/close clears `cu` and any pending timers.
- **Authorize:** in production, replace the simulated 1.5s delay with the real OAuth redirect + callback. On callback success, advance to `sync` and load the manager's filtered roster from the backend.
- **Sync:** iterate selected ids, show progress, then persist. In production this triggers the backend sync job and streams/poll progress.
- **Persistence:** synced client ids saved (prototype uses localStorage key `mtos_syncedClients`; connection email under `mtos_userConn`). In production, persist server-side per user; the frontend just reads `GET /api/clients`.
- **Animations:** `mtfade .35s ease` (view enter), `mtspin .8s linear infinite` (spinners), progress bar `width .4s ease`.
- **States to implement:** loading (connecting/syncing), empty (no assigned accounts), error (OAuth denied / token expired / API failure — the prototype doesn't yet show an error state; add one: a red callout with retry).

## State Management
Prototype state (port to your store / server):
- `authed`, `role` (`admin` | manager), signed-in manager identity/email.
- `screen` (active nav view), `integrationId` (detail drawer target).
- `userConn` (per-user connected providers → account), `adminConn` (agency sources).
- `cu` (the wizard: `{ step, email, ws, picks, syncIndex, syncIds, count }`).
- `clients`, `recommendations`, `seedActions`, `seedTestimonials`, `clientMaps` (per-client data-source mapping).
- **Server-owned in production:** oauth tokens, the Client Health Tracker, normalized client/KPI/activity data, sync run status.

Key data shapes (see prototype for full examples):
- **Client:** `{ id, name, industry, loc, initials, av:[hex,hex], accountManager, health, trend, sentiment, tenure, mrr, nextTouch, openActions, riskNote, kpis:[{label,value,delta,good}], context, churn:[{text,color}], goals:[], activity:[{text,meta,dot}] }`
- **Integration:** `{ name, cat, glyph, ig:[bgTint,fg], status, desc }` + a `slug` (e.g. `clickup`, `ghl`, `gads`, `gbp`, `ga4`, `gsc`, `meta`, `ahrefs`).

## Design Tokens
**Colors**
- App background (dark): `#0a0e16` / panels `#0d1320`, `#0d1320`
- Borders: `rgba(255,255,255,.07–.14)`
- Text: primary `#eef2f8`, secondary `#9aa6b6` / `#8b94a3`, muted `#5f6b7d` / `#475467`, headings near-white
- ClickUp brand glyph gradient: `#FF02F0 → #7B68EE → #18C7FF`
- Primary action gradient (purple→cyan): `linear-gradient(135deg,#7B68EE,#18C7FF)`
- Sync/confirm gradient (teal): `linear-gradient(135deg,#2dd4bf,#14b8a6)`, on-color text `#06231f`
- Accent purple: `#a78bfa` on `rgba(123,104,238,.10–.12)`
- Status: success `#34d399`, warning `#f5a524`, danger `#f5544f`, info/blue `#4a9eff`
- Provider tints: GHL `#f5a524`, Google `#4a9eff` / `#f59e36`, Meet `#34d399`

**Typography**
- Display/headings: **Space Grotesk** (600/700)
- Body/UI: system stack as in the file; mono accents: **IBM Plex Mono**
- Sizes (UI): 10–13px controls, 11px labels (letter-spacing .5–.8px, weight 600–700, uppercase), 15–18px modal titles, KPI values larger. Slides N/A.

**Radius:** controls 7–11px, cards/tiles 8–14px, modal 18px, pills/full 20px+.
**Shadows:** primary buttons `0 10px 26px rgba(123,104,238,.35)` / teal `…rgba(45,212,191,.28)`; modal `0 40px 100px rgba(0,0,0,.65)`.
**Spacing:** 8/10/12/14/18/20/24px rhythm; modal padding ~20–24px.

## Assets
- **Fonts:** Space Grotesk, IBM Plex Mono (Google Fonts — `<link>` in the file's `<helmet>`).
- **Icons:** inline SVG (Feather-style strokes). No external icon dependency.
- No raster image assets are required by this flow.

## Files
- `Monthly Touch OS.dc.html` — the full app prototype (login, shell, roster, client detail, integrations, **ClickUp wizard**, all logic). Primary reference.
- `Monthly Touch Meeting - Field Manual.dc.html` — the in-app wiki / field manual content (secondary).
- `support.js` — runtime for the `.dc.html` prototype format. **Do not port** — it's only needed to open the HTML prototypes in a browser. Ignore it when building the real app.

> To view a `.dc.html` file, open it directly in a browser (it loads `support.js` from the same folder).

## Recommended build order
1. Auth (real login) + user model with `name` / `accountManager`.
2. ClickUp OAuth (server) + encrypted token store. Card flips to Connected on real callback.
3. Read the Client Health Tracker from ClickUp; expose `GET /api/clients?assignedTo=me` applying the **Account Manager** filter.
4. Wire the wizard's **sync** step to that endpoint; persist synced ids server-side.
5. Recreate roster + client detail bound to live data.
6. Repeat OAuth + sync for the remaining connectors (GHL, Google MCC suite, GA4/GSC, Meta, Ahrefs).
7. Add error states (OAuth denied, token expired, API failure) — not yet in the prototype.

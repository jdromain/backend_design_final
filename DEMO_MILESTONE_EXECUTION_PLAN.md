# Demo milestone — execution-ready plan

**Purpose:** Shortest **honest** path to an internal demo with **no deceptive mock behavior** on demo paths. This is not production completeness.

**Canonical demo auth (this milestone):** **JWT / dev auth bridge** on platform-api (`POST /auth/login` when `CLERK_AUTH_ENABLED=false`), bearer in `localStorage`. Clerk stays in the Next app **only if** it does not block JWT demo (e.g. optional Clerk, or dev route to obtain JWT after Clerk sign-in is a follow-up). **Clerk Organizations and Clerk Billing: defer.**

**Next.js 16:** Use [`frontend/proxy.ts`](frontend/proxy.ts) with `proxy` export; remove legacy [`frontend/middleware.ts`](frontend/middleware.ts) per [middleware-to-proxy](https://nextjs.org/docs/messages/middleware-to-proxy).

---

## 1. Current state summary

### 1.1 Already working (real paths you can build on)

| Area | Evidence |
|------|----------|
| Call persistence API | [`POST /calls/start`, `/calls/end`, `/calls/event`](apps/platform-api/src/routes/calls.ts) → Postgres via [`callStore`](apps/platform-api/src/persistence/callStore.ts) |
| Call reads for UI | [`GET /calls`](apps/platform-api/src/routes/calls.ts), [`GET /calls/live`](apps/platform-api/src/routes/calls.ts), transcript/timeline/tools subroutes |
| DB-backed analytics | [`GET /analytics/*`](apps/platform-api/src/routes/analytics.ts) (outcomes, sparklines, intents, tools, agents, insights) |
| Agents snapshot API | [`GET /agents`](apps/platform-api/src/routes/agents.ts), [`GET /agents/:agentId`](apps/platform-api/src/routes/agents.ts) |
| Billing usage (from DB) | [`GET /billing/usage`](apps/platform-api/src/routes/billing.ts), breakdown/agents/tools/invoices (usage from SQL; dollar lines are **formula-based** — see stub/honesty below) |
| Knowledge listing | [`GET /knowledge/documents`](apps/platform-api/src/routes/knowledge.ts) |
| Health | [`GET /health`](apps/platform-api/src/server.ts) → [`getSystemHealthData`](apps/platform-api/src/health/checks.ts) |
| Dev login | [`loginHandler`](apps/platform-api/src/auth/jwt.ts) returns `{ ok, token }` with real JWT claims (`sub`, `tenant_id`, `email`, `roles`) |
| Config / KB / tool legacy routes | `/config/*`, `/kb/*`, `/tool/*` on [`server.ts`](apps/platform-api/src/server.ts) |
| Realtime → API writes | [`callPersistence.ts`](apps/realtime-core/src/callPersistence.ts) posts to platform-api |

### 1.2 Partially working

| Area | Issue |
|------|--------|
| Frontend ↔ API contract | Many handlers use [`sendData`](apps/platform-api/src/lib/responses.ts) → body `{ data: T }`; [`apiFetch`](frontend/lib/api.ts) returns JSON **as-is** — UI often reads wrong shape |
| Dashboard aggregate | [`getAggregate`](frontend/lib/api.ts) calls **`GET /analytics/calls`** — **route does not exist** → errors or misleading fallbacks |
| Login UX | Client expects top-level `token`; API returns `{ ok, token }` |
| Billing quota UI | API returns `allowed`, `active` from [`canStartCallHandler`](apps/platform-api/src/billingQuota.ts); UI expects `currentConcurrency`, `limit` |
| Agents page | Calls [`/config/agents`](frontend/lib/api.ts) — **not registered** on server; real read is **`GET /agents`** |
| Health header | Expects `{ status, services }`; API returns wrapped `SystemHealthData` inside `{ data }` after unwrapping |

### 1.3 Still mock-backed, synthetic, or misleading on demo paths

| Item | Location | Risk |
|------|----------|------|
| Synthetic call list | [`api.analytics.getCalls`](frontend/lib/api.ts) | **Deceptive** — looks like real calls |
| Random dashboard chart | [`(dashboard)/page.tsx`](frontend/app/(dashboard)/page.tsx) | **Deceptive** volume |
| Fabricated success rate | [`getAggregate`](frontend/lib/api.ts) (85% heuristic) | **Deceptive** analytics |
| Hard-coded user after login | [`auth.login`](frontend/lib/api.ts) | **Misleading** identity |
| Hard-coded “Professional Plan” + $0.15/call | [`billing/page.tsx`](frontend/app/(dashboard)/billing/page.tsx) | **Misleading** billing narrative |
| Clerk sign-in without API JWT | [`middleware.ts`](frontend/middleware.ts) + `apiFetch` only uses `localStorage` | **Broken or confusing** demo auth unless JWT is set |
| Tool connectors | [`toolbus.ts`](apps/platform-api/src/toolbus.ts), [`connectors.ts`](apps/platform-api/src/toolbus/connectors.ts) | Mock path when creds empty — **acceptable for demo if UI does not claim success**; see decisions |
| Default STT mock / RTP fallbacks | [`realtime-core`](apps/realtime-core/) | **Defer** for milestone unless live voice is in scope |

### 1.4 Major blockers to a realistic demo

1. **Envelope + endpoint mismatches** — UI cannot trust responses until `{ data }` is handled and routes align (`/calls`, `/agents`, aggregates).
2. **No single clear demo auth story** — Clerk + JWT without `getToken()` bridge leaves API unauthorized in production auth mode.
3. **Synthetic calls + random charts** — violate zero-deception rule immediately.

---

## 2. Demo milestone definition (this repo)

### 2.1 What “fully working for internal testing / demo” means here

- A tester runs **Postgres + platform-api + frontend** (and optionally realtime-core for live calls).
- **JWT demo auth** works: seeded or known user email → `POST /auth/login` → bearer stored → dashboard API calls succeed in dev (`NODE_ENV=development` auth no-op on API, or bearer attached consistently).
- **All primary dashboard pages load** without fabricated business data: they show **real DB-backed data** or **explicit empty/zero** states.
- **No** synthetic call rows, **no** random analytics curves presented as real, **no** fake subscription/plan copy.

### 2.2 Pages / routes that must work

| Page / area | Must work means |
|-------------|-----------------|
| Dashboard | Metrics and recent activity from **real APIs** or **zeros**; chart from **`/analytics/sparklines`** or empty state — **not** `Math.random` |
| Live | **`GET /calls/live?tenantId=`** (unwrap `{ data }`) or empty |
| History | **`GET /calls?tenantId=`** mapped to table shape |
| Analytics | Same real call list or aggregate from **real endpoints** — no mock `getCalls` |
| Agents | **`GET /agents?tenantId=`**; remove reliance on missing `/config/agents` **or** honest “configure via API” empty state |
| Knowledge | Ingest + status as today; list via **`/knowledge/documents`** if table is shown |
| Integrations | Saving credentials hits real **`POST /tool/credentials`**; tiles do not show “configured: true” without backend truth |
| Billing | **`GET /billing/usage`**, **`/billing/breakdown`** + quota endpoint; **no** hard-coded plan narrative |
| Header health | Reflects **`GET /health`** after correct mapping |

### 2.3 What can still be empty

- Empty **call** tables/charts when DB has no rows.
- **Plan** card: “No active plan” when `plans` row missing.
- **Invoices** list empty when `usage_records` empty.
- **Integrations:** “Not configured” for each provider without secrets.
- **Analytics insights** sparse arrays from SQL.

### 2.4 What must be real

- Any **number or row** presented as call/analytics/usage **must** come from platform-api + Postgres (or defined constant like concurrency cap **10** from code, labeled as such).
- **Login:** token must be from API; user display fields derived from **JWT payload** or small **login response extension** — not invented `user-1`.

### 2.5 Explicitly defer (after demo milestone)

- **Clerk Organizations** as tenant source of truth.
- **Clerk Billing**; any paid subscription UX.
- **Kafka** bus across processes; **in-memory** bus acceptable for single-process demo.
- **Realtime-core:** fix **`startSession`** live `MediaSession`, default **`STT_PROVIDER=mock`**, **`makeDefaultSnapshot`** fallback — **unless** the demo script **requires** live Twilio voice in this sprint.
- **billingQuota** in-memory map → full DB reconciliation.
- **Toolbus:** strict “fail if no creds” everywhere (optional hardening).
- **Fastify schemas on every route** — only **highest-risk** routes in this milestone.

---

## 3. Synthetic / stub areas — explicit decision

| Area | Decision | Notes |
|------|----------|--------|
| `api.analytics.getCalls` mock loop | **Make real now** | Use `GET /calls?tenantId=` + field mapping |
| `getAggregate` + missing `/analytics/calls` | **Make real now** | Add thin **`GET /analytics/summary?tenantId=`** (SQL only) **or** derive from `GET /calls` client-side; **no** fabricated success rate |
| Dashboard random chart | **Make real now** | Use **`/analytics/sparklines`** or empty chart |
| Login fake `user` object | **Make real now** | Prefer extend login response with `{ user: { id, email, tenantId, roles } }` **or** decode JWT client-side (no new fake ids) |
| Billing plan card (Professional / 1000 / $0.15) | **Honest-empty / minimal** | Show usage from API; plan section only if DB returns plan else “No active plan” |
| Billing breakdown dollar totals | **Honest-empty / minimal** | Show **raw usage** (minutes, tokens, counts); hide or label “estimated” lines **or** remove dollar totals for demo |
| Integrations static catalog | **Honest-empty** | Keep static list; **configured** flag only from API or default **false** |
| Health shape mismatch | **Make real now** | Unwrap `{ data }` + map to header or change header to new shape |
| Agents `/config/agents` | **Make real now** | Point read path to **`GET /agents`**; mutations: **defer** multi-agent CRUD **or** wire to existing `/config/publish` in a later sub-phase |
| Realtime STT/RTP mocks | **Defer** | Document: demo validates **UI + API + DB**; live voice is separate unless scoped |
| Tool mock when no creds | **Defer** | Document `MOCK_CONNECTORS`; demo does not claim tool success without credentials |
| Kafka | **Defer** | — |

---

## 4. Execution phases (strict order)

### Phase A — Demo auth path + Next proxy (objective: one coherent gate)

- **Objective:** JWT demo works end-to-end; Next 16 compliant proxy; Clerk does not block JWT path.
- **Tasks**
  1. Document in README or `docs/setup`: `CLERK_AUTH_ENABLED=false`, `JWT_SECRET`, seed user email for [`findUserByEmail`](apps/platform-api/src/auth/store.ts), `NEXT_PUBLIC_API_URL`.
  2. Add minimal **dev-only** UI to obtain JWT: e.g. small **`/dev-login`** page (only when `NODE_ENV=development` or env flag) posting to `/auth/login` and setting `localStorage`, **or** document using curl + paste token — **pick one** and implement.
  3. Rename [`frontend/middleware.ts`](frontend/middleware.ts) → [`frontend/proxy.ts`](frontend/proxy.ts); export `proxy`; allow **`/dev-login`** (and `/sign-in` if keeping Clerk) via matcher.
  4. If Clerk remains: **`proxy`** must not **force** `auth.protect()` on JWT-demo routes, **or** dev-login must run outside protect — align matcher explicitly.
- **Files:** [`frontend/proxy.ts`](frontend/proxy.ts) (new), [`frontend/middleware.ts`](frontend/middleware.ts) (remove), [`frontend/app`](frontend/app) (dev-login optional route), [`docs/setup`](docs/setup) or [`readme.MD`](readme.MD).
- **Dependencies:** None.
- **Definition of done:** With API + DB up, user can open app, get JWT, and hit `GET /calls?tenantId=...` from browser with `Authorization` (or dev no-op + tenant query as today).
- **Out of scope:** Clerk `getToken()` production bridge, org switcher.

### Phase B — Frontend/API contract (objective: `{ data }` + correct endpoints)

- **Objective:** No deceptive data; correct HTTP targets.
- **Tasks**
  1. Add `unwrapData<T>(json)` helper; use for all routes that use `sendData`.
  2. Implement **`getCalls`** → `GET /calls?tenantId=` + map `callId`, `result`→`outcome`, `durationMs`, tools.
  3. Replace **`getAggregate`**: prefer new **`GET /analytics/summary?tenantId=`** in [`routes/analytics.ts`](apps/platform-api/src/routes/analytics.ts) returning counts/durations from SQL **only** — **or** aggregate client-side from `GET /calls` (fewer backend changes).
  4. Fix **`auth.login`**: parse `{ ok, token }`; extend backend login to return **`user`** slice matching JWT **or** decode JWT after save.
  5. Fix **`billing.canStartCall`** response mapping (`active` → `currentConcurrency`, `limit: 10`).
  6. Point agents list to **`GET /agents`**: map response to existing UI types or adjust types.
  7. Map **`GET /health`** to header `HealthStatus` or update header to use `overall` + flattened services.
- **Files:** [`frontend/lib/api.ts`](frontend/lib/api.ts), [`frontend/lib/types.ts`](frontend/lib/types.ts), [`frontend/components/layout/header.tsx`](frontend/components/layout/header.tsx), [`frontend/app/(dashboard)/*`](frontend/app/(dashboard)), [`apps/platform-api/src/routes/analytics.ts`](apps/platform-api/src/routes/analytics.ts) (if summary route).
- **Dependencies:** Phase A for bearer.
- **Definition of done:** Dashboard, History, Live, Analytics load **without** mock calls and **without** 404 on aggregate; health chip meaningful or “degraded”.
- **Out of scope:** Full agents CRUD via new endpoints.

### Phase C — Dashboard & billing honesty (objective: remove misleading UX)

- **Objective:** No hard-coded plan or fake costs.
- **Tasks**
  1. Remove random chart; wire **`/analytics/sparklines`** or empty.
  2. Billing page: fetch **`/billing/usage`**, **`/billing/breakdown`**; remove Professional/1000/$0.15; show plan from API or “No active plan”; strip or label estimates.
  3. Integrations: set **configured** from credential API if exists; else **false** + copy.
- **Files:** [`frontend/app/(dashboard)/page.tsx`](frontend/app/(dashboard)/page.tsx), [`frontend/app/(dashboard)/billing/page.tsx`](frontend/app/(dashboard)/billing/page.tsx), [`frontend/app/(dashboard)/integrations/page.tsx`](frontend/app/(dashboard)/integrations/page.tsx), [`frontend/lib/api.ts`](frontend/lib/api.ts) (new client methods if needed).
- **Dependencies:** Phase B.
- **Definition of done:** No user-visible copy implies subscription or usage that is not from API/DB.
- **Out of scope:** Real pricing engine, Stripe, Clerk Billing.

### Phase D — Platform-api honesty pass (objective: no accidental fake “success” payloads)

- **Objective:** Demo-critical handlers return **real or empty**, documented.
- **Tasks**
  1. Audit **`GET`** handlers used by dashboard: ensure empty DB → **empty arrays / zeros**, not invented rows.
  2. **`loginHandler`:** optionally add `user: { id, email, tenantId, roles }` in response (mirror JWT) — **small, stable addition**.
  3. Document **`MOCK_CONNECTORS`** / empty creds behavior in `docs/setup`; no UI change required in this phase if Phase C integrations are honest.
- **Files:** [`apps/platform-api/src/auth/jwt.ts`](apps/platform-api/src/auth/jwt.ts), [`apps/platform-api/src/routes/*.ts`](apps/platform-api/src/routes), docs.
- **Dependencies:** Phase B contract clear.
- **Definition of done:** No demo-facing GET returns placeholder “sample” business entities.
- **Out of scope:** Rewriting toolbus, billingQuota persistence.

### Phase E — Response schemas + Fastify tests (objective: contract stabilization)

- **Objective:** Lock highest-risk behavior with `app.inject()` + TypeBox schemas where it pays off.
- **Tasks**
  1. Add **`apps/platform-api`** test runner (Vitest or node:test) + `buildServer` + in-memory bus for tests.
  2. **`app.inject()` tests:** `GET /health`, `GET /calls`, `GET /calls/live`, `POST /auth/login`, `GET /analytics/summary` (if added), `POST /billing-quota/can-start-call` — assert status + **shape** (unwrap `{ data }` where applicable).
  3. Add **response schema** (TypeBox) for **at least:** `GET /health`, `GET /calls`, `POST /auth/login`, and the new summary route if added.
- **Files:** [`apps/platform-api/package.json`](apps/platform-api/package.json), new `apps/platform-api/src/**/*.test.ts` or `test/`, [`apps/platform-api/src/server.ts`](apps/platform-api/src/server.ts) / route files.
- **Dependencies:** Phases B–D stable enough to freeze shapes.
- **Definition of done:** CI or `pnpm test` in platform-api passes; schemas on listed routes.
- **Out of scope:** 100% route coverage.

### Phase F — Tests & smoke glue (objective: repo-wide demo verification)

- **Objective:** Frontend tests stop asserting mock call **business** data; run script runs API + FE tests.
- **Tasks**
  1. Rewrite [`frontend/__tests__/api.test.ts`](frontend/__tests__/api.test.ts) to test **mapping/unwrap** with **HTTP mocked**, not synthetic call arrays as “correct.”
  2. Update [`run-tests.sh`](run-tests.sh) to invoke platform-api tests.
  3. Document **manual smoke** checklist (below).
- **Dependencies:** Phase E.
- **Definition of done:** No test encodes “mock calls are valid product data.”
- **Out of scope:** E2E Playwright.

### Phase G — Realtime (optional sub-milestone)

- **Objective:** Only if demo **must** include live voice in this sprint.
- **Decision:** **Defer by default** per §2.5. If pulled in: set `STT_PROVIDER=deepgram`, require keys, document RTP bridge URL; fix **`startSession`** non-mock path in [`rtpBridgeClient.ts`](apps/realtime-core/src/media/rtpBridgeClient.ts).
- **Out of scope by default:** Entire Phase G.

---

## 5. Must do now vs defer

| Must do now (demo) | Should do soon | Defer (post-demo) |
|--------------------|----------------|-------------------|
| Phase A proxy + JWT demo story | Agents mutations via `/config/publish` if needed | Clerk Orgs |
| Phase B contract + real calls/aggregate | Stricter tool errors | Clerk Billing |
| Phase C billing/dashboard honesty | DB-backed quota | Kafka wiring |
| Phase D API GET honesty | More response schemas | RTP `startSession` / STT default mock |
| Phase E–F tests + run-tests | — | billingQuota full reconciliation |

---

## 6. Testing plan

### 6.1 API verification (manual or collection)

- `POST /auth/login` → `{ ok, token [, user] }`
- `GET /health` → 200, `data.overall` present
- `GET /calls?tenantId=<seed>` → `{ data: [] }` or real rows
- `GET /calls/live?tenantId=...`
- `GET /analytics/sparklines?tenantId=...`
- `GET /billing/usage?tenantId=...`
- `POST /billing-quota/can-start-call` `{ tenantId }`

### 6.2 Route-level Fastify tests (`app.inject()`)

- Same as above + **401/403** behavior under `NODE_ENV=production` with `authHook` for one protected route (e.g. `GET /calls` without token).

### 6.3 Frontend smoke (mocks off)

- Build + run app against real API; open Dashboard, History, Live, Analytics, Agents, Billing — **Network tab** shows only documented endpoints; **no** client-generated call list.

### 6.4 Auth verification

- JWT path: login → token in storage → refresh page → queries still authorized (or dev no-op + tenant query documented).

### 6.5 Page-by-page demo verification

- Use checklist §7.

### 6.6 Zero-mock checks on demo paths

- Grep in `frontend/app/(dashboard)` and `frontend/lib/api.ts`: no **`Generate mock`**, no **`Math.random`** for metrics/charts, no synthetic **`call-` + loop** in `getCalls`.
- Allow **`__tests__`** and `vi.fn` mocks.

---

## 7. Final demo-readiness checklist (pass / fail)

- [ ] **`proxy.ts`** present; **`middleware.ts`** absent (or re-export only during migration — final state: proxy only).
- [ ] Documented steps: start Postgres, platform-api, frontend; obtain JWT.
- [ ] Dashboard: no random chart; metrics from API or zeros.
- [ ] History / Analytics: lists from **`GET /calls`** (or summary), not local fabrication.
- [ ] Live: from **`GET /calls/live`** or empty.
- [ ] Agents: from **`GET /agents`**, not missing `/config/agents`.
- [ ] Billing: no hard-coded plan; usage from **`/billing/*`** or empty.
- [ ] Health header matches **`GET /health`** mapping.
- [ ] **`pnpm`** test (or script) runs **platform-api** `app.inject()` tests green.
- [ ] Frontend tests do not assert synthetic calls as product truth.
- [ ] Grep zero-mock (§6.6) clean for demo paths.

---

## 8. Recommended immediate next step

**Implement Phase B item 1–2 in [`frontend/lib/api.ts`](frontend/lib/api.ts):** add **`unwrapData`**, switch **`getCalls`** to **`GET /calls?tenantId=`** with field mapping, and fix **`auth.login`** to read **`{ ok, token }`**. This removes the most visible deceptive behavior immediately and unblocks dashboard/history/live honesty before proxy/auth polish.

**Second:** Add **`GET /analytics/summary`** (small SQL handler) **or** client-only aggregation from **`GET /calls`** to kill the missing **`/analytics/calls`** 404 and the 85% fabrication in one place.

---

*End of plan.*

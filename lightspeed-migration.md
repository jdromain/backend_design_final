# Lightspeed End-to-End Migration Plan

This plan fully removes Calendly and replaces booking/reservations with Lightspeed integrations.
Scope includes:
- Lightspeed Restaurant K-Series (primary reservations provider)
- Lightspeed Retail (X-Series) integration for retail customers, products, and sales data
- Lightspeed Golf (Chronogolf Partner API)

Out of scope:
- Lightspeed Restaurant U-Series and O-Series (can be added later)
- Legacy Calendly support after cutover

---

## 1) Source References (keep handy)

### 1.1 Lightspeed Restaurant K-Series
- OpenAPI JSON: https://api-docs.lsk.lightspeed.app/source.json
- Base URLs: demo https://api.trial.lsk.lightspeed.app, prod https://api.lsk.lightspeed.app

### 1.2 Lightspeed Retail (X-Series)
- Auth and domain_prefix flow: https://x-series-api.lightspeedhq.com/docs/authorization
- Sales API (Sales 101): https://x-series-api.lightspeedhq.com/docs/sales_101
- Editing sales (payload caveats): https://x-series-api.lightspeedhq.com/docs/sales_editing_sales

### 1.3 Lightspeed Golf (Chronogolf Partner API)
- Postman docs: https://www.postman.com/grey-moon-4197/teetimecentral-s-public-workspace/documentation/u86nmjo/chronogolf-partner-api-v2

---

## 2) Target Architecture

Flow:
1) Admin connects tenant to Lightspeed K-Series, Retail X-Series, and Golf.
2) Platform API stores OAuth tokens and platform metadata.
3) Toolbus routes booking tools to Lightspeed K-Series (default).
4) Golf and Retail sync flows run on schedule or webhook triggers.
5) Webhooks update reservations and status in internal DB.

```
Frontend -> Platform API -> Toolbus -> Lightspeed APIs
                        -> Postgres (accounts, reservations, customers)
Webhooks -> Platform API -> Event Bus -> Realtime Core
```

---

## 3) API Schema and Request Structures (Key Endpoints)

### 3.1 Lightspeed Restaurant K-Series (Reservations for Platforms)

Important schema objects from K-Series OpenAPI:

Auth and scopes:
- OAuth2 authorization code grant.
- Authorization URL: /oauth/authorize
- Token URL: /oauth/token
- Reservation scopes are `reservation-***` where `***` is our platform code.

#### Platform Reservation (platform side)
Required fields:
- utcUpdatedAt (date-time, UTC)
- utcScheduledAt (date-time, UTC)
- partySize (int)
- status (enum)
- guest (object with platformGuestId, firstName, and optional email/phone)

Guest fields:
- platformGuestId (string)
- firstName (string)
- lastName (string)
- email (string, optional)
- phone (string, optional)
- language, allergens, dietaryRestrictions, notes, walkIn, guestRequest (optional)

Reservation optional fields:
- notes, specialOffer, tags (string / string[])
- sequenceId (int64)
- tableNumbers (string[])
- expectedDuration (ISO-8601 duration)

Status enum:
- ON_HOLD, SCHEDULED, PARTIALLY_ARRIVED, ARRIVED,
  PARTIALLY_SEATED, SEATED, DEPARTED, CANCELLED, NO_SHOW, ERROR

#### POS Reservation (POS-side)
Fields:
- businessLocationId
- platformReservationId
- platformRestaurantId
- platformCode
- partySize
- status (same enum)
- utcScheduledAt, utcSeatedAt, utcDepartedAt
- guest (firstName required, lastName optional)
- notes, tags, specialOffer

#### Platform Profile (webhook config)
Fields:
- displayName (required)
- webhookAuthType (required, enum: BASIC_AUTH, BEARER_TOKEN, API_KEYS, OAUTH2, NONE)
- webhookAuthDetails (object for API keys, basic auth, bearer, or oauth2)
- notificationTypes (ORDER_OPENED, ORDER_UPDATED, ORDER_CLOSED, ONBOARDING_STARTED,
  INTEGRATION_ACTIVATED, INTEGRATION_DEACTIVATED, POS_RESERVATION_UPDATED, ERROR)
- errorsWebhookUrl, integrationWebhookUrl, onboardingWebhookUrl, orderWebhookUrl,
  posReservationUpdateWebhookUrl (URI strings)
- allowedPosStatuses, inServiceTableStatuses, allowCourseNumberUpdates

Core endpoints we will use (Reservations for Platforms):
1) Callback to Complete Onboarding (POST)
2) Platform Profile Details (GET)
3) Create or Update Platform Profile (POST)
4) Platform course settings definition (PATCH)
5) Create or Update Reservation (PUT)
6) Add authentication by XApiKey (PATCH)
7) Add authentication with BasicAuth (PATCH)
8) Add authentication with BearerAuth (PATCH)
9) Add authentication with OAuth2 (PATCH)
10) Get Business Locations (GET)
11) Activate Integration for Restaurant (POST)
12) Deactivate Integration for Restaurant (POST)

Webhook notifications we will consume:
- POS reservation updated
- Integration notification
- Onboarding notification
- Error notification

### 3.2 Lightspeed Retail (X-Series) Core Flows

Auth and base URL:
- OAuth2 authorization code flow
- Token endpoint uses tenant-specific domain_prefix
  https://{domain_prefix}.retail.lightspeed.app/api/1.0/token
- API calls use Bearer token and the same domain_prefix

Important endpoints and payloads for our integration:

1) Sales (create/submit)
   - POST /api/2026-01/sales

Minimal payload (Sales 101):
```
{
  "source": {
    "author_id": "USER_ID"
  },
  "state": "closed",
  "line_items": [
    {
      "product": { "id": "PRODUCT_ID" },
      "quantity": 1,
      "pricing": { "price": "12" },
      "tax": { "id": "TAX_ID", "amount": "1.8" }
    }
  ]
}
```

Full payload (Sales 101):
```
{
  "source": {
    "register_id": "REGISTER_ID",
    "author_id": "USER_ID"
  },
  "date": "YYYY-MM-DDTHH:MM:SSZ",
  "customer_id": "CUSTOMER_ID",
  "state": "closed",
  "attributes": [],
  "note": "",
  "short_code": "abc123",
  "invoice_number": "INV-123",
  "line_items": [
    {
      "product": { "id": "PRODUCT_ID" },
      "quantity": 1,
      "pricing": {
        "price": "22",
        "cost": "20",
        "discount": "0",
        "loyalty_amount": "0"
      },
      "tax": { "id": "TAX_ID", "amount": "3.3" },
      "status": "CONFIRMED"
    }
  ],
  "payments": [
    {
      "type": { "config_id": "PAYMENT_TYPE_ID" },
      "date": "YYYY-MM-DDTHH:MM:SSZ",
      "amount": "25.3"
    }
  ]
}
```

Required supporting endpoints:
- /api/2026-01/taxes (to fetch tax.id)
- /api/2026-01/payment_types (to fetch payment type config_id)

Important behavior:
- /api/2026-01/sales requires all existing line_items when updating a sale.
- Editing via API 0.9 uses POST /api/register_sales and requires full payloads.
- Field names differ between API 0.9 and 2.0 (line_items vs register_sale_products).

Initial focus:
- Sales ingestion and validation
- Retail customer sync (after we confirm the customer endpoints in the reference section)

### 3.3 Lightspeed Golf (Chronogolf Partner API)

Auth:
- OAuth2
- Access tokens valid for 2 hours
- Refresh tokens do not expire unless used
- Rate limit: 200 requests/min

Base path:
- /partner_api/v2

Key endpoints for integration (per Chronogolf Partner API doc):
1) Organizations
   - GET /partner_api/v2/organizations
2) Courses
   - GET /partner_api/v2/organizations/:organization_id/courses
3) Player Types
   - GET /partner_api/v2/organizations/:organization_id/player_types
4) Tee Times
   - GET /partner_api/v2/organizations/:organization_id/teetimes
5) Reservations
   - POST /partner_api/v2/organizations/:organization_id/reservations
   - GET /partner_api/v2/organizations/:organization_id/reservations
6) Reservation Requests
   - POST /partner_api/v2/organizations/:organization_id/reservation_requests
7) Customers
   - POST /partner_api/v2/organizations/:organization_id/customers
   - GET /partner_api/v2/organizations/:organization_id/customers

Refresh token request (documented):
```
POST {{url}}/oauth/token?client_id={{client_id}}&client_secret={{client_secret}}&refresh_token={{refresh_token}}&grant_type=refresh_token&redirect_uri={{redirect_uri}}
```

List organizations request example:
```
GET {{url}}/partner_api/v2/organizations/
Accept: application/vnd.api+json
Authorization: Bearer {{access_token}}
```

Tee time notes:
- Start times are formatted as HH:mm in the API.

---

## 4) Data Model Changes (DB Migration)

Create `database/003_lightspeed.sql` with the following tables:

### 4.1 external_accounts
Stores OAuth tokens and base URL data for each platform.
Columns:
- id (uuid), tenant_id (text), provider (text)
- account_id (text), location_id (text)
- access_token, refresh_token, expires_at (timestamptz)
- scopes (text[])
- base_url (text)
- domain_prefix (text) [Retail X-Series]
- raw_payload (jsonb)
Indexes:
- unique (tenant_id, provider, account_id)
- (tenant_id, provider)

### 4.2 k_reservations
Stores K-Series reservation records.
Columns:
- id (uuid), tenant_id, business_id, location_id
- platform_reservation_id, platform_restaurant_id
- status, party_size, start_time, end_time
- guest_name, guest_phone, guest_email
- notes, tags
- raw_payload (jsonb)
- created_at, updated_at
Indexes:
- unique (tenant_id, platform_reservation_id)

### 4.3 k_locations
Columns:
- id (uuid), tenant_id, business_location_id, name, raw_payload

### 4.4 k_guests (optional but recommended)
Columns:
- id (uuid), tenant_id, platform_guest_id, name, phone, email, raw_payload

### 4.5 retail_customers
Columns:
- id (uuid), tenant_id, retail_customer_id, name, phone, email, raw_payload

### 4.6 golf_entities
Tables:
- golf_organizations (tenant_id, external_id, name, raw_payload)
- golf_courses (tenant_id, external_id, organization_id, name, raw_payload)
- golf_player_types (tenant_id, external_id, organization_id, name, raw_payload)
- golf_customers (tenant_id, external_id, phone, email, name, raw_payload)
- golf_reservations (tenant_id, external_id, course_id, tee_time_id, status, start_time, party_size, raw_payload)

---

## 5) Credentials and Auth Flows

### 5.1 Platform API Credentials
Update `apps/platform-api/src/credentials/routes.ts`:
- Add providers:
  - lightspeed_k
  - lightspeed_retail
  - lightspeed_golf

Each provider requires:
- client_id
- client_secret
- redirect_uri
Optional:
- scopes
- base_url
- account_id

Add routes:
- POST /credentials/:tenantId/{provider}/authorize
- GET /credentials/:tenantId/{provider}/callback

### 5.2 Token Storage
Persist access_token, refresh_token, expires_at, scopes, base_url in `external_accounts`.

### 5.3 Tokenless Testing (Mock Mode)
Support test mode without tokens:
- Env: MOCK_CONNECTORS=true
- Env: LIGHTSPEED_K_MOCK=true
- Env: LIGHTSPEED_RETAIL_MOCK=true
- Env: LIGHTSPEED_GOLF_MOCK=true

Mock responses include realistic IDs and timestamps to test flows end-to-end.

---

## 6) Toolbus and Connectors

### 6.1 New connectors
Create:
- `apps/platform-api/src/toolbus/lightspeedK.ts`
- `apps/platform-api/src/toolbus/lightspeedRetail.ts`
- `apps/platform-api/src/toolbus/lightspeedGolf.ts`

### 6.2 Tool routing changes
Update `apps/platform-api/src/toolbus.ts`:
- book_appointment -> lightspeed_k
- search_availability -> lightspeed_golf (tee time search)

### 6.3 Tool execution
Update `apps/platform-api/src/toolbus/connectors.ts`:
- Replace Calendly logic entirely.
- Route booking and reservation tools to Lightspeed K-Series.

---

## 7) Realtime Core and Agent Tools

### 7.1 Replace Calendly tools
Remove:
- calendly_search_availability
- calendly_create_booking
- calendly_cancel_booking

Add:
- lightspeed_k_create_reservation
- lightspeed_k_cancel_reservation
- lightspeed_golf_search_tee_times
- lightspeed_golf_create_reservation

### 7.2 Update required slots
For K-Series reservations:
- date_text
- time_text
- party_size
- customer_name
- customer_phone (preferred)
- customer_email (optional)

For Golf tee times:
- course_id (or course name lookup)
- date_text
- player_count
- holes (9 or 18)
- customer_name
- customer_phone (preferred)

### 7.3 Context additions
Update `buildCallContext`:
- lightspeedAccountId
- lightspeedLocationId
- golfOrganizationId
- golfCourseId

---

## 8) Webhooks

Add:
- `apps/platform-api/src/webhooks/lightspeed-k.ts`
- `apps/platform-api/src/webhooks/lightspeed-golf.ts`

Responsibilities:
- Verify signature/auth if provided
- Normalize payloads
- Emit `AppointmentUpdated` events
- Update reservation tables

---

## 9) UI and Admin

Add integration tiles:
- Lightspeed K-Series
- Lightspeed Retail
- Lightspeed Golf

Each tile:
- Connect (OAuth)
- Status (connected, token expiry)
- Default location/course selector

---

## 10) Remove Calendly Completely

Delete or refactor:
- `apps/realtime-core/src/calendlyClient.ts`
- Calendly tools in `apps/realtime-core/src/orchestrator/openai-agents/tools.ts`
- Calendly config in `apps/platform-api/src/config/data.ts`
- Calendly credential provider in `apps/platform-api/src/credentials/routes.ts`
- Calendly webhook handler in `apps/platform-api/src/webhooks/calendly.ts`
- Calendly env vars in `apps/platform-api/src/env.ts`
- Calendly references in `packages/core-types/src/index.ts`

Update:
- `BookingProvider` enum to: lightspeed_k | lightspeed_retail | lightspeed_golf | none
- Default booking provider -> lightspeed_k

---

## 11) Implementation Phases (Detailed)

Phase A: Foundation
- Add provider enums in core types.
- Add external_accounts table and provider-specific tables.
- Add MOCK_CONNECTORS flags and provider-specific mock switches.
- Add provider config validation in platform API.

Phase B: K-Series (Reservations for Platforms)
- Implement OAuth flow and token storage.
- Implement platform profile create/update.
- Implement reservation create/update.
- Implement business location fetch.
- Implement activation/deactivation endpoints.
- Implement POS reservation update webhook ingestion.
- Map K-Series reservation statuses to internal statuses.

Phase C: Retail X-Series
- Implement OAuth flow (domain_prefix capture).
- Add sales ingestion using /api/register_sales.
- Cache taxes and payment types for sales creation.
- Add customer sync once endpoints are confirmed.
- Add data consistency checks for returns and edits.

Phase D: Golf (Chronogolf)
- Implement OAuth flow and refresh token rotation.
- Sync organizations, courses, player types.
- Implement tee time search and reservation creation.
- Implement reservation request flow (if needed for waitlist flows).
- Persist tee time and reservation data locally.

Phase E: Calendly Removal
- Remove Calendly tools and clients.
- Remove Calendly webhook handler and env vars.
- Remove Calendly references in config and UI.
- Run final regression tests on booking flows.

---

## 12) Cutover Plan

Phase 0: Add mocks and feature flags.
Phase 1: Implement K-Series integration end-to-end.
Phase 2: Implement Retail X-Series sync (customers + sales).
Phase 3: Implement Golf tee time search + reservation.
Phase 4: Remove Calendly code and configs.
Phase 5: Production rollout and monitoring.

Rollback:
- Re-enable legacy provider routing temporarily if needed
- Keep old env vars in a backup config for 1 release

---

## 13) Testing and QA

Unit tests:
- Connector payload validation
- Token refresh flows

Integration tests:
- Booking flow through toolbus (mock mode)
- Webhook ingestion and persistence

Monitoring:
- Reservation creation success rate
- Webhook latency and error rates

---

## 14) Deliverables Checklist

- [ ] DB migration and indexes
- [ ] OAuth flows for K-Series, Retail, Golf
- [ ] K-Series reservation connector
- [ ] Retail customer and sales connector
- [ ] Golf tee time and reservation connector
- [ ] Webhook handlers
- [ ] Realtime core tool updates
- [ ] Calendly removal
- [ ] UI integration tiles
- [ ] E2E tests

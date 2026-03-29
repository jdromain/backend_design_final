# Rezovo Frontend Dashboard

A modern Next.js dashboard for the Rezovo AI Voice Platform. Built with TypeScript, Tailwind CSS, and shadcn/ui components.

## Features

- **Dashboard**: Real-time KPI metrics, call volume charts, and recent call summaries
- **Live Calls**: Monitor active calls with live duration counters and system status
- **Call History**: Filterable table with search and outcome filters
- **Analytics**: Visual insights with pie charts, bar charts, and key metrics
- **AI Agents**: Manage agent configurations with JSON editor
- **Knowledge Base**: Upload documents and monitor embedding status
- **Integrations**: Configure external service credentials (Calendly, Twilio, HubSpot, etc.)
- **Billing**: View usage metrics and billing information

## Getting Started

### Prerequisites

- Node.js 18.17.0 or higher
- The Rezovo backend running on `http://localhost:3001`

### Installation

From the **monorepo root** (recommended):

```bash
pnpm install
```

Or install only the frontend workspace package after `cd frontend` (still use **pnpm** in this repo).

### Environment Setup

Create a `.env.local` file with:

```env
# platform-api (used by lib/api.ts and /dev-login)
NEXT_PUBLIC_API_URL=http://localhost:3001

# Tenant id for API query params (must match DB / auth; default tenant-default)
# NEXT_PUBLIC_DEFAULT_TENANT_ID=tenant-default

# Optional: Clerk — if unset/empty, the app does not enforce Clerk on dashboard routes
# (JWT dev login works without a Clerk session). Set both to use Clerk sign-in + protect().
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Optional: allow /dev-login when running `next start` (production build) for local demos
# NEXT_PUBLIC_ENABLE_DEV_LOGIN=true
```

### Development

```bash
pnpm dev
```

From repo root you can also run `pnpm dev:web`.

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Login (demo milestone — JWT / dev auth)

1. Run **platform-api** with **`CLERK_AUTH_ENABLED=false`** (see `apps/platform-api/env.example`) and a **`JWT_SECRET`**.
2. Seed or use an email that exists in the API auth store (`apps/platform-api` — `findUserByEmail`).
3. Open **`http://localhost:3000/dev-login`**, enter that email, submit. The app calls **`POST /auth/login`** and stores the bearer in **`localStorage`** (`auth_token`).

**Clerk:** If **`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`** is **not** set, the Next.js **`proxy`** does not run `auth.protect()`, so the dashboard is reachable after JWT dev login. If Clerk **is** configured, you need a Clerk session **or** use public routes only until the Clerk token bridge is implemented.

**Next.js 16:** Auth boundary lives in root **`proxy.ts`** (not `middleware.ts`).

## Project Structure

```
frontend/
├── app/
│   ├── (auth)/           # Authentication pages
│   │   └── login/
│   └── (dashboard)/      # Dashboard pages
│       ├── layout.tsx
│       ├── page.tsx      # Main dashboard
│       ├── live/         # Live calls monitoring
│       ├── history/      # Call history
│       ├── analytics/    # Analytics & insights
│       ├── agents/       # AI agent management
│       ├── knowledge/    # Knowledge base
│       ├── integrations/ # External integrations
│       └── billing/      # Billing & usage
├── components/
│   ├── ui/               # shadcn/ui components
│   ├── dashboard/        # Dashboard-specific components
│   └── layout/           # Layout components (sidebar, header)
├── lib/
│   ├── api.ts            # API client with typed functions
│   ├── types.ts          # TypeScript type definitions
│   └── utils.ts          # Utility functions
└── .env.local            # Environment variables
```

## API Integration

The frontend connects to the backend API at `http://localhost:3001` (configurable via `NEXT_PUBLIC_API_BASE_URL`).

Key endpoints used:
- `/auth/login` - Authentication
- `/analytics/aggregate` - Dashboard metrics
- `/analytics/calls` - Call records
- `/config/agents` - Agent management
- `/kb/docs` - Knowledge base
- `/tool/credentials` - Integration credentials
- `/health` - System health

See `lib/api.ts` for the complete API client implementation.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Data Fetching**: TanStack Query (React Query)
- **Charts**: Recharts
- **Tables**: TanStack Table
- **Icons**: Lucide React
- **Date Formatting**: date-fns

## Building for Production

```bash
npm run build
npm start
```

## Testing the Backend

This frontend provides a complete UI for testing all backend functionality:

1. **Start the backend**: Ensure `platform-api` is running on port 3001
2. **Login**: Use the local auth endpoint to authenticate
3. **Dashboard**: Verify metrics are loading from `/analytics/aggregate`
4. **Live Calls**: Check system status and active call monitoring
5. **Call History**: Test filtering and pagination
6. **Analytics**: Verify charts render with real data
7. **AI Agents**: Create/edit/delete agent configurations
8. **Knowledge Base**: Upload documents and monitor embedding status
9. **Integrations**: Save tool provider credentials

## Notes

- The frontend uses localStorage for token storage in development mode
- Real-time updates are achieved via polling (every 2-30 seconds depending on the data)
- Clerk integration is optional; local auth is used by default for testing
- All API responses are typed using TypeScript interfaces in `lib/types.ts`

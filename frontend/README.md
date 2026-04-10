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
# platform-api
NEXT_PUBLIC_API_URL=http://localhost:3001

# Organization id for API query params — use org_localdemo for seeded demo (see supabase/002_ui_tables.sql)
# NEXT_PUBLIC_DEFAULT_ORG_ID=org_localdemo

# Clerk-first auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

### Development

```bash
pnpm dev
```

From repo root you can also run `pnpm dev:web`.

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Login (Clerk-first)

1. Run **platform-api** in Clerk mode.
2. Open **`http://localhost:3000/sign-in`**.
3. Sign in with Clerk; frontend uses Clerk session JWT for API requests.

**Next.js 16:** Auth boundary lives in root **`proxy.ts`** (not `middleware.ts`).

## Project Structure

```
frontend/
├── app/
│   ├── (auth)/           # Authentication pages
│   │   ├── sign-in/
│   │   └── sign-up/
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
│   ├── api-client.ts     # HTTP client + Clerk token bridge helpers
│   ├── data/             # Domain data modules (dashboard, calls, analytics, etc.)
│   ├── types.ts          # TypeScript type definitions
│   └── utils.ts          # Utility functions
└── .env.local            # Environment variables
```

## API Integration

The frontend connects to the backend API at `http://localhost:3001` (configurable via `NEXT_PUBLIC_API_BASE_URL`).

Key endpoints used:
- `/auth/me` - Authenticated session identity
- `/calls` - Call records
- `/analytics/summary` - Dashboard metrics
- `/agents` - Agent management
- `/knowledge/documents` - Knowledge base
- `/credentials` - Integration credentials
- `/health` - System health

See `lib/api-client.ts` and `lib/data/*` for the API integration layer.

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
2. **Login**: Sign in via Clerk at `/sign-in`
3. **Dashboard**: Verify metrics are loading from `/analytics/summary`
4. **Live Calls**: Check system status and active call monitoring
5. **Call History**: Test filtering and pagination
6. **Analytics**: Verify charts render with real data
7. **AI Agents**: Create/edit/delete agent configurations
8. **Knowledge Base**: Upload documents and monitor embedding status
9. **Integrations**: Save tool provider credentials

## Notes

- The frontend stores auth token state for API calls and clears it on 401 responses
- Real-time updates are achieved via polling (every 2-30 seconds depending on the data)
- Clerk-first auth is required for dashboard usage
- All API responses are typed using TypeScript interfaces in `lib/types.ts`

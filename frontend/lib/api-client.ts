import {
  setAuthToken as syncAuthTokenFromApiModule,
  DEFAULT_TENANT_ID,
} from "./api";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:3001";

/** Matches `lib/api` dev-login / JWT storage so both clients stay in sync. */
const TOKEN_KEY = "auth_token";

// ============================================================================
// Pagination
// ============================================================================

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}

// ============================================================================
// API Response Envelope
// ============================================================================

interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

// ============================================================================
// Error
// ============================================================================

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown
  ) {
    super(
      `API ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`
    );
    this.name = "ApiError";
  }
}

// ============================================================================
// Auth Token
// ============================================================================

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  syncAuthTokenFromApiModule(null);
}

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

let customGetToken: (() => Promise<string | null>) | null = null;

/** When using Clerk, pass a getter that returns a fresh JWT (e.g. `getToken({ template })`). Falls back to localStorage. */
export function configureApiAuth(
  getter: (() => Promise<string | null>) | null
): void {
  customGetToken = getter;
}

async function resolveAuthToken(): Promise<string | null> {
  if (customGetToken) {
    try {
      const t = await customGetToken();
      if (t) return t;
    } catch {
      /* use storage fallback */
    }
  }
  return getStoredToken();
}

/**
 * `tenantId` query param for platform-api routes that accept
 * `request.auth?.tenant_id ?? query.tenantId` (e.g. when dev optional auth
 * did not attach claims). Prefers `tenant_id` from the stored JWT when present.
 */
export function resolveTenantIdForQuery(): string {
  const token = getStoredToken();
  if (token) {
    try {
      const parts = token.split(".");
      if (parts.length >= 2) {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const json = atob(b64);
        const payload = JSON.parse(json) as { tenant_id?: string };
        const tid = payload.tenant_id;
        if (typeof tid === "string" && tid.length > 0) return tid;
      }
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_TENANT_ID;
}

/** Appends `tenantId` for platform-api routes that use `auth ?? query.tenantId`. */
export function appendTenantQuery(path: string): string {
  const tenantId = encodeURIComponent(resolveTenantIdForQuery());
  return path.includes("?")
    ? `${path}&tenantId=${tenantId}`
    : `${path}?tenantId=${tenantId}`;
}

// ============================================================================
// Core Request
// ============================================================================

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = await resolveAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const parsed = isJson ? await res.json() : await res.text();

  if (res.status === 401) {
    clearAuthToken();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("rezovo:unauthorized"));
    }
    throw new ApiError(401, parsed);
  }

  if (!res.ok) {
    throw new ApiError(res.status, parsed);
  }

  if (
    isJson &&
    parsed !== null &&
    typeof parsed === "object" &&
    "data" in parsed
  ) {
    return (parsed as ApiResponse<T>).data;
  }

  return parsed as T;
}

// ============================================================================
// HTTP Methods
// ============================================================================

export async function get<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

export async function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PATCH", path, body);
}

export async function del<T>(path: string): Promise<T> {
  return request<T>("DELETE", path);
}

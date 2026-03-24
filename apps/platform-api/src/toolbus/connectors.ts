import { randomUUID } from "crypto";
import { Type, Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

type ConnectorCredentials = Record<string, string>;

export type ToolExecutionRequest = {
  toolName: string;
  provider?: string;
  args: Record<string, unknown>;
  credentials: ConnectorCredentials;
};

const MOCK_MODE = process.env.MOCK_CONNECTORS === "true";
const CALENDLY_BASE = process.env.CALENDLY_API_BASE ?? "https://api.calendly.com";
const GOOGLE_CALENDAR_BASE = process.env.GOOGLE_CALENDAR_API_BASE ?? "https://www.googleapis.com/calendar/v3";
const TWILIO_BASE = process.env.TWILIO_API_BASE ?? "https://api.twilio.com/2010-04-01";
const HUBSPOT_BASE = process.env.HUBSPOT_API_BASE ?? "https://api.hubapi.com";

// Accept both string and number IDs, normalize to string
const IdSchema = Type.Union([Type.String(), Type.Number()]);

async function parseJson<S extends TSchema>(
  res: Response,
  schema: S,
  context: string
): Promise<Static<S>> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`${context}: expected JSON but got '${ct}'. Body: ${text.slice(0, 300)}`);
  }

  const raw: unknown = await res.json();
  if (!Value.Check(schema, raw)) {
    throw new Error(`${context}: invalid JSON response shape`);
  }
  return raw as Static<S>;
}

const CalendlyResponseSchema = Type.Object(
  {
    resource: Type.Optional(
      Type.Object({
        uri: Type.Optional(Type.String()),
        status: Type.Optional(Type.String()),
      })
    ),
    uri: Type.Optional(Type.String()),
    id: Type.Optional(IdSchema), // Flexible: string or number
  },
  { additionalProperties: true }
);

const GoogleCalendarResponseSchema = Type.Object(
  {
    id: IdSchema, // Required but flexible type
    status: Type.Optional(Type.String()),
  },
  { additionalProperties: true }
);

const TwilioSmsResponseSchema = Type.Object(
  {
    sid: Type.String(), // Twilio SIDs are always strings
    status: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
  },
  { additionalProperties: true }
);

const HubspotResponseSchema = Type.Object(
  {
    id: IdSchema, // Required but flexible type
    properties: Type.Optional(
      Type.Object({
        hs_lifecyclestage: Type.Optional(Type.String()),
      })
    ),
  },
  { additionalProperties: true }
);

export async function executeToolCall(request: ToolExecutionRequest): Promise<unknown> {
  switch (request.toolName) {
    case "book_appointment":
      return handleBookAppointment(request);
    case "send_sms":
      return handleSendSms(request);
    case "crm_upsert_contact":
      return handleCrmUpsert(request);
    default:
      return {
        echo: true,
        toolName: request.toolName,
        provider: request.provider ?? "unknown",
        args: request.args
      };
  }
}

function shouldMock(credentials: ConnectorCredentials): boolean {
  return MOCK_MODE || Object.keys(credentials ?? {}).length === 0;
}

async function handleBookAppointment(request: ToolExecutionRequest): Promise<unknown> {
  const provider = request.provider ?? "calendly";
  if (provider === "google_calendar") {
    return bookWithGoogleCalendar(request.args, request.credentials);
  }
  return bookWithCalendly(request.args, request.credentials);
}

async function bookWithCalendly(args: Record<string, unknown>, credentials: ConnectorCredentials): Promise<unknown> {
  if (shouldMock(credentials)) {
    return {
      provider: "calendly",
      id: `cal-${randomUUID()}`,
      status: "mocked",
      scheduledFor: args.when ?? new Date().toISOString()
    };
  }
  const token = credentials.apiKey ?? credentials.personalToken ?? credentials.token;
  if (!token) {
    throw new Error("calendly credential apiKey required");
  }
  const eventType = (args.eventType as string) ?? credentials.eventType;
  const inviteeEmail = (args.inviteeEmail as string) ?? credentials.defaultInviteeEmail;
  if (!eventType || !inviteeEmail) {
    throw new Error("calendly eventType and inviteeEmail required");
  }
  const payload = {
    event: {
      start_time: args.when ?? new Date().toISOString(),
      end_time: args.endsAt ?? undefined,
      event_type: eventType,
      invitees: [
        {
          email: inviteeEmail,
          first_name: args.name ?? args.firstName ?? "Caller",
          last_name: args.lastName ?? ""
        }
      ],
      location: args.location ?? "phone"
    }
  };

  const res = await fetch(`${CALENDLY_BASE}/scheduled_events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errorText = await safeError(res);
    throw new Error(`Calendly booking failed: ${res.status} ${res.statusText} - ${errorText}`);
  }
  const json = await parseJson(res, CalendlyResponseSchema, "Calendly booking");
  const id = json.resource?.uri ?? json.uri ?? (json.id ? String(json.id) : undefined) ?? `cal-${randomUUID()}`;
  return {
    provider: "calendly",
    id,
    status: json.resource?.status ?? "requested",
    data: json
  };
}

async function bookWithGoogleCalendar(args: Record<string, unknown>, credentials: ConnectorCredentials): Promise<unknown> {
  if (shouldMock(credentials)) {
    return {
      provider: "google_calendar",
      id: `gcal-${randomUUID()}`,
      status: "mocked",
      scheduledFor: args.when ?? new Date().toISOString()
    };
  }
  const accessToken = credentials.accessToken;
  const calendarId = (args.calendarId as string) ?? credentials.calendarId;
  if (!accessToken || !calendarId) {
    throw new Error("google calendar credentials require accessToken and calendarId");
  }
  const payload = {
    summary: args.summary ?? "AI Receptionist Booking",
    description: args.description ?? args.reason ?? "Booked by AI receptionist",
    start: { dateTime: args.when ?? new Date().toISOString() },
    end: { dateTime: args.endsAt ?? args.when ?? new Date(Date.now() + 30 * 60 * 1000).toISOString() },
    attendees: (args.attendees as Array<{ email: string }>) ?? [{ email: args.email ?? credentials.defaultInviteeEmail }].filter(Boolean)
  };
  const res = await fetch(`${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errorText = await safeError(res);
    throw new Error(`Google Calendar booking failed: ${res.status} ${res.statusText} - ${errorText}`);
  }
  const json = await parseJson(res, GoogleCalendarResponseSchema, "Google Calendar booking");
  return {
    provider: "google_calendar",
    id: String(json.id), // Normalize to string
    status: json.status ?? "confirmed",
    data: json
  };
}

async function handleSendSms(request: ToolExecutionRequest): Promise<unknown> {
  const provider = request.provider ?? "twilio";
  if (provider !== "twilio") {
    throw new Error(`unsupported sms provider: ${provider}`);
  }
  return sendSmsViaTwilio(request.args, request.credentials);
}

async function sendSmsViaTwilio(args: Record<string, unknown>, credentials: ConnectorCredentials): Promise<unknown> {
  if (shouldMock(credentials)) {
    return {
      provider: "twilio",
      sid: `sms-${randomUUID()}`,
      status: "mocked",
      to: args.to,
      body: args.body
    };
  }
  const accountSid = credentials.accountSid;
  const authToken = credentials.authToken;
  const from = (args.from as string) ?? credentials.from;
  const to = args.to as string;
  const body = args.body as string;
  if (!accountSid || !authToken || !from || !to || !body) {
    throw new Error("twilio credentials require accountSid, authToken, from, to, and body");
  }
  const url = `${TWILIO_BASE}/Accounts/${accountSid}/Messages.json`;
  const payload = new URLSearchParams();
  payload.set("From", from);
  payload.set("To", to);
  payload.set("Body", body);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload.toString()
  });
  if (!res.ok) {
    const errorText = await safeError(res);
    throw new Error(`Twilio SMS failed: ${res.status} ${res.statusText} - ${errorText}`);
  }
  const json = await parseJson(res, TwilioSmsResponseSchema, "Twilio SMS");
  return {
    provider: "twilio",
    sid: json.sid,
    status: json.status ?? "queued",
    to: json.to
  };
}

async function handleCrmUpsert(request: ToolExecutionRequest): Promise<unknown> {
  const provider = request.provider ?? "hubspot";
  if (provider !== "hubspot") {
    throw new Error(`unsupported crm provider: ${provider}`);
  }
  return upsertHubspotContact(request.args, request.credentials);
}

async function upsertHubspotContact(args: Record<string, unknown>, credentials: ConnectorCredentials): Promise<unknown> {
  if (shouldMock(credentials)) {
    return {
      provider: "hubspot",
      id: `hubspot-${randomUUID()}`,
      status: "mocked",
      email: args.email
    };
  }
  const accessToken = credentials.accessToken ?? credentials.apiKey;
  if (!accessToken) {
    throw new Error("hubspot access token required");
  }
  const payload = {
    properties: {
      email: args.email,
      firstname: args.firstName ?? args.firstname,
      lastname: args.lastName ?? args.lastname,
      phone: args.phone,
      notes: args.notes ?? args.reason
    }
  };
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errorText = await safeError(res);
    throw new Error(`HubSpot contact upsert failed: ${res.status} ${res.statusText} - ${errorText}`);
  }
  const json = await parseJson(res, HubspotResponseSchema, "HubSpot contact upsert");
  return {
    provider: "hubspot",
    id: String(json.id), // Normalize to string
    status: json.properties?.hs_lifecyclestage ?? "created",
    data: json
  };
}

async function safeError(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}


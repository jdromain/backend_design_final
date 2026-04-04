"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Phone,
  Mic,
  Volume2,
  Brain,
  Wrench,
  Puzzle,
  Power,
} from "lucide-react"
import { cn } from "@/lib/utils"

/** UI pill states (platform-api uses ok | error | disabled | degraded on rows) */
export type ServiceStatus = "operational" | "degraded" | "outage" | "disabled"

export interface ServiceHealth {
  name: string
  /** Mock/UI: operational | degraded | outage. API: ok | error | disabled | degraded */
  status: ServiceStatus | string
  latency?: number
  latencyMs?: number
  message?: string
}

export interface SystemHealthData {
  overall: ServiceStatus | string
  telephony: ServiceHealth[]
  stt: ServiceHealth[]
  tts: ServiceHealth[]
  llm: ServiceHealth[]
  tools: ServiceHealth[]
  integrations: ServiceHealth[]
}

interface SystemHealthModalProps {
  data: SystemHealthData
}

const statusConfig = {
  operational: {
    label: "Operational",
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-500/10",
    badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  degraded: {
    label: "Degraded",
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-500/10",
    badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  outage: {
    label: "Outage",
    icon: XCircle,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-500/10",
    badgeClass: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  disabled: {
    label: "Disabled",
    icon: Power,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
} satisfies Record<
  ServiceStatus,
  { label: string; icon: typeof CheckCircle2; color: string; bgColor: string; badgeClass: string }
>

/** Map GET /health row status into UI status keys */
export function mapApiHealthStatus(raw: string): ServiceStatus {
  const s = String(raw).toLowerCase()
  if (s === "operational" || s === "ok" || s === "healthy") return "operational"
  if (s === "degraded") return "degraded"
  if (s === "outage" || s === "error" || s === "failed") return "outage"
  if (s === "disabled") return "disabled"
  return "degraded"
}

function normalizeOverall(raw: string | undefined): keyof typeof statusConfig {
  if (raw === "operational" || raw === "degraded" || raw === "outage") return raw
  if (raw == null || raw === "") return "operational"
  const mapped = mapApiHealthStatus(raw)
  if (mapped === "disabled") return "operational"
  return mapped
}

const sectionIcons = {
  telephony: Phone,
  stt: Mic,
  tts: Volume2,
  llm: Brain,
  tools: Wrench,
  integrations: Puzzle,
}

function StatusPill({ status }: { status: ServiceStatus }) {
  const config = statusConfig[status]
  const PillIcon = config.icon

  return (
    <Badge variant="outline" className={cn("gap-1", config.badgeClass)}>
      <PillIcon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}

function ServiceRow({ service }: { service: ServiceHealth }) {
  const uiStatus = mapApiHealthStatus(service.status)
  const config = statusConfig[uiStatus]
  const RowIcon = config.icon
  const latencyMs = service.latency ?? service.latencyMs

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className={cn("p-1 rounded", config.bgColor)}>
          <RowIcon className={cn("h-3.5 w-3.5", config.color)} />
        </div>
        <div>
          <p className="text-sm font-medium">{service.name}</p>
          {service.message && (
            <p className="text-xs text-muted-foreground">{service.message}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {latencyMs !== undefined && (
          <span className="text-xs text-muted-foreground">{latencyMs}ms</span>
        )}
        <StatusPill status={uiStatus} />
      </div>
    </div>
  )
}

function ServiceSection({
  title,
  icon: sectionKey,
  services,
}: {
  title: string
  icon: keyof typeof sectionIcons
  services: ServiceHealth[]
}) {
  const Icon = sectionIcons[sectionKey]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <div className="space-y-1 pl-6">
        {services.map((service) => (
          <ServiceRow key={service.name} service={service} />
        ))}
      </div>
    </div>
  )
}

export function SystemHealthModal({ data }: SystemHealthModalProps) {
  const overall = normalizeOverall(data.overall)
  const config = statusConfig[overall]
  const HeaderIcon = config.icon

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className={cn("gap-2 rounded-full px-3 py-1.5 h-auto", config.bgColor)}
        >
          <span className="relative flex h-2 w-2">
            <span
              className={cn(
                "absolute inline-flex h-full w-full rounded-full opacity-75",
                overall === "operational" && "animate-ping bg-emerald-400",
                overall === "degraded" && "animate-pulse bg-amber-400",
                overall === "outage" && "animate-ping bg-red-400"
              )}
            />
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                overall === "operational" && "bg-emerald-500",
                overall === "degraded" && "bg-amber-500",
                overall === "outage" && "bg-red-500"
              )}
            />
          </span>
          <span className={cn("text-sm font-medium", config.color)}>
            {config.label}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeaderIcon className={cn("h-5 w-5", config.color)} />
            System Health
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <ServiceSection title="Telephony" icon="telephony" services={data.telephony} />
          <Separator />
          <ServiceSection title="Speech-to-Text" icon="stt" services={data.stt} />
          <Separator />
          <ServiceSection title="Text-to-Speech" icon="tts" services={data.tts} />
          <Separator />
          <ServiceSection title="LLM" icon="llm" services={data.llm} />
          <Separator />
          <ServiceSection title="Tools" icon="tools" services={data.tools} />
          <Separator />
          <ServiceSection title="Integrations" icon="integrations" services={data.integrations} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

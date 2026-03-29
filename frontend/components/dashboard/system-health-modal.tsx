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
} from "lucide-react"
import { cn } from "@/lib/utils"

export type ServiceStatus = "operational" | "degraded" | "outage"

export interface ServiceHealth {
  name: string
  status: ServiceStatus
  latency?: number
  message?: string
}

export interface SystemHealthData {
  overall: ServiceStatus
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
  const Icon = config.icon

  return (
    <Badge variant="outline" className={cn("gap-1", config.badgeClass)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}

function ServiceRow({ service }: { service: ServiceHealth }) {
  const config = statusConfig[service.status]
  const Icon = config.icon

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className={cn("p-1 rounded", config.bgColor)}>
          <Icon className={cn("h-3.5 w-3.5", config.color)} />
        </div>
        <div>
          <p className="text-sm font-medium">{service.name}</p>
          {service.message && (
            <p className="text-xs text-muted-foreground">{service.message}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {service.latency !== undefined && (
          <span className="text-xs text-muted-foreground">{service.latency}ms</span>
        )}
        <StatusPill status={service.status} />
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
  const config = statusConfig[data.overall]
  const OverallIcon = config.icon

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
                data.overall === "operational" && "animate-ping bg-emerald-400",
                data.overall === "degraded" && "animate-pulse bg-amber-400",
                data.overall === "outage" && "animate-ping bg-red-400"
              )}
            />
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                data.overall === "operational" && "bg-emerald-500",
                data.overall === "degraded" && "bg-amber-500",
                data.overall === "outage" && "bg-red-500"
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
            <OverallIcon className={cn("h-5 w-5", config.color)} />
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

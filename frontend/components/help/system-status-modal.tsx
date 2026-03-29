"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Copy, Check, CheckCircle, AlertTriangle, XCircle } from "lucide-react"
import { useState } from "react"

interface SystemStatusModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const mockHealthResponse = {
  status: "healthy",
  timestamp: new Date().toISOString(),
  services: {
    api: { status: "operational", latency: "42ms" },
    telephony: { status: "operational", latency: "18ms" },
    llm_gateway: { status: "operational", latency: "156ms" },
    knowledge_base: { status: "operational", latency: "23ms" },
    redis: { status: "operational", latency: "2ms" },
    postgres: { status: "operational", latency: "8ms" },
  },
  version: "v2.4.1",
  region: "us-east-1",
}

export function SystemStatusModal({ open, onOpenChange }: SystemStatusModalProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(mockHealthResponse, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const statusIcons = {
    operational: <CheckCircle className="h-4 w-4 text-emerald-400" />,
    degraded: <AlertTriangle className="h-4 w-4 text-amber-400" />,
    outage: <XCircle className="h-4 w-4 text-red-400" />,
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            System Status
            <Badge className="bg-emerald-500/10 text-emerald-400">Healthy</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(mockHealthResponse.services).map(([name, service]) => (
              <div key={name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <span className="text-sm capitalize">{name.replace("_", " ")}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">{service.latency}</span>
                  {statusIcons[service.status as keyof typeof statusIcons]}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Raw Response</span>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-48">
              {JSON.stringify(mockHealthResponse, null, 2)}
            </pre>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Region: {mockHealthResponse.region}</span>
            <span>Version: {mockHealthResponse.version}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

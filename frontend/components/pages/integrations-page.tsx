"use client"

import { useState, useCallback, useEffect } from "react"
import {
  CheckCircle,
  Settings,
  AlertTriangle,
  XCircle,
  Eye,
  EyeOff,
  Copy,
  TestTube,
  History,
  Unplug,
  Loader2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { TableSkeleton } from "@/components/loading-skeleton"
import { EmptyState } from "@/components/empty-state"
import { toast } from "@/hooks/use-toast"
import { getUiCapabilities } from "@/lib/data/capabilities"
import {
  disconnectIntegration,
  getIntegrationLogs,
  getIntegrations,
  saveIntegrationConfig,
  testIntegration,
} from "@/lib/data/integrations"

interface Integration {
  id: string
  name: string
  description: string
  icon: string
  status: "connected" | "disconnected" | "degraded" | "error"
  lastSync?: string
  config?: Record<string, string>
  requiredFields: { key: string; label: string; type: "text" | "password"; placeholder?: string }[]
}

interface LogEntry {
  id: string
  timestamp: string
  action: string
  status: "success" | "error" | "warning"
  details?: string
}

const integrationLogsById: Record<string, LogEntry[]> = {}

export function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null)
  const [logsDrawerOpen, setLogsDrawerOpen] = useState(false)
  const [logsIntegration, setLogsIntegration] = useState<Integration | null>(null)
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false)
  const [disconnectTarget, setDisconnectTarget] = useState<Integration | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [caps, setCaps] = useState({
    liveProbe: false,
    logs: false,
    disconnect: false,
    configure: false,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setIsLoading(true)
      try {
        const data = await getIntegrations()
        if (!cancelled) {
          setIntegrations(data)
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          toast({
            title: "Could not load integrations",
            description: "Try again later or check your connection.",
            variant: "destructive",
          })
          setIntegrations([])
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void getUiCapabilities().then((c) =>
      setCaps({
        liveProbe: c.integrations.liveProbe,
        logs: c.integrations.logs,
        disconnect: c.integrations.disconnect,
        configure: c.integrations.configure,
      }),
    )
  }, [])

  const statusConfig = {
    connected: {
      label: "Connected",
      color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      icon: CheckCircle,
    },
    disconnected: { label: "Disconnected", color: "bg-muted text-muted-foreground", icon: Unplug },
    degraded: {
      label: "Degraded",
      color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      icon: AlertTriangle,
    },
    error: { label: "Error", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: XCircle },
  }

  const handleConfigure = useCallback((integration: Integration) => {
    setSelectedIntegration(integration)
    setFormValues(integration.config || {})
    setConfigModalOpen(true)
  }, [])

  const handleSaveConfig = useCallback(async () => {
    if (!selectedIntegration) return
    if (!caps.configure) {
      toast({
        title: "Configuration unavailable",
        description: "This environment has not enabled integration configuration endpoints yet.",
        variant: "destructive",
      })
      return
    }
    setIsSaving(true)

    await saveIntegrationConfig(selectedIntegration.id, formValues)

    setIntegrations((prev) =>
      prev.map((i) =>
        i.id === selectedIntegration.id
          ? { ...i, status: "connected", config: formValues, lastSync: new Date().toISOString() }
          : i,
      ),
    )
    setIsSaving(false)
    setConfigModalOpen(false)
    toast({ title: "Integration Configured", description: `${selectedIntegration.name} has been connected.` })
  }, [caps.configure, selectedIntegration, formValues])

  const handleTestConnection = useCallback(async () => {
    if (!selectedIntegration) return
    if (!caps.liveProbe) {
      toast({
        title: "Live probe unavailable",
        description: "Backend capability for integration connectivity checks is disabled.",
      })
      return
    }
    setIsTesting(true)

    const result = await testIntegration(selectedIntegration.id)

    setIsTesting(false)
    toast({
      title: result.valid ? "Connection healthy" : "Connection issue",
      description: result.message,
    })
  }, [caps.liveProbe, selectedIntegration])

  const handleDisconnect = useCallback((integration: Integration) => {
    if (!caps.disconnect) {
      toast({
        title: "Disconnect unavailable",
        description: "Backend capability for disconnect is disabled in this environment.",
      })
      return
    }
    setDisconnectTarget(integration)
    setDisconnectConfirmOpen(true)
  }, [caps.disconnect])

  const handleConfirmDisconnect = useCallback(() => {
    if (!disconnectTarget) return
    void disconnectIntegration(disconnectTarget.id)
    setIntegrations((prev) =>
      prev.map((i) =>
        i.id === disconnectTarget.id ? { ...i, status: "disconnected", config: undefined, lastSync: undefined } : i,
      ),
    )
    setDisconnectConfirmOpen(false)
    toast({ title: "Integration Disconnected", description: `${disconnectTarget.name} has been disconnected.` })
  }, [disconnectTarget])

  const handleViewLogs = useCallback((integration: Integration) => {
    if (!caps.logs) {
      toast({
        title: "Logs unavailable",
        description: "Integration sync logs are not available from the backend yet.",
      })
      return
    }
    void getIntegrationLogs(integration.id)
      .then((logs) => {
        integrationLogsById[integration.id] = logs
        setLogsIntegration(integration)
        setLogsDrawerOpen(true)
      })
      .catch(() => {
        toast({
          title: "Logs unavailable",
          description: "Could not load integration logs.",
          variant: "destructive",
        })
      })
  }, [caps.logs])

  const handleCopyValue = useCallback((value: string) => {
    navigator.clipboard.writeText(value)
    toast({ title: "Copied", description: "Value copied to clipboard" })
  }, [])

  const toggleShowSecret = useCallback((key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Integrations</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <TableSkeleton rows={3} columns={1} />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Integrations</h1>
      {(!caps.configure || !caps.liveProbe || !caps.logs || !caps.disconnect) && (
        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground">
            Some integration actions are disabled because backend capabilities are not enabled in this environment.
          </CardContent>
        </Card>
      )}

      {!isLoading && integrations.length === 0 ? (
        <EmptyState
          title="No integrations yet"
          description="None were returned from the API. Connect integrations in your workspace or enable mocks for demo data."
          variant="search"
        />
      ) : (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          const status = statusConfig[integration.status]
          const StatusIcon = status.icon
          return (
            <Card key={integration.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-4xl">{integration.icon}</div>
                    <div>
                      <CardTitle>{integration.name}</CardTitle>
                      <Badge className={`mt-1 ${status.color}`}>
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {status.label}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="mb-2">{integration.description}</CardDescription>
                {integration.lastSync && (
                  <p className="text-xs text-muted-foreground mb-4">
                    Last sync: {new Date(integration.lastSync).toLocaleString()}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant={integration.status === "disconnected" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => handleConfigure(integration)}
                    disabled={!caps.configure}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    {integration.status === "disconnected" ? "Connect" : "Configure"}
                  </Button>
                  {integration.status !== "disconnected" && (
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 bg-transparent"
                        onClick={() => handleViewLogs(integration)}
                        disabled={!caps.logs}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 text-destructive bg-transparent"
                        onClick={() => handleDisconnect(integration)}
                        disabled={!caps.disconnect}
                      >
                        <Unplug className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      )}

      {/* Configure Modal */}
      <Dialog open={configModalOpen} onOpenChange={setConfigModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-2xl">{selectedIntegration?.icon}</span>
              Configure {selectedIntegration?.name}
            </DialogTitle>
            <DialogDescription>{selectedIntegration?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedIntegration?.requiredFields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={field.key}>{field.label}</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id={field.key}
                      type={field.type === "password" && !showSecrets[field.key] ? "password" : "text"}
                      placeholder={field.placeholder}
                      value={formValues[field.key] || ""}
                      onChange={(e) => setFormValues({ ...formValues, [field.key]: e.target.value })}
                    />
                  </div>
                  {field.type === "password" && (
                    <Button variant="outline" size="icon" onClick={() => toggleShowSecret(field.key)}>
                      {showSecrets[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  )}
                  {formValues[field.key] && (
                    <Button variant="outline" size="icon" onClick={() => handleCopyValue(formValues[field.key])}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleTestConnection} disabled={isTesting || !caps.liveProbe}>
              {isTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
              Test Connection
            </Button>
            <Button onClick={handleSaveConfig} disabled={isSaving || !caps.configure}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Save & Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs Drawer */}
      <Sheet open={logsDrawerOpen} onOpenChange={setLogsDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <span className="text-xl">{logsIntegration?.icon}</span>
              {logsIntegration?.name} Logs
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-8rem)] mt-4">
            <div className="space-y-3">
              {(integrationLogsById[logsIntegration?.id || ""] || []).map((log) => (
                <div key={log.id} className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{log.action}</span>
                    <Badge
                      variant={
                        log.status === "success" ? "secondary" : log.status === "warning" ? "outline" : "destructive"
                      }
                    >
                      {log.status}
                    </Badge>
                  </div>
                  {log.details && <p className="text-sm text-muted-foreground mt-1">{log.details}</p>}
                  <p className="text-xs text-muted-foreground mt-2">{new Date(log.timestamp).toLocaleString()}</p>
                </div>
              ))}
              {(!integrationLogsById[logsIntegration?.id || ""] ||
                integrationLogsById[logsIntegration?.id || ""].length === 0) && (
                <p className="text-muted-foreground text-center py-8">No logs available</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Disconnect Confirm */}
      <ConfirmDialog
        open={disconnectConfirmOpen}
        onOpenChange={setDisconnectConfirmOpen}
        title={`Disconnect ${disconnectTarget?.name}?`}
        description="This will remove the integration and all stored credentials. Any agents using this integration may stop working."
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={handleConfirmDisconnect}
      />
    </div>
  )
}

"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Key, Plus, Copy, Check, Eye, EyeOff, RefreshCw, Send } from "lucide-react"

export interface ApiKey {
  id: string
  name: string
  prefix: string
  created: string
  lastUsed: string
  status: "active" | "revoked"
}

interface WebhookConfig {
  endpoint: string
  events: string[]
  signingSecret: string
}

interface DeveloperPanelProps {
  apiKeys: ApiKey[]
  webhook: WebhookConfig
  onCreateKey: (name: string) => string
  onRevokeKey: (id: string) => void
  onUpdateWebhook: (config: WebhookConfig) => void
  onTestWebhook: () => void
  onRotateSecret: () => void
}

export function DeveloperPanel({
  apiKeys,
  webhook,
  onCreateKey,
  onRevokeKey,
  onUpdateWebhook,
  onTestWebhook,
  onRotateSecret,
}: DeveloperPanelProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const handleCreateKey = () => {
    if (newKeyName) {
      const key = onCreateKey(newKeyName)
      setGeneratedKey(key)
    }
  }

  const handleCloseCreate = () => {
    setCreateOpen(false)
    setNewKeyName("")
    setGeneratedKey(null)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleEvent = (event: string) => {
    const newEvents = webhook.events.includes(event)
      ? webhook.events.filter((e) => e !== event)
      : [...webhook.events, event]
    onUpdateWebhook({ ...webhook, events: newEvents })
  }

  const eventOptions = [
    { id: "calls", label: "Call events", desc: "Call started, ended, escalated" },
    { id: "incidents", label: "Incident events", desc: "Created, updated, resolved" },
    { id: "kb", label: "Knowledge Base events", desc: "Document processed, failed" },
    { id: "billing", label: "Billing events", desc: "Threshold alerts, invoices" },
  ]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>API Keys</CardTitle>
            <CardDescription>Manage API keys for programmatic access</CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create API Key
          </Button>
        </CardHeader>
        <CardContent>
          {apiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Key className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No API keys</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">Create an API key to access the Rezovo API</p>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create your first key
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="text-sm bg-muted px-2 py-1 rounded">{key.prefix}•••••••</code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{key.created}</TableCell>
                    <TableCell className="text-muted-foreground">{key.lastUsed}</TableCell>
                    <TableCell>
                      <Badge variant={key.status === "active" ? "default" : "secondary"}>{key.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {key.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRevokeKey(key.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhooks</CardTitle>
          <CardDescription>Receive real-time event notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              placeholder="https://your-server.com/webhook"
              value={webhook.endpoint}
              onChange={(e) => onUpdateWebhook({ ...webhook, endpoint: e.target.value })}
            />
          </div>

          <div className="space-y-3">
            <Label>Event subscriptions</Label>
            {eventOptions.map((event) => (
              <div key={event.id} className="flex items-start gap-3">
                <Checkbox
                  id={event.id}
                  checked={webhook.events.includes(event.id)}
                  onCheckedChange={() => toggleEvent(event.id)}
                />
                <div className="grid gap-0.5">
                  <label htmlFor={event.id} className="text-sm font-medium cursor-pointer">
                    {event.label}
                  </label>
                  <p className="text-sm text-muted-foreground">{event.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label>Signing secret</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={webhook.signingSecret}
                  readOnly
                  className="pr-20"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowSecret(!showSecret)}>
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => copyToClipboard(webhook.signingSecret)}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <Button variant="outline" onClick={onRotateSecret}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Rotate
              </Button>
            </div>
          </div>

          <Button variant="outline" onClick={onTestWebhook} disabled={!webhook.endpoint}>
            <Send className="mr-2 h-4 w-4" />
            Send test event
          </Button>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={handleCloseCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{generatedKey ? "API Key Created" : "Create API Key"}</DialogTitle>
            <DialogDescription>
              {generatedKey
                ? "Copy your API key now. You won't be able to see it again."
                : "Give your API key a descriptive name"}
            </DialogDescription>
          </DialogHeader>
          {generatedKey ? (
            <div className="space-y-4 py-4">
              <div className="p-4 bg-muted rounded-lg">
                <code className="text-sm break-all">{generatedKey}</code>
              </div>
              <Button className="w-full" onClick={() => copyToClipboard(generatedKey)}>
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? "Copied!" : "Copy to clipboard"}
              </Button>
            </div>
          ) : (
            <>
              <div className="py-4">
                <Label htmlFor="key-name">Key name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g. Production API"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="mt-2"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseCreate}>
                  Cancel
                </Button>
                <Button onClick={handleCreateKey} disabled={!newKeyName}>
                  Create Key
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

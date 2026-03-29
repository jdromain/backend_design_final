"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { X, Plus, Shield, LogOut, History } from "lucide-react"

interface SecuritySettings {
  mfaRequired: boolean
  allowedDomains: string[]
}

interface AuditEvent {
  id: string
  action: string
  user: string
  timestamp: string
  details: string
}

interface SecurityPanelProps {
  settings: SecuritySettings
  onChange: (settings: SecuritySettings) => void
  auditEvents: AuditEvent[]
  onSignOutAll: () => void
}

export function SecurityPanel({ settings, onChange, auditEvents, onSignOutAll }: SecurityPanelProps) {
  const [newDomain, setNewDomain] = useState("")
  const [auditLogOpen, setAuditLogOpen] = useState(false)

  const addDomain = () => {
    if (newDomain && !settings.allowedDomains.includes(newDomain)) {
      onChange({
        ...settings,
        allowedDomains: [...settings.allowedDomains, newDomain],
      })
      setNewDomain("")
    }
  }

  const removeDomain = (domain: string) => {
    onChange({
      ...settings,
      allowedDomains: settings.allowedDomains.filter((d) => d !== domain),
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>Configure security requirements for your workspace</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Require MFA</p>
                <p className="text-sm text-muted-foreground">All team members must enable two-factor authentication</p>
              </div>
            </div>
            <Switch checked={settings.mfaRequired} onCheckedChange={(v) => onChange({ ...settings, mfaRequired: v })} />
          </div>

          <div className="space-y-3">
            <div>
              <Label>Allowed email domains</Label>
              <p className="text-sm text-muted-foreground">
                Restrict sign-ups to specific email domains (leave empty to allow all)
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. acmecorp.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addDomain()}
              />
              <Button onClick={addDomain} disabled={!newDomain}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {settings.allowedDomains.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {settings.allowedDomains.map((domain) => (
                  <Badge key={domain} variant="secondary" className="gap-1 pr-1">
                    @{domain}
                    <button onClick={() => removeDomain(domain)} className="ml-1 hover:bg-muted rounded-full p-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Manage active sessions across your workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={onSignOutAll}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out all sessions
          </Button>
          <p className="text-sm text-muted-foreground mt-2">This will sign out all users from all devices</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Audit Log</CardTitle>
            <CardDescription>Recent security events in your workspace</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAuditLogOpen(true)}>
            <History className="mr-2 h-4 w-4" />
            View full log
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {auditEvents.slice(0, 5).map((event) => (
              <div key={event.id} className="flex items-start justify-between border-b pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium">{event.action}</p>
                  <p className="text-sm text-muted-foreground">
                    {event.user} · {event.details}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{event.timestamp}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={auditLogOpen} onOpenChange={setAuditLogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit Log</DialogTitle>
            <DialogDescription>Complete history of security events</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-medium">{event.action}</TableCell>
                    <TableCell>{event.user}</TableCell>
                    <TableCell className="text-muted-foreground">{event.details}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{event.timestamp}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const defaultSecuritySettings: SecuritySettings = {
  mfaRequired: false,
  allowedDomains: ["acmecorp.com"],
}

export const mockAuditEvents: AuditEvent[] = [
  {
    id: "1",
    action: "Member invited",
    user: "john@acmecorp.com",
    timestamp: "2 hours ago",
    details: "Invited sarah@acmecorp.com as Editor",
  },
  {
    id: "2",
    action: "API key created",
    user: "john@acmecorp.com",
    timestamp: "1 day ago",
    details: "Created key 'Production API'",
  },
  {
    id: "3",
    action: "Role changed",
    user: "admin@acmecorp.com",
    timestamp: "2 days ago",
    details: "Changed mike@acmecorp.com to Admin",
  },
  {
    id: "4",
    action: "Member removed",
    user: "admin@acmecorp.com",
    timestamp: "3 days ago",
    details: "Removed olduser@acmecorp.com",
  },
  {
    id: "5",
    action: "MFA enabled",
    user: "john@acmecorp.com",
    timestamp: "5 days ago",
    details: "Enabled MFA requirement",
  },
  {
    id: "6",
    action: "Webhook created",
    user: "dev@acmecorp.com",
    timestamp: "1 week ago",
    details: "Added webhook endpoint",
  },
  {
    id: "7",
    action: "API key revoked",
    user: "admin@acmecorp.com",
    timestamp: "1 week ago",
    details: "Revoked key 'Old API Key'",
  },
  {
    id: "8",
    action: "Domain added",
    user: "admin@acmecorp.com",
    timestamp: "2 weeks ago",
    details: "Added acmecorp.com to allowed domains",
  },
]

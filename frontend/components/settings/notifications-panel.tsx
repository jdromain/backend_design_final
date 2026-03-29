"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { X, Plus, Slack } from "lucide-react"

interface NotificationSettings {
  emailRecipients: string[]
  slackConnected: boolean
  alerts: {
    incidentChanges: boolean
    failureRateSpike: boolean
    toolFailuresSpike: boolean
    kbProcessingFailures: boolean
    billing80: boolean
    billing90: boolean
    billing100: boolean
  }
  quietHours: {
    enabled: boolean
    start: string
    end: string
  }
}

interface NotificationsPanelProps {
  settings: NotificationSettings
  onChange: (settings: NotificationSettings) => void
}

export function NotificationsPanel({ settings, onChange }: NotificationsPanelProps) {
  const [newEmail, setNewEmail] = useState("")

  const addEmail = () => {
    if (newEmail && !settings.emailRecipients.includes(newEmail)) {
      onChange({
        ...settings,
        emailRecipients: [...settings.emailRecipients, newEmail],
      })
      setNewEmail("")
    }
  }

  const removeEmail = (email: string) => {
    onChange({
      ...settings,
      emailRecipients: settings.emailRecipients.filter((e) => e !== email),
    })
  }

  const toggleAlert = (key: keyof NotificationSettings["alerts"]) => {
    onChange({
      ...settings,
      alerts: { ...settings.alerts, [key]: !settings.alerts[key] },
    })
  }

  const updateQuietHours = (field: string, value: string | boolean) => {
    onChange({
      ...settings,
      quietHours: { ...settings.quietHours, [field]: value },
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Email Recipients</CardTitle>
          <CardDescription>Who should receive alert emails</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="Add email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addEmail()}
            />
            <Button onClick={addEmail} disabled={!newEmail}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {settings.emailRecipients.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {settings.emailRecipients.map((email) => (
                <Badge key={email} variant="secondary" className="gap-1 pr-1">
                  {email}
                  <button onClick={() => removeEmail(email)} className="ml-1 hover:bg-muted rounded-full p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Connect external notification channels</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#4A154B] flex items-center justify-center">
                <Slack className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-medium">Slack</p>
                <p className="text-sm text-muted-foreground">
                  {settings.slackConnected ? "Connected to #alerts" : "Not connected"}
                </p>
              </div>
            </div>
            <Button variant={settings.slackConnected ? "outline" : "default"}>
              {settings.slackConnected ? "Manage" : "Connect"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alert Rules</CardTitle>
          <CardDescription>Configure which events trigger notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Operations</h4>
            {[
              {
                key: "incidentChanges",
                label: "Incident status changes",
                desc: "When incidents are created or resolved",
              },
              {
                key: "failureRateSpike",
                label: "Failure rate spike",
                desc: "When call failure rate exceeds threshold",
              },
              {
                key: "toolFailuresSpike",
                label: "Tool failures spike",
                desc: "When tool error rate exceeds threshold",
              },
              { key: "kbProcessingFailures", label: "KB processing failures", desc: "When document processing fails" },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
                <Switch
                  checked={settings.alerts[key as keyof typeof settings.alerts]}
                  onCheckedChange={() => toggleAlert(key as keyof typeof settings.alerts)}
                />
              </div>
            ))}
          </div>

          <div className="border-t pt-4 space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Billing</h4>
            {[
              { key: "billing80", label: "80% usage threshold" },
              { key: "billing90", label: "90% usage threshold" },
              { key: "billing100", label: "100% usage threshold" },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <p className="text-sm font-medium">{label}</p>
                <Switch
                  checked={settings.alerts[key as keyof typeof settings.alerts]}
                  onCheckedChange={() => toggleAlert(key as keyof typeof settings.alerts)}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quiet Hours</CardTitle>
          <CardDescription>Pause non-critical alerts during specific hours</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable quiet hours</p>
              <p className="text-sm text-muted-foreground">Only critical alerts will be sent</p>
            </div>
            <Switch checked={settings.quietHours.enabled} onCheckedChange={(v) => updateQuietHours("enabled", v)} />
          </div>
          {settings.quietHours.enabled && (
            <div className="flex items-center gap-4 pl-4 border-l-2 border-muted">
              <div className="space-y-1">
                <Label>Start</Label>
                <Input
                  type="time"
                  value={settings.quietHours.start}
                  onChange={(e) => updateQuietHours("start", e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="space-y-1">
                <Label>End</Label>
                <Input
                  type="time"
                  value={settings.quietHours.end}
                  onChange={(e) => updateQuietHours("end", e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const defaultNotificationSettings: NotificationSettings = {
  emailRecipients: ["ops@acmecorp.com", "alerts@acmecorp.com"],
  slackConnected: true,
  alerts: {
    incidentChanges: true,
    failureRateSpike: true,
    toolFailuresSpike: true,
    kbProcessingFailures: false,
    billing80: true,
    billing90: true,
    billing100: true,
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
  },
}

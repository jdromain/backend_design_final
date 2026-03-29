"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"

const timezones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
]

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

interface WorkspaceSettings {
  name: string
  timezone: string
  businessHours: { day: string; enabled: boolean; start: string; end: string }[]
  defaultDateRange: string
  autoRefresh: boolean
  autoRefreshInterval: string
}

interface WorkspacePanelProps {
  settings: WorkspaceSettings
  onChange: (settings: WorkspaceSettings) => void
  onReset: () => void
}

export function WorkspacePanel({ settings, onChange, onReset }: WorkspacePanelProps) {
  const updateField = <K extends keyof WorkspaceSettings>(field: K, value: WorkspaceSettings[K]) => {
    onChange({ ...settings, [field]: value })
  }

  const updateBusinessHour = (index: number, field: string, value: string | boolean) => {
    const newHours = [...settings.businessHours]
    newHours[index] = { ...newHours[index], [field]: value }
    onChange({ ...settings, businessHours: newHours })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Basic workspace configuration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={settings.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="My Workspace"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Default timezone</Label>
            <Select value={settings.timezone} onValueChange={(v) => updateField("timezone", v)}>
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date-range">Default date range preset</Label>
            <Select value={settings.defaultDateRange} onValueChange={(v) => updateField("defaultDateRange", v)}>
              <SelectTrigger id="date-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-refresh dashboards</Label>
              <p className="text-sm text-muted-foreground">Automatically refresh data on dashboards</p>
            </div>
            <Switch checked={settings.autoRefresh} onCheckedChange={(v) => updateField("autoRefresh", v)} />
          </div>

          {settings.autoRefresh && (
            <div className="space-y-2 pl-4 border-l-2 border-muted">
              <Label htmlFor="refresh-interval">Refresh interval</Label>
              <Select value={settings.autoRefreshInterval} onValueChange={(v) => updateField("autoRefreshInterval", v)}>
                <SelectTrigger id="refresh-interval" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 seconds</SelectItem>
                  <SelectItem value="60">1 minute</SelectItem>
                  <SelectItem value="300">5 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Business Hours</CardTitle>
          <CardDescription>Define your operating hours for analytics and alerts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {settings.businessHours.map((bh, i) => (
              <div key={bh.day} className="flex items-center gap-4">
                <div className="flex items-center gap-2 w-32">
                  <Switch checked={bh.enabled} onCheckedChange={(v) => updateBusinessHour(i, "enabled", v)} />
                  <span className="text-sm">{bh.day.slice(0, 3)}</span>
                </div>
                {bh.enabled && (
                  <>
                    <Input
                      type="time"
                      value={bh.start}
                      onChange={(e) => updateBusinessHour(i, "start", e.target.value)}
                      className="w-32"
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={bh.end}
                      onChange={(e) => updateBusinessHour(i, "end", e.target.value)}
                      className="w-32"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={onReset}>
          Reset to defaults
        </Button>
      </div>
    </div>
  )
}

export const defaultWorkspaceSettings: WorkspaceSettings = {
  name: "Acme Corp",
  timezone: "America/New_York",
  businessHours: days.map((day) => ({
    day,
    enabled: !["Saturday", "Sunday"].includes(day),
    start: "09:00",
    end: "17:00",
  })),
  defaultDateRange: "7d",
  autoRefresh: true,
  autoRefreshInterval: "60",
}

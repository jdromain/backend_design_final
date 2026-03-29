"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Download, Database, EyeOff } from "lucide-react"

interface DataPrivacySettings {
  recordingsEnabled: boolean
  transcriptRetention: string
  maskPhoneNumbers: boolean
  maskEmails: boolean
}

interface DataPrivacyPanelProps {
  settings: DataPrivacySettings
  onChange: (settings: DataPrivacySettings) => void
  onExportData: () => void
}

export function DataPrivacyPanel({ settings, onChange, onExportData }: DataPrivacyPanelProps) {
  const updateField = <K extends keyof DataPrivacySettings>(field: K, value: DataPrivacySettings[K]) => {
    onChange({ ...settings, [field]: value })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Call Recordings</CardTitle>
          <CardDescription>Configure how call audio is handled</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Enable call recordings</p>
                <p className="text-sm text-muted-foreground">Store audio recordings of all calls for review</p>
              </div>
            </div>
            <Switch checked={settings.recordingsEnabled} onCheckedChange={(v) => updateField("recordingsEnabled", v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Retention</CardTitle>
          <CardDescription>How long data is stored before automatic deletion</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="retention">Transcript retention period</Label>
            <Select value={settings.transcriptRetention} onValueChange={(v) => updateField("transcriptRetention", v)}>
              <SelectTrigger id="retention" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="365">1 year</SelectItem>
                <SelectItem value="forever">Forever</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">Transcripts older than this will be permanently deleted</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PII Redaction</CardTitle>
          <CardDescription>Automatically mask sensitive information in transcripts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <EyeOff className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Mask phone numbers</p>
                <p className="text-sm text-muted-foreground">Replace with [PHONE]</p>
              </div>
            </div>
            <Switch checked={settings.maskPhoneNumbers} onCheckedChange={(v) => updateField("maskPhoneNumbers", v)} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <EyeOff className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Mask email addresses</p>
                <p className="text-sm text-muted-foreground">Replace with [EMAIL]</p>
              </div>
            </div>
            <Switch checked={settings.maskEmails} onCheckedChange={(v) => updateField("maskEmails", v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Export</CardTitle>
          <CardDescription>Download a copy of all your workspace data</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onExportData}>
            <Download className="mr-2 h-4 w-4" />
            Export all data
          </Button>
          <p className="text-sm text-muted-foreground mt-2">
            Generates a ZIP file with all calls, transcripts, and settings
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export const defaultDataPrivacySettings: DataPrivacySettings = {
  recordingsEnabled: true,
  transcriptRetention: "90",
  maskPhoneNumbers: true,
  maskEmails: true,
}

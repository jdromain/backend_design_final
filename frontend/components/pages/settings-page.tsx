"use client"

import { useState, useCallback, useEffect } from "react"
import { SettingsNav } from "@/components/settings/settings-nav"
import { UnsavedChangesBar } from "@/components/settings/unsaved-changes-bar"
import { WorkspacePanel, defaultWorkspaceSettings } from "@/components/settings/workspace-panel"
import { TeamRolesPanel } from "@/components/settings/team-roles-panel"
import { NotificationsPanel, defaultNotificationSettings } from "@/components/settings/notifications-panel"
import { SecurityPanel, defaultSecuritySettings, mockAuditEvents } from "@/components/settings/security-panel"
import { DataPrivacyPanel, defaultDataPrivacySettings } from "@/components/settings/data-privacy-panel"
import { DeveloperPanel, type ApiKey } from "@/components/settings/developer-panel"
import { DangerZonePanel } from "@/components/settings/danger-zone-panel"
import { useToast } from "@/hooks/use-toast"
import { ErrorBoundary } from "@/components/error-boundary"

import { getTeamMembers, getApiKeys } from "@/lib/data/settings"
import type { TeamMember } from "@/types/api"

export function SettingsPage() {
  const { toast } = useToast()
  const [activeSection, setActiveSection] = useState("workspace")
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)

  // Settings state
  const [workspaceSettings, setWorkspaceSettings] = useState(defaultWorkspaceSettings)
  const [savedWorkspaceSettings, setSavedWorkspaceSettings] = useState(defaultWorkspaceSettings)

  const [notificationSettings, setNotificationSettings] = useState(defaultNotificationSettings)
  const [savedNotificationSettings, setSavedNotificationSettings] = useState(defaultNotificationSettings)

  const [securitySettings, setSecuritySettings] = useState(defaultSecuritySettings)
  const [savedSecuritySettings, setSavedSecuritySettings] = useState(defaultSecuritySettings)

  const [dataPrivacySettings, setDataPrivacySettings] = useState(defaultDataPrivacySettings)
  const [savedDataPrivacySettings, setSavedDataPrivacySettings] = useState(defaultDataPrivacySettings)

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [members, keys] = await Promise.all([getTeamMembers(), getApiKeys()])
        if (!cancelled) {
          setTeamMembers(members)
          setApiKeys(
            keys.map((k) => ({
              id: k.id,
              name: k.name,
              prefix: k.prefix,
              created: k.created,
              lastUsed: k.lastUsed,
              status: k.status,
            })),
          )
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          toast({
            title: "Could not load settings",
            description: "Team or API keys failed to load. Try again later.",
            variant: "destructive",
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [toast])
  const [webhook, setWebhook] = useState({
    endpoint: "https://api.acmecorp.com/webhooks/rezovo",
    events: ["calls", "incidents"],
    signingSecret: "whsec_a1b2c3d4e5f6g7h8i9j0",
  })

  // Check for changes
  useEffect(() => {
    const workspaceChanged = JSON.stringify(workspaceSettings) !== JSON.stringify(savedWorkspaceSettings)
    const notificationChanged = JSON.stringify(notificationSettings) !== JSON.stringify(savedNotificationSettings)
    const securityChanged = JSON.stringify(securitySettings) !== JSON.stringify(savedSecuritySettings)
    const dataPrivacyChanged = JSON.stringify(dataPrivacySettings) !== JSON.stringify(savedDataPrivacySettings)
    setHasChanges(workspaceChanged || notificationChanged || securityChanged || dataPrivacyChanged)
  }, [
    workspaceSettings,
    notificationSettings,
    securitySettings,
    dataPrivacySettings,
    savedWorkspaceSettings,
    savedNotificationSettings,
    savedSecuritySettings,
    savedDataPrivacySettings,
  ])

  const handleSave = useCallback(async () => {
    setSaving(true)
    await new Promise((r) => setTimeout(r, 1000))
    setSavedWorkspaceSettings(workspaceSettings)
    setSavedNotificationSettings(notificationSettings)
    setSavedSecuritySettings(securitySettings)
    setSavedDataPrivacySettings(dataPrivacySettings)
    setSaving(false)
    toast({ title: "Settings saved", description: "Your changes have been saved successfully." })
  }, [workspaceSettings, notificationSettings, securitySettings, dataPrivacySettings, toast])

  const handleDiscard = useCallback(() => {
    setWorkspaceSettings(savedWorkspaceSettings)
    setNotificationSettings(savedNotificationSettings)
    setSecuritySettings(savedSecuritySettings)
    setDataPrivacySettings(savedDataPrivacySettings)
  }, [savedWorkspaceSettings, savedNotificationSettings, savedSecuritySettings, savedDataPrivacySettings])

  // Team handlers
  const handleInvite = (email: string, role: string) => {
    const newMember: TeamMember = {
      id: Date.now().toString(),
      name: email.split("@")[0],
      email,
      role: role as "admin" | "editor" | "viewer",
      status: "invited",
      lastActive: "Never",
    }
    setTeamMembers([...teamMembers, newMember])
    toast({ title: "Invitation sent", description: `Invited ${email} as ${role}` })
  }

  const handleChangeRole = (id: string, role: string) => {
    setTeamMembers(teamMembers.map((m) => (m.id === id ? { ...m, role: role as "admin" | "editor" | "viewer" } : m)))
    toast({ title: "Role updated" })
  }

  const handleRemoveMember = (id: string) => {
    const member = teamMembers.find((m) => m.id === id)
    setTeamMembers(teamMembers.filter((m) => m.id !== id))
    toast({ title: "Member removed", description: `${member?.email} has been removed` })
  }

  // Security handlers
  const handleSignOutAll = () => {
    toast({ title: "Sessions terminated", description: "All users have been signed out" })
  }

  // Data privacy handlers
  const handleExportData = () => {
    toast({ title: "Export started", description: "You'll receive a download link via email" })
  }

  // Developer handlers
  const handleCreateKey = (name: string): string => {
    const key = `rz_live_${Math.random().toString(36).substring(2, 15)}`
    const newKey: ApiKey = {
      id: Date.now().toString(),
      name,
      prefix: "rz_live_",
      created: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      lastUsed: "Never",
      status: "active",
    }
    setApiKeys([newKey, ...apiKeys])
    toast({ title: "API key created", description: `${name} has been created` })
    return key
  }

  const handleRevokeKey = (id: string) => {
    setApiKeys(apiKeys.map((k) => (k.id === id ? { ...k, status: "revoked" as const } : k)))
    toast({ title: "API key revoked" })
  }

  const handleTestWebhook = () => {
    toast({ title: "Test event sent", description: "Check your endpoint for the test payload" })
  }

  const handleRotateSecret = () => {
    setWebhook({ ...webhook, signingSecret: `whsec_${Math.random().toString(36).substring(2, 22)}` })
    toast({ title: "Secret rotated", description: "Update your integration with the new secret" })
  }

  // Danger zone handlers
  const handleDeleteWorkspace = () => {
    toast({ title: "Workspace deleted", description: "Redirecting...", variant: "destructive" })
  }

  const handleResetDemo = () => {
    toast({ title: "Demo reset", description: "Sample data has been restored" })
  }

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Manage workspace preferences and security</p>
        </div>

      {/* Main content */}
      <div className="flex gap-8">
        <SettingsNav activeSection={activeSection} onSectionChange={setActiveSection} />

        <div className="flex-1 min-w-0 pb-20">
          {activeSection === "workspace" && (
            <WorkspacePanel
              settings={workspaceSettings}
              onChange={setWorkspaceSettings}
              onReset={() => setWorkspaceSettings(defaultWorkspaceSettings)}
            />
          )}
          {activeSection === "team" && (
            <TeamRolesPanel
              members={teamMembers}
              onInvite={handleInvite}
              onChangeRole={handleChangeRole}
              onRemove={handleRemoveMember}
            />
          )}
          {activeSection === "notifications" && (
            <NotificationsPanel settings={notificationSettings} onChange={setNotificationSettings} />
          )}
          {activeSection === "security" && (
            <SecurityPanel
              settings={securitySettings}
              onChange={setSecuritySettings}
              auditEvents={mockAuditEvents}
              onSignOutAll={handleSignOutAll}
            />
          )}
          {activeSection === "data" && (
            <DataPrivacyPanel
              settings={dataPrivacySettings}
              onChange={setDataPrivacySettings}
              onExportData={handleExportData}
            />
          )}
          {activeSection === "developer" && (
            <DeveloperPanel
              apiKeys={apiKeys}
              webhook={webhook}
              onCreateKey={handleCreateKey}
              onRevokeKey={handleRevokeKey}
              onUpdateWebhook={setWebhook}
              onTestWebhook={handleTestWebhook}
              onRotateSecret={handleRotateSecret}
            />
          )}
          {activeSection === "danger" && (
            <DangerZonePanel
              workspaceName={workspaceSettings.name}
              onDeleteWorkspace={handleDeleteWorkspace}
              onResetDemo={handleResetDemo}
            />
          )}
        </div>
      </div>

        {/* Unsaved changes bar */}
        {hasChanges && <UnsavedChangesBar onDiscard={handleDiscard} onSave={handleSave} saving={saving} />}
      </div>
    </ErrorBoundary>
  )
}

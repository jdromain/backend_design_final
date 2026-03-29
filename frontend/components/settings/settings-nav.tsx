"use client"

import { cn } from "@/lib/utils"
import { Building2, Users, Bell, Shield, Database, Code, AlertTriangle } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const sections = [
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "team", label: "Team & Roles", icon: Users },
  { id: "notifications", label: "Notifications & Alerts", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "data", label: "Data & Privacy", icon: Database },
  { id: "developer", label: "Developer", icon: Code },
  { id: "danger", label: "Danger Zone", icon: AlertTriangle },
]

interface SettingsNavProps {
  activeSection: string
  onSectionChange: (section: string) => void
}

export function SettingsNav({ activeSection, onSectionChange }: SettingsNavProps) {
  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden lg:block w-56 flex-shrink-0">
        <div className="sticky top-6 space-y-1">
          {sections.map((section) => {
            const Icon = section.icon
            const isActive = activeSection === section.id
            const isDanger = section.id === "danger"
            return (
              <button
                key={section.id}
                onClick={() => onSectionChange(section.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive && !isDanger && "bg-accent text-accent-foreground",
                  isActive && isDanger && "bg-destructive/10 text-destructive",
                  !isActive && !isDanger && "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  !isActive && isDanger && "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                )}
              >
                <Icon className="h-4 w-4" />
                {section.label}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Mobile selector */}
      <div className="lg:hidden mb-6">
        <Select value={activeSection} onValueChange={onSectionChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

"use client"

import { Button } from "@/components/ui/button"

interface UnsavedChangesBarProps {
  onDiscard: () => void
  onSave: () => void
  saving?: boolean
}

export function UnsavedChangesBar({ onDiscard, onSave, saving }: UnsavedChangesBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex items-center justify-between py-3 px-4">
        <p className="text-sm text-muted-foreground">You have unsaved changes</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  )
}

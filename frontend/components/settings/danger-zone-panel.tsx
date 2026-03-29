"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AlertTriangle, Trash2, RotateCcw } from "lucide-react"

interface DangerZonePanelProps {
  workspaceName: string
  onDeleteWorkspace: () => void
  onResetDemo: () => void
}

export function DangerZonePanel({ workspaceName, onDeleteWorkspace, onResetDemo }: DangerZonePanelProps) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")

  const handleDelete = () => {
    if (confirmText === workspaceName) {
      onDeleteWorkspace()
      setDeleteOpen(false)
      setConfirmText("")
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
          </div>
          <CardDescription>Irreversible and destructive actions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border border-destructive/30 rounded-lg bg-destructive/5">
            <div>
              <p className="font-medium">Delete workspace</p>
              <p className="text-sm text-muted-foreground">Permanently delete this workspace and all its data</p>
            </div>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Workspace
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium">Reset demo data</p>
              <p className="text-sm text-muted-foreground">Clear all data and restore sample content</p>
            </div>
            <Button variant="outline" onClick={onResetDemo}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset Demo
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Workspace</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the workspace and all associated data including
              agents, calls, and knowledge base.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
              <p className="text-sm text-destructive">
                You are about to delete <strong>{workspaceName}</strong>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">
                Type <strong>{workspaceName}</strong> to confirm
              </Label>
              <Input
                id="confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={workspaceName}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={confirmText !== workspaceName}>
              Delete workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

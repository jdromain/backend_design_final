"use client"

import { useState } from "react"
import { ArrowRightLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface HandoffModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  callerNumber?: string
  onConfirm: (target: string, createAction: boolean) => void
  isLoading?: boolean
}

export function HandoffModal({ open, onOpenChange, callerNumber, onConfirm, isLoading = false }: HandoffModalProps) {
  const [transferTarget, setTransferTarget] = useState<string>("owner")
  const [createActionAutomatically, setCreateActionAutomatically] = useState(true)

  const handleConfirm = () => {
    onConfirm(transferTarget, createActionAutomatically)
    onOpenChange(false)
    // Reset state
    setTransferTarget("owner")
    setCreateActionAutomatically(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Request Handoff
          </DialogTitle>
          <DialogDescription>
            Transfer this call{callerNumber ? ` (${callerNumber})` : ""} to a team member.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="transfer-target">Transfer to</Label>
            <Select value={transferTarget} onValueChange={setTransferTarget}>
              <SelectTrigger id="transfer-target">
                <SelectValue placeholder="Select recipient" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="support">Support Team</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="create-action" className="text-sm font-medium">
                Create Action automatically
              </Label>
              <p className="text-xs text-muted-foreground">
                Log this handoff as an action item for follow-up
              </p>
            </div>
            <Switch
              id="create-action"
              checked={createActionAutomatically}
              onCheckedChange={setCreateActionAutomatically}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="bg-transparent" disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Requesting...
              </>
            ) : (
              "Request Handoff"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useActionsState } from "@/lib/actions-store"
import { useToast } from "@/hooks/use-toast"

interface BusinessHoursModalProps {
  open: boolean
  onClose: () => void
}

const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const timezones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Pacific/Honolulu",
]

export function BusinessHoursModal({ open, onClose }: BusinessHoursModalProps) {
  const { state, dispatch } = useActionsState()
  const { toast } = useToast()

  const [hours, setHours] = useState(state.businessHours)

  const handleSave = () => {
    dispatch({ type: "SET_BUSINESS_HOURS", hours })
    toast({ title: "Business hours saved" })
    onClose()
  }

  const updateDay = (day: string, field: "open" | "close" | "enabled", value: string | boolean) => {
    setHours({
      ...hours,
      schedule: {
        ...hours.schedule,
        [day]: { ...hours.schedule[day], [field]: value },
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Business Hours</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Timezone</Label>
            <Select value={hours.timezone} onValueChange={(v) => setHours({ ...hours, timezone: v })}>
              <SelectTrigger className="w-[200px]">
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

          <div className="space-y-3">
            {days.map((day) => (
              <div key={day} className="flex items-center gap-4">
                <div className="w-24">
                  <Switch checked={hours.schedule[day].enabled} onCheckedChange={(v) => updateDay(day, "enabled", v)} />
                </div>
                <span className="w-20 capitalize text-sm">{day}</span>
                <Input
                  type="time"
                  value={hours.schedule[day].open}
                  onChange={(e) => updateDay(day, "open", e.target.value)}
                  disabled={!hours.schedule[day].enabled}
                  className="w-28"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={hours.schedule[day].close}
                  onChange={(e) => updateDay(day, "close", e.target.value)}
                  disabled={!hours.schedule[day].enabled}
                  className="w-28"
                />
              </div>
            ))}
          </div>

          <div className="pt-4 border-t">
            <Label>Default AI Call Window (when hours not configured)</Label>
            <div className="flex items-center gap-4 mt-2">
              <Input
                type="time"
                value={hours.defaultWindow.start}
                onChange={(e) =>
                  setHours({ ...hours, defaultWindow: { ...hours.defaultWindow, start: e.target.value } })
                }
                className="w-28"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="time"
                value={hours.defaultWindow.end}
                onChange={(e) => setHours({ ...hours, defaultWindow: { ...hours.defaultWindow, end: e.target.value } })}
                className="w-28"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

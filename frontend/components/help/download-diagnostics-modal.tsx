"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { Download, CheckCircle } from "lucide-react"

interface DownloadDiagnosticsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DownloadDiagnosticsModal({ open, onOpenChange }: DownloadDiagnosticsModalProps) {
  const [range, setRange] = useState("15m")
  const [includeStatus, setIncludeStatus] = useState(true)
  const [includeErrors, setIncludeErrors] = useState(true)
  const [includeNetwork, setIncludeNetwork] = useState(false)
  const [progress, setProgress] = useState(0)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  const handleDownload = async () => {
    setIsDownloading(true)
    setProgress(0)

    for (let i = 0; i <= 100; i += 10) {
      await new Promise((r) => setTimeout(r, 200))
      setProgress(i)
    }

    setIsDownloading(false)
    setIsComplete(true)

    setTimeout(() => {
      onOpenChange(false)
      setIsComplete(false)
      setProgress(0)
    }, 1500)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Download Diagnostics</DialogTitle>
        </DialogHeader>

        {isComplete ? (
          <div className="py-8 text-center">
            <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-4" />
            <p className="font-medium">Download complete!</p>
            <p className="text-sm text-muted-foreground">rezovo-support-bundle.zip</p>
          </div>
        ) : isDownloading ? (
          <div className="py-8 space-y-4">
            <p className="text-sm text-center text-muted-foreground">Generating diagnostic bundle...</p>
            <Progress value={progress} />
            <p className="text-xs text-center text-muted-foreground">{progress}%</p>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Time Range</Label>
                <Select value={range} onValueChange={setRange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15m">Last 15 minutes</SelectItem>
                    <SelectItem value="1h">Last 1 hour</SelectItem>
                    <SelectItem value="24h">Last 24 hours</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="include-status" className="font-normal">
                    Include system status
                  </Label>
                  <Switch id="include-status" checked={includeStatus} onCheckedChange={setIncludeStatus} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="include-errors" className="font-normal">
                    Include recent errors
                  </Label>
                  <Switch id="include-errors" checked={includeErrors} onCheckedChange={setIncludeErrors} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="include-network" className="font-normal">
                      Include network logs
                    </Label>
                    <p className="text-xs text-muted-foreground">Redacted for privacy</p>
                  </div>
                  <Switch id="include-network" checked={includeNetwork} onCheckedChange={setIncludeNetwork} />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Generate Bundle
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

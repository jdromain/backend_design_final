"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Upload, X, Copy, Check } from "lucide-react"

interface ReportBugModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: BugReportData) => void
}

interface BugReportData {
  whatHappened: string
  stepsToReproduce: string
  expectedVsActual: string
  screenshot: File | null
}

export function ReportBugModal({ open, onOpenChange, onSubmit }: ReportBugModalProps) {
  const [formData, setFormData] = useState<BugReportData>({
    whatHappened: "",
    stepsToReproduce: "",
    expectedVsActual: "",
    screenshot: null,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Auto-captured diagnostics
  const diagnostics = {
    route: "/dashboard",
    browser: "Chrome 120 / macOS",
    version: "v2.4.1",
    timestamp: new Date().toISOString(),
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    await new Promise((r) => setTimeout(r, 1000))
    onSubmit(formData)
    setIsSubmitting(false)
    onOpenChange(false)
    setFormData({ whatHappened: "", stepsToReproduce: "", expectedVsActual: "", screenshot: null })
  }

  const handleCopy = (field: string, value: string) => {
    navigator.clipboard.writeText(value)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const isValid = formData.whatHappened.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a Bug</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>
              What happened? <span className="text-red-400">*</span>
            </Label>
            <Textarea
              value={formData.whatHappened}
              onChange={(e) => setFormData({ ...formData, whatHappened: e.target.value })}
              placeholder="Describe what went wrong..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Steps to reproduce (optional)</Label>
            <Textarea
              value={formData.stepsToReproduce}
              onChange={(e) => setFormData({ ...formData, stepsToReproduce: e.target.value })}
              placeholder="1. Go to...\n2. Click on...\n3. See error"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Expected vs actual (optional)</Label>
            <Textarea
              value={formData.expectedVsActual}
              onChange={(e) => setFormData({ ...formData, expectedVsActual: e.target.value })}
              placeholder="Expected: ... | Actual: ..."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Screenshot (optional)</Label>
            <div className="border-2 border-dashed rounded-lg p-4 text-center">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFormData({ ...formData, screenshot: e.target.files?.[0] || null })}
                className="hidden"
                id="screenshot-upload"
              />
              <label htmlFor="screenshot-upload" className="cursor-pointer">
                <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Upload screenshot</p>
              </label>
            </div>
            {formData.screenshot && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm truncate">{formData.screenshot.name}</span>
                <button onClick={() => setFormData({ ...formData, screenshot: null })}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Auto-captured (read-only)</Label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(diagnostics).map(([key, value]) => (
                <Badge
                  key={key}
                  variant="outline"
                  className="cursor-pointer hover:bg-muted"
                  onClick={() => handleCopy(key, value)}
                >
                  <span className="font-normal text-muted-foreground mr-1">{key}:</span>
                  <span className="font-mono text-xs">{value}</span>
                  {copiedField === key ? (
                    <Check className="h-3 w-3 ml-1 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3 ml-1 opacity-50" />
                  )}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Bug Report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

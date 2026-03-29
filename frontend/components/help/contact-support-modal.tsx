"use client"

import type React from "react"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Upload, X } from "lucide-react"

interface ContactSupportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: SupportFormData) => void
  isAdmin: boolean
}

interface SupportFormData {
  category: string
  subject: string
  description: string
  severity: string
  attachments: File[]
  includeDiagnostics: boolean
}

const categories = ["Calls", "Agents", "Knowledge Base", "Billing", "Integrations", "Bug", "Other"]

export function ContactSupportModal({ open, onOpenChange, onSubmit, isAdmin }: ContactSupportModalProps) {
  const [formData, setFormData] = useState<SupportFormData>({
    category: "",
    subject: "",
    description: "",
    severity: "medium",
    attachments: [],
    includeDiagnostics: isAdmin,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    await new Promise((r) => setTimeout(r, 1000))
    onSubmit(formData)
    setIsSubmitting(false)
    onOpenChange(false)
    setFormData({
      category: "",
      subject: "",
      description: "",
      severity: "medium",
      attachments: [],
      includeDiagnostics: isAdmin,
    })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFormData({ ...formData, attachments: [...formData.attachments, ...Array.from(e.target.files)] })
    }
  }

  const removeFile = (index: number) => {
    setFormData({ ...formData, attachments: formData.attachments.filter((_, i) => i !== index) })
  }

  const isValid = formData.category && formData.subject && formData.description

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Contact Support</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>
              Subject <span className="text-red-400">*</span>
            </Label>
            <Input
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              placeholder="Brief summary of your issue"
            />
          </div>

          <div className="space-y-2">
            <Label>
              Description <span className="text-red-400">*</span>
            </Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe your issue in detail..."
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Severity</Label>
            <Select value={formData.severity} onValueChange={(v) => setFormData({ ...formData, severity: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Attachments (optional)</Label>
            <div className="border-2 border-dashed rounded-lg p-4 text-center">
              <input type="file" multiple onChange={handleFileChange} className="hidden" id="file-upload" />
              <label htmlFor="file-upload" className="cursor-pointer">
                <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Drop files here or click to upload</p>
              </label>
            </div>
            {formData.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.attachments.map((file, i) => (
                  <div key={i} className="flex items-center gap-1 bg-muted px-2 py-1 rounded text-sm">
                    <span className="truncate max-w-[150px]">{file.name}</span>
                    <button onClick={() => removeFile(i)}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="diagnostics"
                checked={formData.includeDiagnostics}
                onCheckedChange={(checked) => setFormData({ ...formData, includeDiagnostics: checked as boolean })}
              />
              <Label htmlFor="diagnostics" className="text-sm font-normal cursor-pointer">
                Include diagnostics (recommended)
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

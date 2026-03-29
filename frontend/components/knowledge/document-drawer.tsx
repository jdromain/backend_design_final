"use client"

import { formatDistanceToNow, format } from "date-fns"
import {
  FileText,
  Download,
  RefreshCw,
  Trash2,
  CheckCircle,
  Clock,
  Loader2,
  XCircle,
  AlertTriangle,
} from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { KbDocument, ProcessingStatus } from "./documents-table"

interface DocumentDrawerProps {
  document: KbDocument | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onReprocess: (doc: KbDocument) => void
  onDownload: (doc: KbDocument) => void
  onDelete: (doc: KbDocument) => void
}

const PROCESSING_STEPS: { status: ProcessingStatus; label: string }[] = [
  { status: "queued", label: "Queued" },
  { status: "parsing", label: "Parsing" },
  { status: "chunking", label: "Chunking" },
  { status: "embedding", label: "Embedding" },
  { status: "ready", label: "Ready" },
]

const MOCK_LOGS = [
  { time: "10:23:01", level: "info", message: "Document upload started" },
  { time: "10:23:02", level: "info", message: "File validation passed" },
  { time: "10:23:03", level: "info", message: "Parsing document content" },
  { time: "10:23:15", level: "info", message: "Extracted 45 pages" },
  { time: "10:23:16", level: "info", message: "Starting chunking process" },
  { time: "10:23:25", level: "info", message: "Created 128 chunks" },
  { time: "10:23:26", level: "info", message: "Generating embeddings" },
  { time: "10:24:01", level: "success", message: "Processing complete" },
]

const MOCK_PREVIEW = `This document contains information about restaurant policies and procedures.

Section 1: Booking Policies
- Reservations can be made up to 30 days in advance
- Cancellations must be made 24 hours before the reservation
- Groups larger than 8 require a deposit

Section 2: Menu Information
- Our menu changes seasonally
- We accommodate dietary restrictions with advance notice
- Special menus available for private events...`

export function DocumentDrawer({
  document,
  open,
  onOpenChange,
  onReprocess,
  onDownload,
  onDelete,
}: DocumentDrawerProps) {
  if (!document) return null

  const getStepStatus = (stepStatus: ProcessingStatus) => {
    const stepIndex = PROCESSING_STEPS.findIndex((s) => s.status === stepStatus)
    const currentIndex = PROCESSING_STEPS.findIndex((s) => s.status === document.status)

    if (document.status === "failed") {
      if (stepIndex < currentIndex) return "complete"
      if (stepIndex === currentIndex) return "failed"
      return "pending"
    }

    if (stepIndex < currentIndex) return "complete"
    if (stepIndex === currentIndex) return "current"
    return "pending"
  }

  const getStepIcon = (status: string) => {
    switch (status) {
      case "complete":
        return <CheckCircle className="h-4 w-4 text-emerald-500" />
      case "current":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Document Details
            </SheetTitle>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] pr-4 mt-6">
          <div className="space-y-6">
            {/* Overview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">File Name</span>
                  <span className="text-sm font-medium">{document.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Type</span>
                  <span className="text-sm font-mono uppercase">{document.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Size</span>
                  <span className="text-sm">{document.size}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Uploaded</span>
                  <span className="text-sm">{format(document.uploadedAt, "MMM d, yyyy h:mm a")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Last Processed</span>
                  <span className="text-sm">{formatDistanceToNow(document.updatedAt, { addSuffix: true })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Collection</span>
                  {document.collectionName ? (
                    <Badge variant="outline">{document.collectionName}</Badge>
                  ) : (
                    <Badge variant="secondary">Unassigned</Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Processing Status Timeline */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Processing Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {PROCESSING_STEPS.map((step, index) => {
                    const status = getStepStatus(step.status)
                    return (
                      <div key={step.status} className="flex items-center gap-3">
                        {getStepIcon(status)}
                        <span className={`text-sm ${status === "pending" ? "text-muted-foreground" : ""}`}>
                          {step.label}
                        </span>
                        {status === "current" && (
                          <Badge variant="secondary" className="text-xs">
                            In Progress
                          </Badge>
                        )}
                        {status === "failed" && (
                          <Badge variant="destructive" className="text-xs">
                            Error
                          </Badge>
                        )}
                      </div>
                    )
                  })}
                </div>

                {document.status === "failed" && document.errorMessage && (
                  <div className="mt-4 p-3 bg-destructive/10 rounded-lg">
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm font-medium">Error</span>
                    </div>
                    <p className="text-sm text-destructive/80 mt-1">{document.errorMessage}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Chunk Stats */}
            {document.status === "ready" && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Chunk Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Chunks</span>
                    <span className="text-sm font-mono">{document.chunks.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Token Estimate</span>
                    <span className="text-sm font-mono">~{document.tokenEstimate.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Avg Chunk Size</span>
                    <span className="text-sm font-mono">
                      ~{Math.round(document.tokenEstimate / document.chunks)} tokens
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Text Preview */}
            {document.status === "ready" && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Content Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="p-3 bg-muted rounded-lg">
                    <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">{MOCK_PREVIEW}</pre>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Processing Logs */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Processing Logs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-xs">
                  {MOCK_LOGS.map((log, index) => (
                    <div key={index} className="flex gap-2">
                      <span className="text-muted-foreground">{log.time}</span>
                      <span
                        className={
                          log.level === "error"
                            ? "text-red-500"
                            : log.level === "success"
                              ? "text-emerald-500"
                              : "text-foreground"
                        }
                      >
                        [{log.level}]
                      </span>
                      <span className="text-muted-foreground">{log.message}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Separator />

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <Button onClick={() => onReprocess(document)} variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Reprocess Document
              </Button>
              <Button onClick={() => onDownload(document)} variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Download Original
              </Button>
              <Button
                onClick={() => onDelete(document)}
                variant="outline"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Document
              </Button>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

"use client"

import type React from "react"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Upload, FileText, X, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { validateKbFilesForIngest, KB_MAX_FILE_BYTES } from "@/lib/kb-upload"

const MAX_MB = KB_MAX_FILE_BYTES / (1024 * 1024)

export interface UploadDropzoneProps {
  isCompact?: boolean
  onFilesSelected: (files: File[]) => void
  /** HTML accept string, e.g. ".txt,.md" */
  accept: string
  /** Format hint shown under the main label */
  formatHint: string
  disabled?: boolean
  isUploading?: boolean
  /** 1-based index of file currently uploading */
  uploadCurrentIndex?: number
  uploadTotal?: number
}

export function UploadDropzone({
  isCompact = false,
  onFilesSelected,
  accept,
  formatHint,
  disabled = false,
  isUploading = false,
  uploadCurrentIndex,
  uploadTotal,
}: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [rejections, setRejections] = useState<{ file: File; message: string }[]>([])
  const [justCompleted, setJustCompleted] = useState(false)
  const inputId = useId()

  // Track upload completion to show a brief success flash and clear staged files
  const prevUploadingRef = useRef(false)
  useEffect(() => {
    const wasUploading = prevUploadingRef.current
    prevUploadingRef.current = isUploading

    if (wasUploading && !isUploading) {
      // Upload just finished — clear staged files and flash success
      setStagedFiles([])
      setRejections([])
      setJustCompleted(true)
      const t = setTimeout(() => setJustCompleted(false), 2500)
      return () => clearTimeout(t)
    }
  }, [isUploading])

  const forwardValidated = useCallback(
    (raw: File[]) => {
      setJustCompleted(false)
      if (raw.length === 0) {
        setStagedFiles([])
        setRejections([])
        return
      }
      const { valid, rejected } = validateKbFilesForIngest(raw)
      setRejections(rejected)
      // Compact mode does not maintain a staged list — upload fires immediately
      setStagedFiles(isCompact ? [] : valid)
      if (valid.length > 0) {
        onFilesSelected(valid)
      }
    },
    [isCompact, onFilesSelected],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (!disabled && !isUploading) setIsDragging(true)
    },
    [disabled, isUploading],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (disabled || isUploading) return
      forwardValidated(Array.from(e.dataTransfer.files))
    },
    [disabled, isUploading, forwardValidated],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) forwardValidated(Array.from(e.target.files))
      e.target.value = ""
    },
    [forwardValidated],
  )

  const removeStaged = (index: number) => {
    forwardValidated(stagedFiles.filter((_, i) => i !== index))
  }

  const busy = disabled || isUploading

  const progressLabel =
    isUploading && uploadTotal && uploadCurrentIndex
      ? `Uploading ${uploadCurrentIndex} of ${uploadTotal}…`
      : "Uploading…"

  const hiddenInput = (
    <input
      id={inputId}
      type="file"
      multiple
      accept={accept}
      onChange={handleFileInput}
      className="hidden"
      disabled={busy}
    />
  )

  if (isCompact) {
    return (
      <div className="space-y-2">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          aria-busy={isUploading}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-sm transition-colors sm:flex-row sm:justify-start",
            isDragging && !busy
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25",
            !busy && "hover:border-primary/40",
            busy && "pointer-events-none opacity-70",
            justCompleted && "border-emerald-500/40 bg-emerald-500/5",
          )}
        >
          {hiddenInput}

          {justCompleted ? (
            <>
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="text-muted-foreground">Upload complete — drop more files or</span>
              <label
                htmlFor={inputId}
                className="cursor-pointer text-primary underline-offset-2 hover:underline"
              >
                browse
              </label>
            </>
          ) : isUploading ? (
            <>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              <span className="text-muted-foreground">{progressLabel}</span>
              <span className="text-xs text-muted-foreground/70">Do not close this page</span>
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">
                Drop files here or{" "}
                <label
                  htmlFor={inputId}
                  className="cursor-pointer text-primary underline-offset-2 hover:underline"
                >
                  browse
                </label>
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                · {formatHint} · max {MAX_MB.toFixed(0)}MB
              </span>
            </>
          )}
        </div>

        {rejections.length > 0 && (
          <RejectionAlert rejections={rejections} onDismiss={() => setRejections([])} />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-busy={isUploading}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 transition-colors",
          isDragging && !busy ? "border-primary bg-primary/5" : "border-muted-foreground/25",
          !busy && "hover:border-primary/40",
          busy && "opacity-70",
        )}
      >
        {/* Upload overlay */}
        {isUploading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-background/85 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">{progressLabel}</p>
            <p className="text-xs text-muted-foreground">Do not close this page</p>
          </div>
        )}

        {hiddenInput}

        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full transition-colors",
            justCompleted ? "bg-emerald-500/10" : "bg-muted",
          )}
        >
          {justCompleted ? (
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          ) : (
            <Upload className="h-7 w-7 text-muted-foreground" />
          )}
        </div>

        <h3 className="mt-3 text-base font-semibold">
          {justCompleted ? "Upload complete" : "Drop files here"}
        </h3>
        <p className="mt-1 max-w-xs px-4 text-center text-sm text-muted-foreground">{formatHint}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Max {MAX_MB.toFixed(0)}MB per file</p>

        <Button
          type="button"
          variant={justCompleted ? "outline" : "secondary"}
          className="mt-4"
          asChild
          disabled={busy}
        >
          <label
            htmlFor={inputId}
            className={cn("cursor-pointer select-none", busy && "pointer-events-none")}
          >
            {justCompleted ? "Add more files" : "Browse files"}
          </label>
        </Button>
      </div>

      {rejections.length > 0 && (
        <RejectionAlert rejections={rejections} onDismiss={() => setRejections([])} />
      )}

      {stagedFiles.length > 0 && !isUploading && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">
            {stagedFiles.length} file{stagedFiles.length !== 1 ? "s" : ""} ready to upload
          </p>
          {stagedFiles.map((file, index) => (
            <div
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate text-sm font-medium" title={file.name}>
                  {file.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => removeStaged(index)}
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RejectionAlert({
  rejections,
  onDismiss,
}: {
  rejections: { file: File; message: string }[]
  onDismiss: () => void
}) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1 text-destructive">
        <ul className="space-y-0.5">
          {rejections.map((r, i) => (
            <li key={i}>{r.message}</li>
          ))}
        </ul>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-destructive/70 hover:text-destructive"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

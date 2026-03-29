"use client"

import type React from "react"

import { useCallback, useState } from "react"
import { Upload, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface UploadDropzoneProps {
  isCompact?: boolean
  onFilesSelected: (files: File[]) => void
}

export function UploadDropzone({ isCompact = false, onFilesSelected }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const files = Array.from(e.dataTransfer.files)
      setSelectedFiles(files)
      onFilesSelected(files)
    },
    [onFilesSelected],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const files = Array.from(e.target.files)
        setSelectedFiles(files)
        onFilesSelected(files)
      }
    },
    [onFilesSelected],
  )

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index)
    setSelectedFiles(newFiles)
    onFilesSelected(newFiles)
  }

  if (isCompact) {
    return (
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-lg transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50",
        )}
      >
        <Upload className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Drop files to upload or</span>
        <label>
          <input type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={handleFileInput} className="hidden" />
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <span className="cursor-pointer">browse</span>
          </Button>
        </label>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50",
        )}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Upload className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">Drop files here</h3>
        <p className="mt-2 text-sm text-muted-foreground">Supports PDF, DOCX, TXT, and MD files up to 10MB</p>
        <label>
          <input type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={handleFileInput} className="hidden" />
          <Button variant="secondary" className="mt-4" asChild>
            <span className="cursor-pointer">Browse Files</span>
          </Button>
        </label>
      </div>

      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Selected files:</p>
          {selectedFiles.map((file, index) => (
            <div key={index} className="flex items-center justify-between p-2 bg-muted rounded-lg">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{file.name}</span>
                <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(index)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

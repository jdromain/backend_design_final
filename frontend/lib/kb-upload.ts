import type { KbDocument } from "@/components/knowledge/documents-table"

export const KB_FALLBACK_NAMESPACE = "general"
/** Max file size (matches dropzone / product copy). */
export const KB_MAX_FILE_BYTES = 10 * 1024 * 1024

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export const KB_ACCEPT_MOCKS = ".pdf,.docx,.txt,.md"
export const KB_ACCEPT_API = ".txt,.md"

export const KB_SUPPORTED_MOCK: ReadonlySet<KbDocument["type"]> = new Set(["pdf", "docx", "txt", "md"])
export const KB_SUPPORTED_API: ReadonlySet<KbDocument["type"]> = new Set(["txt", "md"])

export function inferKbFileType(file: File): KbDocument["type"] {
  const ext = file.name.split(".").pop()?.toLowerCase()
  if (ext === "pdf" || ext === "docx" || ext === "txt" || ext === "md") return ext
  return "txt"
}

export type KbFileValidation = { ok: true; file: File } | { ok: false; file: File; message: string }

export function validateKbFilesForIngest(files: File[]): { valid: File[]; rejected: { file: File; message: string }[] } {
  const supported = USE_MOCKS ? KB_SUPPORTED_MOCK : KB_SUPPORTED_API
  const valid: File[] = []
  const rejected: { file: File; message: string }[] = []

  for (const file of files) {
    if (file.size > KB_MAX_FILE_BYTES) {
      rejected.push({ file, message: `${file.name} is larger than 10MB` })
      continue
    }
    const t = inferKbFileType(file)
    if (!supported.has(t)) {
      rejected.push({
        file,
        message: USE_MOCKS
          ? `${file.name}: use PDF, DOCX, TXT, or Markdown`
          : `${file.name}: in API mode only TXT and Markdown are supported`,
      })
      continue
    }
    valid.push(file)
  }

  return { valid, rejected }
}

export function isKbApiModeReadOnlyUi(): boolean {
  return !USE_MOCKS
}

/** How long before we consider a non-terminal document "stalled". */
export const STALE_PROCESSING_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Returns true when a document has been in a processing state for too long.
 * Sync embedding typically finishes in seconds; 10 minutes is a safe threshold.
 */
export function isDocStale(status: string, updatedAt: Date): boolean {
  if (status === "ready" || status === "failed") return false
  return Date.now() - updatedAt.getTime() > STALE_PROCESSING_MS
}

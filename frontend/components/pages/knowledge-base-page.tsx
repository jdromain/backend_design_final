"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { FolderInput, RefreshCw, Trash2, FileText, Upload, BookOpen, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { useIntervalWhen } from "@/hooks/use-interval-when"
import { KbToolbar } from "@/components/knowledge/kb-toolbar"
import { KbHealthStrip, KbHealthStripSkeleton } from "@/components/knowledge/kb-health-strip"
import { UploadDropzone } from "@/components/knowledge/upload-dropzone"
import { DocumentsTable, type KbDocument, type ProcessingStatus } from "@/components/knowledge/documents-table"
import { DocumentDrawer } from "@/components/knowledge/document-drawer"
import { CollectionsModal, type Collection } from "@/components/knowledge/collections-modal"
import { AssignCollectionModal } from "@/components/knowledge/assign-collection-modal"
import { TestRetrievalCard, type RetrievalResult } from "@/components/knowledge/test-retrieval-card"
import { ErrorBoundary } from "@/components/error-boundary"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/empty-state"
import { TableSkeleton } from "@/components/loading-skeleton"
import { ApiError, waitForAuthReady } from "@/lib/api-client"
import {
  getKnowledgeWorkspace,
  ingestKnowledgeDocument,
  deleteKnowledgeDocument,
  updateKnowledgeDocument,
  reingestKnowledgeDocument,
  retrieveKnowledgePassages,
} from "@/lib/data/knowledge"
import { getUiCapabilities } from "@/lib/data/capabilities"
import {
  inferKbFileType,
  isDocStale,
  isKbApiModeReadOnlyUi,
  KB_ACCEPT_API,
  KB_ACCEPT_MOCKS,
  KB_FALLBACK_NAMESPACE,
  validateKbFilesForIngest,
} from "@/lib/kb-upload"

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"
const readOnlyApiUi = isKbApiModeReadOnlyUi()
const acceptAttr = useMocks ? KB_ACCEPT_MOCKS : KB_ACCEPT_API
const formatHint = useMocks
  ? "Supported formats: PDF, DOCX, TXT, and Markdown (max 10MB each)"
  : "Text-based Markdown and plain text (TXT) — max 10MB per file"

export function KnowledgeBasePage() {
  const { toast } = useToast()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const openFilePicker = useCallback(() => {
    uploadInputRef.current?.click()
  }, [])

  const [documents, setDocuments] = useState<KbDocument[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [workspaceState, setWorkspaceState] = useState<"loading" | "ready" | "error">("loading")
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [collectionFilter, setCollectionFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedDocument, setSelectedDocument] = useState<KbDocument | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collectionsModalOpen, setCollectionsModalOpen] = useState(false)
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [assigningDocs, setAssigningDocs] = useState<KbDocument[]>([])
  const [canReprocess, setCanReprocess] = useState(useMocks)

  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<"bulk" | { doc: KbDocument } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const loadWorkspace = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false
      if (silent) {
        setIsRefreshing(true)
      } else {
        setWorkspaceState("loading")
      }

      try {
        await waitForAuthReady()
        let workspace: Awaited<ReturnType<typeof getKnowledgeWorkspace>> | null = null
        let lastError: unknown = null
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            workspace = await getKnowledgeWorkspace()
            break
          } catch (error) {
            lastError = error
            if (error instanceof ApiError && error.status === 401 && attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000))
              continue
            }
            throw error
          }
        }
        if (!workspace) {
          throw lastError ?? new Error("Failed to load knowledge workspace")
        }
        const w = workspace
        setDocuments(w.documents)
        setCollections(w.collections)
        setWorkspaceState("ready")
      } catch (e) {
        console.error(e)
        if (!silent) {
          toast({
            title: "Could not load knowledge base",
            description:
              e instanceof ApiError ? "Check that you are signed in and the API is reachable." : "Unknown error",
            variant: "destructive",
          })
          setDocuments([])
          setCollections([])
          setWorkspaceState("error")
        }
      } finally {
        setIsRefreshing(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    void getUiCapabilities().then((caps) => {
      setCanReprocess(caps.knowledge.reprocess)
    })
  }, [])

  const hasInFlightProcessing = useMemo(
    () => documents.some((d) => d.status !== "ready" && d.status !== "failed"),
    [documents],
  )

  const allProcessingAreStale = useMemo(
    () =>
      hasInFlightProcessing &&
      documents
        .filter((d) => d.status !== "ready" && d.status !== "failed")
        .every((d) => isDocStale(d.status, d.updatedAt)),
    [documents, hasInFlightProcessing],
  )

  // Fast poll (5s) when documents are actively processing
  useIntervalWhen(
    !useMocks && workspaceState === "ready" && hasInFlightProcessing && !allProcessingAreStale,
    () => {
      void loadWorkspace({ silent: true })
    },
    5000,
  )

  // Slow poll (30s) when all processing docs appear stalled — avoids hammering the API
  useIntervalWhen(
    !useMocks && workspaceState === "ready" && allProcessingAreStale,
    () => {
      void loadWorkspace({ silent: true })
    },
    30000,
  )

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (searchQuery && !doc.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false
      }
      if (statusFilter !== "all") {
        if (
          statusFilter === "processing" &&
          !["ingest_requested", "queued", "parsing", "chunking", "embedding"].includes(doc.status)
        ) {
          return false
        }
        if (statusFilter === "ready" && doc.status !== "ready") return false
        if (statusFilter === "failed" && doc.status !== "failed") return false
      }
      if (typeFilter !== "all" && doc.type !== typeFilter) return false
      if (collectionFilter !== "all") {
        if (collectionFilter === "unassigned" && doc.collectionId !== null) return false
        if (collectionFilter !== "unassigned" && doc.collectionId !== collectionFilter) return false
      }
      return true
    })
  }, [documents, searchQuery, statusFilter, typeFilter, collectionFilter])

  const healthStats = useMemo(() => {
    const ready = documents.filter((d) => d.status === "ready")
    const processing = documents.filter((d) =>
      ["ingest_requested", "queued", "parsing", "chunking", "embedding"].includes(d.status)
    )
    const failed = documents.filter((d) => d.status === "failed")
    const totalChunks = ready.reduce((sum, d) => sum + d.chunks, 0)

    return {
      totalDocs: documents.length,
      readyDocs: ready.length,
      processingDocs: processing.length,
      failedDocs: failed.length,
      totalChunks,
    }
  }, [documents])

  const performDelete = useCallback(
    async (docs: KbDocument[]) => {
      if (docs.length === 0) return
      if (!useMocks) {
        setDeleting(true)
        for (const doc of docs) {
          setPendingDeleteId(doc.id)
          const result = await deleteKnowledgeDocument(doc.id).catch(() => ({
            ok: false,
            errorMessage: "Delete failed",
            requestId: undefined as string | undefined,
          }))
          if (!result.ok) {
            const reason = result.errorMessage ?? `Could not delete "${doc.name}".`
            const detail = result.requestId ? `${reason} (request: ${result.requestId})` : reason
            toast({ title: "Delete failed", description: detail, variant: "destructive" })
            setPendingDeleteId(null)
            setDeleting(false)
            return
          }
          setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
          setSelectedIds((prev) => prev.filter((id) => id !== doc.id))
          if (selectedDocument?.id === doc.id) {
            setDrawerOpen(false)
            setSelectedDocument(null)
          }
        }
        setPendingDeleteId(null)
        setDeleting(false)
        try {
          await loadWorkspace({ silent: true })
        } catch {
          /* refresh failed — list still stale */
        }
      } else {
        setDocuments((prev) => prev.filter((d) => !docs.some((x) => x.id === d.id)))
        if (selectedDocument && docs.some((x) => x.id === selectedDocument.id)) {
          setDrawerOpen(false)
          setSelectedDocument(null)
        }
      }

      toast({
        title: "Deleted",
        description:
          docs.length === 1 ? `"${docs[0].name}" was removed` : `${docs.length} documents were removed`,
      })
    },
    [loadWorkspace, selectedDocument, toast],
  )

  const requestDeleteDocument = (doc: KbDocument) => {
    setDeleteTarget({ doc })
  }

  const requestBulkDelete = () => {
    if (selectedIds.length === 0) return
    setDeleteTarget("bulk")
  }

  const handleDeleteConfirmed = () => {
    if (!deleteTarget) return
    if (deleteTarget === "bulk") {
      const docs = documents.filter((d) => selectedIds.includes(d.id))
      setDeleteTarget(null)
      void performDelete(docs)
      return
    }
    const doc = deleteTarget.doc
    setDeleteTarget(null)
    setDrawerOpen(false)
    setSelectedDocument(null)
    void performDelete([doc])
  }

  const handleFilesSelected = async (rawFiles: File[]) => {
    if (rawFiles.length === 0) return

    // Validate regardless of which UI entry point triggered the upload.
    // The dropzone already validates before calling this, but the toolbar's
    // hidden <input> calls this directly without going through the dropzone.
    const { valid: files, rejected } = validateKbFilesForIngest(rawFiles)
    if (rejected.length > 0) {
      toast({
        title: rejected.length === rawFiles.length ? "No supported files" : `${rejected.length} file(s) skipped`,
        description: rejected
          .slice(0, 3)
          .map((r) => r.message)
          .join(" · "),
        variant: "destructive",
      })
    }
    if (files.length === 0) return

    if (useMocks) {
      const newDocs: KbDocument[] = files.map((file, index) => ({
        id: `doc_new_${Date.now()}_${index}`,
        name: file.name,
        type: inferKbFileType(file),
        size: `${(file.size / 1024).toFixed(1)} KB`,
        sizeBytes: file.size,
        collectionId: null,
        collectionName: null,
        status: "queued" as ProcessingStatus,
        processingProgress: 0,
        chunks: 0,
        tokenEstimate: 0,
        usedByAgents: [],
        uploadedAt: new Date(),
        updatedAt: new Date(),
      }))

      setDocuments((prev) => [...newDocs, ...prev])
      toast({
        title: "Upload started",
        description: `${files.length} file(s) queued for processing`,
      })

      newDocs.forEach((doc) => {
        simulateProcessing(doc.id)
      })
      return
    }

    if (isUploading) return
    setIsUploading(true)
    setUploadProgress({ current: 0, total: files.length })

    const targetNamespace =
      collectionFilter !== "all" && collectionFilter !== "unassigned" ? collectionFilter : KB_FALLBACK_NAMESPACE
    let uploaded = 0
    const failed: string[] = []

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!
        setUploadProgress({ current: i + 1, total: files.length })
        const type = inferKbFileType(file)

        const text = (await file.text()).trim()
        if (!text) {
          failed.push(`${file.name} (empty file)`)
          continue
        }

        try {
          const response = await ingestKnowledgeDocument({
            namespace: targetNamespace,
            text,
            metadata: {
              name: file.name,
              filename: file.name,
              type,
              sizeBytes: file.size,
            },
            sync: true,
          })
          if (!response.ok) {
            failed.push(`${file.name} (${response.error ?? "ingest failed"})`)
            continue
          }
          uploaded++
        } catch (err) {
          console.error(err)
          failed.push(`${file.name} (request failed)`)
        }
      }

      await loadWorkspace({ silent: true })

      if (uploaded > 0) {
        toast({
          title: "Knowledge upload complete",
          description: `${uploaded} file(s) embedded in “${targetNamespace}”.`,
        })
      }
      if (failed.length > 0) {
        toast({
          title: "Some files failed to upload",
          description: failed.slice(0, 3).join("; "),
          variant: "destructive",
        })
      }
    } finally {
      setIsUploading(false)
      setUploadProgress(null)
    }
  }

  const simulateProcessing = (docId: string) => {
    const steps: ProcessingStatus[] = ["parsing", "chunking", "embedding", "ready"]
    let stepIndex = 0

    const interval = setInterval(() => {
      if (stepIndex < steps.length) {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  status: steps[stepIndex]!,
                  processingProgress: ((stepIndex + 1) / steps.length) * 100,
                  ...(steps[stepIndex] === "ready"
                    ? {
                        chunks: Math.floor(Math.random() * 100) + 20,
                        tokenEstimate: Math.floor(Math.random() * 30000) + 5000,
                      }
                    : {}),
                }
              : d,
          ),
        )
        stepIndex++
      } else {
        clearInterval(interval)
      }
    }, 1500)
  }

  const handleRowClick = (doc: KbDocument) => {
    setSelectedDocument(doc)
    setDrawerOpen(true)
  }

  const handlePreview = (doc: KbDocument) => {
    setSelectedDocument(doc)
    setDrawerOpen(true)
  }

  const handleAssign = (doc: KbDocument) => {
    if (readOnlyApiUi) {
      toast({
        title: "Collection assignment is mock-only",
        description: "Namespaces are chosen when you upload (or via the collection filter in live mode).",
      })
      return
    }
    setAssigningDocs([doc])
    setAssignModalOpen(true)
  }

  const handleBulkAssign = () => {
    if (readOnlyApiUi) {
      toast({
        title: "Collection assignment is mock-only",
        description: "Namespaces are chosen at upload in live mode.",
      })
      return
    }
    const docs = documents.filter((d) => selectedIds.includes(d.id))
    setAssigningDocs(docs)
    setAssignModalOpen(true)
  }

  const handleAssignConfirm = async (collectionId: string | null) => {
    if (readOnlyApiUi) return
    const collection = collections.find((c) => c.id === collectionId)
    if (useMocks) {
      setDocuments((prev) =>
        prev.map((d) =>
          assigningDocs.some((ad) => ad.id === d.id)
            ? { ...d, collectionId, collectionName: collection?.name || null }
            : d,
        ),
      )
      setSelectedIds([])
      toast({
        title: "Documents assigned",
        description: `${assigningDocs.length} document(s) assigned to ${collection?.name || "Unassigned"}`,
      })
      return
    }

    const targetNamespace =
      collectionId === null ? KB_FALLBACK_NAMESPACE : (collection?.name ?? collectionId).trim() || KB_FALLBACK_NAMESPACE
    const docs = assigningDocs.slice()
    const updateResults = await Promise.all(
      docs.map((doc) => updateKnowledgeDocument(doc.id, { namespace: targetNamespace }).catch(() => ({ ok: false }))),
    )
    const updatedCount = updateResults.filter((result) => result.ok).length
    await loadWorkspace({ silent: true })
    setSelectedIds([])
    toast({
      title: updatedCount > 0 ? "Documents assigned" : "Assignment failed",
      description:
        updatedCount > 0
          ? `${updatedCount} document(s) assigned to ${targetNamespace}.`
          : "No documents were updated.",
      variant: updatedCount > 0 ? "default" : "destructive",
    })
  }

  const handleReprocess = (doc: KbDocument) => {
    if (!useMocks) {
      return
    }
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === doc.id
          ? { ...d, status: "queued" as ProcessingStatus, processingProgress: 0, errorMessage: undefined }
          : d,
      ),
    )
    simulateProcessing(doc.id)
    toast({ title: "Reprocessing", description: `Reprocessing "${doc.name}"` })
  }

  const handleReingest = async (doc: KbDocument) => {
    if (useMocks) {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === doc.id
            ? { ...d, status: "queued" as ProcessingStatus, processingProgress: 0, errorMessage: undefined, updatedAt: new Date() }
            : d,
        ),
      )
      simulateProcessing(doc.id)
      return
    }
    toast({ title: "Re-embedding…", description: `Starting embedding for "${doc.name}"` })
    // Optimistically mark as processing so stale badge clears immediately
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === doc.id
          ? { ...d, status: "chunking" as ProcessingStatus, processingProgress: 30, updatedAt: new Date() }
          : d,
      ),
    )
    try {
      await reingestKnowledgeDocument(doc.id)
      await loadWorkspace({ silent: true })
      toast({ title: "Re-embed complete", description: `"${doc.name}" has been re-embedded.` })
    } catch (e) {
      console.error(e)
      const status = e instanceof ApiError ? e.status : 0
      const msg =
        status === 400
          ? "No stored text — please re-upload the file."
          : status === 401 || status === 403
            ? "Permission denied. You need editor or admin access."
            : status >= 500
              ? "Embedding failed. Check that OPENAI_API_KEY is configured on the server."
              : "Re-embed failed. Try again."
      toast({ title: "Re-embed failed", description: msg, variant: "destructive" })
      // Revert optimistic update
      await loadWorkspace({ silent: true })
    }
  }

  const handleBulkReprocess = () => {
    if (!useMocks) {
      return
    }
    selectedIds.forEach((id) => {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, status: "queued" as ProcessingStatus, processingProgress: 0, errorMessage: undefined }
            : d,
        ),
      )
      simulateProcessing(id)
    })
    toast({ title: "Reprocessing", description: `Reprocessing ${selectedIds.length} document(s)` })
    setSelectedIds([])
  }

  const handleToggleActive = async (doc: KbDocument, active: boolean) => {
    if (useMocks) {
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, isActive: active } : d)))
      toast({
        title: active ? "Document enabled" : "Document disabled",
        description: `"${doc.name}" is now ${active ? "active" : "inactive"} in retrieval.`,
      })
      return
    }

    const result = await updateKnowledgeDocument(doc.id, { active }).catch(() => ({ ok: false }))
    if (!result.ok) {
      toast({
        title: "Update failed",
        description: `Could not ${active ? "enable" : "disable"} "${doc.name}".`,
        variant: "destructive",
      })
      return
    }

    await loadWorkspace({ silent: true })
    toast({
      title: active ? "Document enabled" : "Document disabled",
      description: `"${doc.name}" is now ${active ? "active" : "inactive"} in retrieval.`,
    })
  }

  const handleBulkSetActive = async (active: boolean) => {
    if (selectedIds.length === 0) return

    if (useMocks) {
      setDocuments((prev) => prev.map((d) => (selectedIds.includes(d.id) ? { ...d, isActive: active } : d)))
      toast({
        title: active ? "Documents enabled" : "Documents disabled",
        description: `${selectedIds.length} document(s) updated.`,
      })
      setSelectedIds([])
      return
    }

    const ids = selectedIds.slice()
    const results = await Promise.all(
      ids.map((id) => updateKnowledgeDocument(id, { active }).catch(() => ({ ok: false }))),
    )
    const updatedCount = results.filter((result) => result.ok).length
    await loadWorkspace({ silent: true })
    setSelectedIds([])
    toast({
      title: active ? "Documents enabled" : "Documents disabled",
      description: updatedCount > 0 ? `${updatedCount} document(s) updated.` : "No documents were updated.",
      variant: updatedCount > 0 ? "default" : "destructive",
    })
  }

  const handleDownload = (doc: KbDocument) => {
    if (readOnlyApiUi) {
      toast({
        title: "Download not available",
        description: "The API does not yet expose the original file bytes.",
      })
      return
    }
    toast({ title: "Download started", description: `Downloading "${doc.name}"` })
  }

  const handleViewLogs = (doc: KbDocument) => {
    setSelectedDocument(doc)
    setDrawerOpen(true)
  }

  const handleCreateCollection = (name: string, description: string) => {
    if (readOnlyApiUi) return
    const newCollection: Collection = {
      id: `col_${Date.now()}`,
      name,
      description,
      docsCount: 0,
      usedByAgents: [],
      updatedAt: new Date(),
    }
    setCollections((prev) => [...prev, newCollection])
    toast({ title: "Collection created", description: `"${name}" has been created` })
  }

  const handleDeleteCollection = (id: string) => {
    if (readOnlyApiUi) return
    const collection = collections.find((c) => c.id === id)
    setCollections((prev) => prev.filter((c) => c.id !== id))
    setDocuments((prev) =>
      prev.map((d) => (d.collectionId === id ? { ...d, collectionId: null, collectionName: null } : d)),
    )
    toast({ title: "Collection deleted", description: `"${collection?.name}" has been deleted` })
  }

  const handleRetrievalResultClick = (documentId: string) => {
    const doc = documents.find((d) => d.id === documentId)
    if (doc) {
      setSelectedDocument(doc)
      setDrawerOpen(true)
    }
  }

  const handleLiveRetrievalSearch = async (query: string): Promise<RetrievalResult[]> => {
    const namespaces = [
      ...new Set(
        documents
          .filter((d) => d.status === "ready" && d.isActive)
          .map((d) => (d.collectionName ?? d.collectionId ?? KB_FALLBACK_NAMESPACE).trim())
          .filter((n) => n.length > 0),
      ),
    ]
    if (namespaces.length === 0) return []

    const docsById = new Map(documents.map((d) => [d.id, d]))
    const passages = await retrieveKnowledgePassages({ query, namespaces, topK: 8 })

    return passages.map((p, i) => {
      const meta = p.metadata ?? {}
      const docIdFromMeta = typeof meta.doc_id === "string" ? meta.doc_id : ""
      const mappedDoc = docIdFromMeta ? docsById.get(docIdFromMeta) : undefined
      const docNameFromMeta =
        typeof meta.name === "string" ? meta.name : typeof meta.filename === "string" ? meta.filename : undefined

      return {
        id: p.id ?? `${docIdFromMeta || "doc"}_${i}`,
        documentId: mappedDoc?.id ?? docIdFromMeta,
        documentName: mappedDoc?.name ?? docNameFromMeta ?? "Knowledge document",
        chunkText: p.text,
        score: p.similarity ?? 0,
      }
    })
  }

  const dropzoneCommon = {
    onFilesSelected: handleFilesSelected,
    accept: acceptAttr,
    formatHint,
    disabled: workspaceState !== "ready" || isUploading,
    isUploading,
    uploadCurrentIndex: uploadProgress?.current,
    uploadTotal: uploadProgress?.total,
  }

  const showMainContent = workspaceState === "ready"

  const activeFilterCount = [
    statusFilter !== "all",
    typeFilter !== "all",
    collectionFilter !== "all",
    searchQuery.length > 0,
  ].filter(Boolean).length

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        <input
          ref={uploadInputRef}
          type="file"
          className="hidden"
          accept={acceptAttr}
          multiple
          onChange={(e) => {
            const f = e.target.files
            if (f?.length) void handleFilesSelected(Array.from(f))
            e.target.value = ""
          }}
        />

        <KbToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          collectionFilter={collectionFilter}
          onCollectionFilterChange={setCollectionFilter}
          collections={collections}
          onUploadClick={openFilePicker}
          onCreateCollectionClick={() => setCollectionsModalOpen(true)}
          onRefresh={() => void loadWorkspace({ silent: true })}
          isRefreshing={isRefreshing}
          isUploading={isUploading}
          activeFilterCount={activeFilterCount}
          readOnlyCollectionManagement={readOnlyApiUi}
          actionsDisabled={workspaceState === "loading"}
          filtersDisabled={workspaceState === "loading" || workspaceState === "error"}
        />

        {/* Silent-refresh indicator — thin animated bar, no layout shift */}
        <div
          aria-hidden
          className={cn(
            "h-0.5 w-full rounded-full bg-primary/50 transition-opacity duration-300",
            isRefreshing ? "animate-pulse opacity-100" : "opacity-0",
          )}
        />

        {workspaceState === "error" && (
          <EmptyState
            variant="error"
            title="We couldn’t load your documents"
            description="Check the API URL, sign-in, and that your organization is selected, then try again."
            size="default"
            action={{ label: "Retry", onClick: () => void loadWorkspace() }}
          />
        )}

        {workspaceState === "loading" && (
          <div className="space-y-4">
            <KbHealthStripSkeleton />
            <div className="h-20 rounded-md border-2 border-dashed border-muted-foreground/20 bg-muted/20" />
            <TableSkeleton rows={6} columns={7} />
          </div>
        )}

        {showMainContent && (
          <>
            <KbHealthStrip {...healthStats} />

            {documents.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center border-b border-border/60 pb-8 text-center">
                    <div className="mb-4 rounded-full bg-primary/10 p-3">
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold">Get started with your knowledge base</h2>
                    <p className="mt-2 max-w-md text-sm text-muted-foreground">
                      {readOnlyApiUi
                        ? "Upload TXT or Markdown. Content is embedded into the selected namespace and becomes available to your agents after refresh."
                        : "Upload supported documents. They are chunked, embedded, and then available to your agents."}
                    </p>
                  </div>
                  <div className="pt-6">
                    <UploadDropzone isCompact={false} {...dropzoneCommon} />
                  </div>
                  <ul className="mt-6 max-w-md list-none space-y-3 pl-0 text-left text-sm text-muted-foreground">
                    {[
                      { icon: Upload, t: "Drop files or use Browse — validation runs before upload" },
                      { icon: FileText, t: "Files are ingested, chunked, and embedded for search" },
                      { icon: BookOpen, t: "Your agents can ground answers in this content" },
                    ].map((row, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <row.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{row.t}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : (
              <UploadDropzone isCompact={true} {...dropzoneCommon} />
            )}

            {selectedIds.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 sm:flex-row sm:items-center sm:gap-2">
                <span className="text-sm font-medium">{selectedIds.length} selected</span>
                <div className="flex-1" />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={handleBulkAssign} disabled={readOnlyApiUi} title="Mock-only in dev">
                    <FolderInput className="mr-2 h-4 w-4" />
                    Assign
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleBulkReprocess} disabled={!useMocks} title="Only available in mock mode">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reprocess
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleBulkSetActive(true)}>
                    Enable in KB
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleBulkSetActive(false)}>
                    Disable in KB
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={requestBulkDelete}
                    className="text-destructive hover:text-destructive"
                    disabled={deleting}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            )}

            {filteredDocuments.length > 0 ? (
              <DocumentsTable
                documents={filteredDocuments}
                selectedIds={selectedIds}
                onSelectIds={setSelectedIds}
                onRowClick={handleRowClick}
                onPreview={handlePreview}
                onAssign={handleAssign}
                onReprocess={handleReprocess}
                onReingest={!useMocks ? handleReingest : undefined}
                onToggleActive={(doc, active) => void handleToggleActive(doc, active)}
                onDelete={requestDeleteDocument}
                onViewLogs={handleViewLogs}
                allowAssign={!readOnlyApiUi}
                allowReprocess={useMocks && canReprocess}
                pendingDeleteId={pendingDeleteId}
              />
            ) : documents.length > 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-semibold">No documents match filters</h3>
                  <p className="mt-2 text-center text-sm text-muted-foreground">Try changing search or filter criteria</p>
                  <Button
                    variant="outline"
                    className="mt-4 bg-transparent"
                    onClick={() => {
                      setSearchQuery("")
                      setStatusFilter("all")
                      setTypeFilter("all")
                      setCollectionFilter("all")
                    }}
                  >
                    Clear filters
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {documents.some((d) => d.status === "ready" && d.isActive) && (
              <TestRetrievalCard
                onResultClick={handleRetrievalResultClick}
                onSearch={useMocks ? undefined : handleLiveRetrievalSearch}
              />
            )}
          </>
        )}
      </div>

      <DocumentDrawer
        document={selectedDocument}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onReprocess={handleReprocess}
        onDownload={handleDownload}
        onDelete={requestDeleteDocument}
        isLiveApi={readOnlyApiUi}
      />

      <CollectionsModal
        open={collectionsModalOpen}
        onOpenChange={setCollectionsModalOpen}
        collections={collections}
        onCreateCollection={handleCreateCollection}
        onDeleteCollection={handleDeleteCollection}
        readOnly={readOnlyApiUi}
      />

      <AssignCollectionModal
        open={assignModalOpen}
        onOpenChange={setAssignModalOpen}
        documentNames={assigningDocs.map((d) => d.name)}
        collections={collections}
        onAssign={handleAssignConfirm}
      />

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget === "bulk" ? `Delete ${selectedIds.length} documents?` : "Delete this document?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {readOnlyApiUi
                ? "This removes the document and its stored chunks for your organization. This action cannot be undone."
                : "This removes the document from your private workspace. In mock mode, only the browser state changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                handleDeleteConfirmed()
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ErrorBoundary>
  )
}

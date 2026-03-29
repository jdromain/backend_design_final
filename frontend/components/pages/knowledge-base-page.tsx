"use client"

import { useState, useMemo, useEffect } from "react"
import { FolderInput, RefreshCw, Trash2, FileText, Upload, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { KbToolbar } from "@/components/knowledge/kb-toolbar"
import { KbHealthStrip } from "@/components/knowledge/kb-health-strip"
import { UploadDropzone } from "@/components/knowledge/upload-dropzone"
import { DocumentsTable, type KbDocument, type ProcessingStatus } from "@/components/knowledge/documents-table"
import { DocumentDrawer } from "@/components/knowledge/document-drawer"
import { CollectionsModal, type Collection } from "@/components/knowledge/collections-modal"
import { AssignCollectionModal } from "@/components/knowledge/assign-collection-modal"
import { TestRetrievalCard } from "@/components/knowledge/test-retrieval-card"
import { ErrorBoundary } from "@/components/error-boundary"
import { OnboardingEmptyState } from "@/components/empty-state"
import { TableSkeleton } from "@/components/loading-skeleton"
import { getKnowledgeWorkspace } from "@/lib/data/knowledge"

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export function KnowledgeBasePage() {
  const { toast } = useToast()

  // State
  const [documents, setDocuments] = useState<KbDocument[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [kbLoading, setKbLoading] = useState(true)
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

  useEffect(() => {
    let cancelled = false
    setKbLoading(true)
    getKnowledgeWorkspace()
      .then((w) => {
        if (!cancelled) {
          setDocuments(w.documents)
          setCollections(w.collections)
        }
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) {
          toast({
            title: "Could not load knowledge base",
            description: "Check API connection and auth token.",
            variant: "destructive",
          })
          setDocuments([])
          setCollections([])
        }
      })
      .finally(() => {
        if (!cancelled) setKbLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  // Computed values
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (searchQuery && !doc.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false
      }
      if (statusFilter !== "all") {
        if (statusFilter === "processing" && !["queued", "parsing", "chunking", "embedding"].includes(doc.status)) {
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
    const processing = documents.filter((d) => ["queued", "parsing", "chunking", "embedding"].includes(d.status))
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

  // Handlers
  const handleFilesSelected = (files: File[]) => {
    if (!useMocks) {
      toast({
        title: "Upload via API",
        description: "Document upload is not wired to the UI in API mode yet. Use platform-api POST /kb/docs or enable NEXT_PUBLIC_USE_MOCKS for local demos.",
      })
      return
    }
    const newDocs: KbDocument[] = files.map((file, index) => ({
      id: `doc_new_${Date.now()}_${index}`,
      name: file.name,
      type: (file.name.split(".").pop()?.toLowerCase() as KbDocument["type"]) || "txt",
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

    // Simulate processing
    newDocs.forEach((doc) => {
      simulateProcessing(doc.id)
    })
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
                  status: steps[stepIndex],
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
    setAssigningDocs([doc])
    setAssignModalOpen(true)
  }

  const handleBulkAssign = () => {
    const docs = documents.filter((d) => selectedIds.includes(d.id))
    setAssigningDocs(docs)
    setAssignModalOpen(true)
  }

  const handleAssignConfirm = (collectionId: string | null) => {
    const collection = collections.find((c) => c.id === collectionId)
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
  }

  const handleReprocess = (doc: KbDocument) => {
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

  const handleBulkReprocess = () => {
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

  const handleDelete = (doc: KbDocument) => {
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
    setDrawerOpen(false)
    toast({ title: "Deleted", description: `"${doc.name}" has been deleted` })
  }

  const handleBulkDelete = () => {
    setDocuments((prev) => prev.filter((d) => !selectedIds.includes(d.id)))
    toast({ title: "Deleted", description: `${selectedIds.length} document(s) deleted` })
    setSelectedIds([])
  }

  const handleDownload = (doc: KbDocument) => {
    toast({ title: "Download started", description: `Downloading "${doc.name}"` })
  }

  const handleViewLogs = (doc: KbDocument) => {
    setSelectedDocument(doc)
    setDrawerOpen(true)
  }

  const handleCreateCollection = (name: string, description: string) => {
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

  return (
    <ErrorBoundary>
      <div className="space-y-6">
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
        onUploadClick={() => {}}
        onCreateCollectionClick={() => setCollectionsModalOpen(true)}
      />

      {kbLoading ? (
        <TableSkeleton rows={10} columns={7} />
      ) : (
        <>
      <KbHealthStrip {...healthStats} />

      {/* Upload Area - compact if docs exist */}
      {documents.length === 0 ? (
        <OnboardingEmptyState
          title="Get started with your knowledge base"
          description="Upload documents to help your AI agent answer questions accurately. Supported formats: PDF, DOCX, TXT, MD."
          steps={[
            { icon: Upload, text: "Upload your documents (PDF, DOCX, TXT, MD)" },
            { icon: FileText, text: "Documents are automatically processed and chunked" },
            { icon: BookOpen, text: "Your agent uses this knowledge to answer questions" },
          ]}
          primaryAction={{
            label: "Upload Documents",
            onClick: () => {
              const input = document.createElement("input")
              input.type = "file"
              input.multiple = true
              input.accept = ".pdf,.docx,.txt,.md"
              input.onchange = (e) => {
                const files = Array.from((e.target as HTMLInputElement).files || [])
                if (files.length > 0) handleFilesSelected(files)
              }
              input.click()
            },
          }}
        />
      ) : (
        <UploadDropzone isCompact onFilesSelected={handleFilesSelected} />
      )}

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={handleBulkAssign}>
            <FolderInput className="mr-2 h-4 w-4" />
            Assign
          </Button>
          <Button variant="outline" size="sm" onClick={handleBulkReprocess}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reprocess
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkDelete}
            className="text-destructive hover:text-destructive bg-transparent"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      )}

      {/* Documents Table */}
      {filteredDocuments.length > 0 ? (
        <DocumentsTable
          documents={filteredDocuments}
          selectedIds={selectedIds}
          onSelectIds={setSelectedIds}
          onRowClick={handleRowClick}
          onPreview={handlePreview}
          onAssign={handleAssign}
          onReprocess={handleReprocess}
          onDelete={handleDelete}
          onViewLogs={handleViewLogs}
        />
      ) : documents.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">No documents match filters</h3>
            <p className="mt-2 text-sm text-muted-foreground">Try adjusting your search or filter criteria</p>
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
              Clear Filters
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Test Retrieval */}
      {documents.some((d) => d.status === "ready") && <TestRetrievalCard onResultClick={handleRetrievalResultClick} />}
        </>
      )}

      {/* Document Drawer */}
      <DocumentDrawer
        document={selectedDocument}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onReprocess={handleReprocess}
        onDownload={handleDownload}
        onDelete={handleDelete}
      />

      {/* Collections Modal */}
      <CollectionsModal
        open={collectionsModalOpen}
        onOpenChange={setCollectionsModalOpen}
        collections={collections}
        onCreateCollection={handleCreateCollection}
        onDeleteCollection={handleDeleteCollection}
      />

      {/* Assign Collection Modal */}
      <AssignCollectionModal
        open={assignModalOpen}
        onOpenChange={setAssignModalOpen}
        documentNames={assigningDocs.map((d) => d.name)}
        collections={collections}
        onAssign={handleAssignConfirm}
      />
      </div>
    </ErrorBoundary>
  )
}

import { assertMockSafety } from "./_env-check"
import { getMockKnowledgeCollections, getMockKnowledgeDocuments } from "@/data/mock/knowledge"
import type { KbDocument, ProcessingStatus } from "@/components/knowledge/documents-table"
import type { Collection } from "@/components/knowledge/collections-modal"
import { appendOrgQuery, get, post } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export type KbDocumentApiRow = {
  id: string
  namespace: string
  name: string
  type: KbDocument["type"]
  sizeBytes: number
  status: "chunking" | "ready" | "failed"
  chunks: number
  ingestedAt: string
  updatedAt: string
}

type IngestKnowledgeBody = {
  namespace: string
  text: string
  metadata?: Record<string, unknown>
  doc_id?: string
  sync?: boolean
}

type IngestKnowledgeResponse = {
  ok: boolean
  doc_id: string
  chunks?: number
  mode?: "sync" | "async"
  error?: string
}

type KbRetrievePassage = {
  id: string
  text: string
  metadata?: Record<string, unknown>
  similarity?: number
}

type KbRetrieveResponse = {
  passages: KbRetrievePassage[]
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function mapRowToKbDocument(row: KbDocumentApiRow): KbDocument {
  const progress = row.status === "ready" ? 100 : row.status === "failed" ? 30 : 55
  const procStatus: ProcessingStatus =
    row.status === "ready" ? "ready" : row.status === "failed" ? "failed" : "chunking"
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    size: formatBytes(row.sizeBytes),
    sizeBytes: row.sizeBytes,
    collectionId: row.namespace,
    collectionName: row.namespace,
    status: procStatus,
    processingProgress: progress,
    chunks: row.chunks,
    tokenEstimate: 0,
    usedByAgents: [],
    uploadedAt: new Date(row.ingestedAt),
    updatedAt: new Date(row.updatedAt),
  }
}

function deriveCollections(docs: KbDocument[]): Collection[] {
  const groups = new Map<string, KbDocument[]>()
  for (const d of docs) {
    const key = d.collectionName ?? d.collectionId ?? "default"
    const label = typeof key === "string" ? key : "default"
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(d)
  }
  return [...groups.entries()].map(([name, list]) => ({
    id: name,
    name,
    description: `Namespace: ${name}`,
    docsCount: list.length,
    usedByAgents: [] as string[],
    updatedAt: new Date(Math.max(0, ...list.map((x) => x.updatedAt.getTime()))),
  }))
}

export async function getKnowledgeWorkspace(): Promise<{ documents: KbDocument[]; collections: Collection[] }> {
  if (useMocks) {
    const documents = getMockKnowledgeDocuments()
    return { documents, collections: getMockKnowledgeCollections() }
  }
  const res = await get<{ documents: KbDocumentApiRow[] }>(appendOrgQuery("/knowledge/documents"))
  const documents = (res.documents ?? []).map(mapRowToKbDocument)
  return {
    documents,
    collections: documents.length > 0 ? deriveCollections(documents) : [],
  }
}

export async function ingestKnowledgeDocument(input: IngestKnowledgeBody): Promise<IngestKnowledgeResponse> {
  if (useMocks) {
    return {
      ok: true,
      doc_id: input.doc_id ?? `mock_${Date.now()}`,
      chunks: Math.max(1, Math.floor(input.text.length / 1200)),
      mode: "sync",
    }
  }
  return post<IngestKnowledgeResponse>(appendOrgQuery("/kb/docs"), {
    namespace: input.namespace,
    text: input.text,
    metadata: input.metadata ?? {},
    doc_id: input.doc_id,
    sync: input.sync ?? true,
  })
}

export async function retrieveKnowledgePassages(params: {
  query: string
  namespaces: string[]
  topK?: number
}): Promise<KbRetrievePassage[]> {
  if (useMocks) return []

  const uniqueNamespaces = [...new Set(params.namespaces.map((n) => n.trim()).filter(Boolean))]
  if (uniqueNamespaces.length === 0) return []

  const results = await Promise.all(
    uniqueNamespaces.map((namespace) =>
      post<KbRetrieveResponse>(appendOrgQuery("/kb/retrieve"), {
        namespace,
        query: params.query,
        topK: params.topK ?? 5,
      }).catch(() => ({ passages: [] })),
    ),
  )

  return results
    .flatMap((r) => r.passages ?? [])
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, params.topK ?? 8)
}

import { assertMockSafety } from "./_env-check"
import { getMockKnowledgeCollections, getMockKnowledgeDocuments } from "@/data/mock/knowledge"
import type { KbDocument, ProcessingStatus } from "@/components/knowledge/documents-table"
import type { Collection } from "@/components/knowledge/collections-modal"
import { get } from "@/lib/api-client"

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
  const res = await get<{ documents: KbDocumentApiRow[] }>("/knowledge/documents")
  const documents = (res.documents ?? []).map(mapRowToKbDocument)
  return {
    documents,
    collections: documents.length > 0 ? deriveCollections(documents) : [],
  }
}

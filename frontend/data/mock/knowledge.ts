// Demo KB documents when NEXT_PUBLIC_USE_MOCKS=true — do not import from pages directly; use lib/data/knowledge.ts.

import type { KbDocument } from "@/components/knowledge/documents-table"
import type { Collection } from "@/components/knowledge/collections-modal"

export function getMockKnowledgeDocuments(): KbDocument[] {
  const now = Date.now()
  return [
    {
      id: "doc_001",
      name: "Restaurant Menu FAQ",
      type: "pdf",
      size: "2.4 MB",
      sizeBytes: 2516582,
      collectionId: "col_001",
      collectionName: "Menu & Hours",
      status: "ready",
      processingProgress: 100,
      chunks: 128,
      tokenEstimate: 45000,
      isActive: true,
      usedByAgents: ["Customer Support Agent"],
      uploadedAt: new Date(now - 1000 * 60 * 60 * 24 * 2),
      updatedAt: new Date(now - 1000 * 60 * 60 * 24 * 2),
    },
    {
      id: "doc_002",
      name: "Booking Policies",
      type: "docx",
      size: "156 KB",
      sizeBytes: 159744,
      collectionId: "col_002",
      collectionName: "Policies",
      status: "ready",
      processingProgress: 100,
      chunks: 45,
      tokenEstimate: 12000,
      isActive: true,
      usedByAgents: ["Customer Support Agent"],
      uploadedAt: new Date(now - 1000 * 60 * 60 * 24 * 5),
      updatedAt: new Date(now - 1000 * 60 * 60 * 24 * 5),
    },
    {
      id: "doc_003",
      name: "Special Events Guide",
      type: "pdf",
      size: "4.1 MB",
      sizeBytes: 4299161,
      collectionId: null,
      collectionName: null,
      status: "chunking",
      processingProgress: 65,
      chunks: 0,
      tokenEstimate: 0,
      isActive: true,
      usedByAgents: [],
      uploadedAt: new Date(now - 1000 * 60 * 60 * 2),
      updatedAt: new Date(now - 1000 * 60 * 30),
    },
  ]
}

export function getMockKnowledgeCollections(): Collection[] {
  const now = Date.now()
  return [
    {
      id: "col_001",
      name: "Menu & Hours",
      description: "Restaurant menu items, pricing, and operating hours",
      docsCount: 2,
      usedByAgents: ["Customer Support Agent"],
      updatedAt: new Date(now - 1000 * 60 * 60 * 24),
    },
    {
      id: "col_002",
      name: "Policies",
      description: "Booking policies, cancellation rules, and procedures",
      docsCount: 1,
      usedByAgents: ["Customer Support Agent"],
      updatedAt: new Date(now - 1000 * 60 * 60 * 24 * 3),
    },
  ]
}

"use client"

import type React from "react"

import { useState } from "react"
import { Search, Play, FileText, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface RetrievalResult {
  id: string
  documentId: string
  documentName: string
  chunkText: string
  score: number
}

interface TestRetrievalCardProps {
  onResultClick: (documentId: string) => void
  onSearch?: (query: string) => Promise<RetrievalResult[]>
}

const MOCK_RESULTS: RetrievalResult[] = [
  {
    id: "r1",
    documentId: "doc_001",
    documentName: "Restaurant Menu FAQ",
    chunkText:
      "Our restaurant offers a variety of vegetarian and vegan options. Please inform your server of any dietary restrictions when ordering...",
    score: 0.92,
  },
  {
    id: "r2",
    documentId: "doc_002",
    documentName: "Booking Policies",
    chunkText:
      "Reservations can be made up to 30 days in advance. For parties larger than 8, a deposit may be required...",
    score: 0.87,
  },
  {
    id: "r3",
    documentId: "doc_004",
    documentName: "Customer Service Scripts",
    chunkText:
      "When a customer asks about wait times, respond with: Thank you for your patience. Current wait time is approximately...",
    score: 0.78,
  },
]

export function TestRetrievalCard({ onResultClick, onSearch }: TestRetrievalCardProps) {
  const [query, setQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<RetrievalResult[]>([])

  const handleSearch = async () => {
    if (!query.trim()) return

    setIsSearching(true)
    try {
      if (onSearch) {
        const liveResults = await onSearch(query)
        setResults(liveResults)
      } else {
        // Simulate search delay
        await new Promise((r) => setTimeout(r, 800))
        setResults(MOCK_RESULTS)
      }
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch()
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Search className="h-4 w-4" />
          Test Retrieval
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter a test query..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button onClick={handleSearch} disabled={!query.trim() || isSearching}>
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          </Button>
        </div>

        {results.length > 0 && (
          <ScrollArea className="h-[200px]">
            <div className="space-y-2">
              {results.map((result) => (
                <div
                  key={result.id}
                  className="p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => onResultClick(result.documentId)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">{result.documentName}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs font-mono">
                      {(result.score * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{result.chunkText}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {results.length === 0 && !isSearching && query && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Enter a query and click Run to test retrieval
          </p>
        )}
      </CardContent>
    </Card>
  )
}

"use client"

/** Static in-product help articles (not loaded from API). */

import { useState } from "react"
import { Search, FileText } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

const categories = ["Getting started", "Live Calls", "Agents", "Knowledge Base", "Billing", "Integrations", "Settings"]

interface Article {
  id: string
  title: string
  snippet: string
  category: string
}

const allArticles: Article[] = [
  {
    id: "1",
    title: "What 'Tool Error' means and how to fix it",
    snippet: "Learn about common tool errors and troubleshooting steps...",
    category: "Agents",
  },
  {
    id: "2",
    title: "Why KB ingestion can fail",
    snippet: "Understanding the common causes of knowledge base processing failures...",
    category: "Knowledge Base",
  },
  {
    id: "3",
    title: "Understanding agent performance metrics",
    snippet: "A guide to interpreting handled rate, escalation rate, and other KPIs...",
    category: "Agents",
  },
  {
    id: "4",
    title: "How to export call history",
    snippet: "Step-by-step instructions for exporting your call records...",
    category: "Live Calls",
  },
  {
    id: "5",
    title: "Setting up your first AI agent",
    snippet: "A complete walkthrough for creating and configuring a new agent...",
    category: "Getting started",
  },
  {
    id: "6",
    title: "Connecting Stripe for billing",
    snippet: "Instructions for integrating Stripe payment processing...",
    category: "Billing",
  },
  {
    id: "7",
    title: "Webhook configuration guide",
    snippet: "How to set up and test webhooks for real-time notifications...",
    category: "Integrations",
  },
  {
    id: "8",
    title: "Managing team permissions",
    snippet: "Understanding roles and access control for your workspace...",
    category: "Settings",
  },
]

interface SearchHelpCenterProps {
  onArticleClick: (article: Article) => void
}

export function SearchHelpCenter({ onArticleClick }: SearchHelpCenterProps) {
  const [query, setQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const filteredArticles = allArticles.filter((article) => {
    const matchesQuery =
      query === "" ||
      article.title.toLowerCase().includes(query.toLowerCase()) ||
      article.snippet.toLowerCase().includes(query.toLowerCase())
    const matchesCategory = !selectedCategory || article.category === selectedCategory
    return matchesQuery && matchesCategory
  })

  const showResults = query.length > 0 || selectedCategory

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search articles, troubleshooting, billing, agents…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 h-12 text-base"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <Badge
            key={cat}
            variant={selectedCategory === cat ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
          >
            {cat}
          </Badge>
        ))}
      </div>

      {showResults && (
        <div className="space-y-2 mt-4">
          {filteredArticles.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">No results found. Try a different keyword.</p>
          ) : (
            filteredArticles.map((article) => (
              <button
                key={article.id}
                onClick={() => onArticleClick(article)}
                className="w-full text-left p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{article.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{article.snippet}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {article.category}
                  </Badge>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export type { Article }

"use client"

import { FileText, ChevronRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { Article } from "./search-help-center"

const popularArticles: Article[] = [
  {
    id: "p1",
    title: "Why calls show 'At Risk'",
    snippet: "Understanding call risk indicators and how to address them",
    category: "Live Calls",
  },
  {
    id: "p2",
    title: "Fixing tool timeouts",
    snippet: "Troubleshooting slow or failed tool invocations",
    category: "Agents",
  },
  {
    id: "p3",
    title: "Uploading docs to Knowledge Base",
    snippet: "Supported formats and best practices for document ingestion",
    category: "Knowledge Base",
  },
  {
    id: "p4",
    title: "Understanding escalation vs failure",
    snippet: "The difference between call outcomes and when each applies",
    category: "Agents",
  },
]

interface PopularArticlesProps {
  onArticleClick: (article: Article) => void
}

export function PopularArticles({ onArticleClick }: PopularArticlesProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Popular Articles</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {popularArticles.map((article) => (
          <Card
            key={article.id}
            className="cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => onArticleClick(article)}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{article.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{article.snippet}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

"use client"

import { useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ThumbsUp, ThumbsDown, ExternalLink, Clock } from "lucide-react"
import type { Article } from "./search-help-center"

interface ArticleDrawerProps {
  article: Article | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const articleContent: Record<string, { steps: string[]; relatedLinks: { title: string; href: string }[] }> = {
  "Why calls show 'At Risk'": {
    steps: [
      "Calls are marked 'At Risk' when the system detects potential issues that may lead to escalation or failure.",
      "Common triggers include: long silence periods, repeated tool failures, or negative sentiment detection.",
      "To resolve: Check the call's timeline for specific events that triggered the warning.",
      "Consider adjusting your agent's escalation thresholds in the Agent settings if you're seeing too many false positives.",
    ],
    relatedLinks: [
      { title: "Understanding escalation vs failure", href: "#" },
      { title: "Configuring agent thresholds", href: "#" },
    ],
  },
  "Fixing tool timeouts": {
    steps: [
      "Tool timeouts occur when an external service doesn't respond within the configured time limit.",
      "Check the tool's health status in the Integrations page.",
      "Review recent tool latency in Analytics to identify patterns.",
      "Consider increasing the timeout threshold for slow but reliable services.",
      "Set up fallback responses for when tools are unavailable.",
    ],
    relatedLinks: [
      { title: "Configuring tool timeouts", href: "#" },
      { title: "Setting up fallback responses", href: "#" },
    ],
  },
}

export function ArticleDrawer({ article, open, onOpenChange }: ArticleDrawerProps) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null)
  const [feedbackSent, setFeedbackSent] = useState(false)

  if (!article) return null

  const content = articleContent[article.title] || {
    steps: [
      "This article provides guidance on the selected topic.",
      "Follow the steps below to resolve common issues.",
      "Contact support if you need additional assistance.",
    ],
    relatedLinks: [],
  }

  const handleFeedback = (type: "up" | "down") => {
    setFeedback(type)
    setFeedbackSent(true)
    setTimeout(() => setFeedbackSent(false), 3000)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline">{article.category}</Badge>
          </div>
          <SheetTitle className="text-xl">{article.title}</SheetTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3 w-3" />
            Last updated: 2 days ago
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="space-y-4">
            {content.steps.map((step, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium shrink-0">
                  {i + 1}
                </div>
                <p className="text-sm leading-relaxed pt-0.5">{step}</p>
              </div>
            ))}
          </div>

          {content.relatedLinks.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Related Articles</h3>
                {content.relatedLinks.map((link, i) => (
                  <a key={i} href={link.href} className="flex items-center gap-2 text-sm text-primary hover:underline">
                    {link.title}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Was this article helpful?</p>
            <div className="flex items-center gap-2">
              <Button
                variant={feedback === "up" ? "default" : "outline"}
                size="sm"
                onClick={() => handleFeedback("up")}
                disabled={feedbackSent}
              >
                <ThumbsUp className="h-4 w-4 mr-1" />
                Yes
              </Button>
              <Button
                variant={feedback === "down" ? "default" : "outline"}
                size="sm"
                onClick={() => handleFeedback("down")}
                disabled={feedbackSent}
              >
                <ThumbsDown className="h-4 w-4 mr-1" />
                No
              </Button>
              {feedbackSent && <span className="text-sm text-muted-foreground ml-2">Thanks for your feedback!</span>}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

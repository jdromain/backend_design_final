"use client"

import * as React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  BarChart3,
  Activity,
  History,
  TrendingUp,
  Bot,
  BookOpen,
  Puzzle,
  CreditCard,
  Settings,
  HelpCircle,
  Phone,
  FileText,
  AlertTriangle,
  PhoneOff,
  Pause,
  Loader,
  Clock,
  X,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Zap,
  User,
  ListTodo,
  Upload,
  Plus,
} from "lucide-react"
import {
  scoreMatch,
  highlightMatch,
  getRecentSearches,
  addRecentSearch,
  clearRecentSearches,
  type SearchResult,
} from "@/lib/search-utils"
import {
  mockPages,
  mockCalls,
  mockAgents,
  mockKbDocs,
  mockIntegrations,
  mockSettingsSections,
  quickFilters,
  mockContacts,
  mockFollowUps,
  mockWorkflows,
  suggestedActions,
  fetchLiveSearch,
  includeMockSearchCorpus,
  type LiveSearchApiResponse,
} from "@/lib/data/search"

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  BarChart3,
  Activity,
  History,
  TrendingUp,
  Bot,
  BookOpen,
  Puzzle,
  CreditCard,
  Settings,
  HelpCircle,
  Phone,
  FileText,
  AlertTriangle,
  PhoneOff,
  Pause,
  Loader,
  Clock,
  Zap,
  User,
  ListTodo,
  Upload,
  Plus,
}

interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (page: string, queryParams?: Record<string, string>) => void
}

export function GlobalSearch({ open, onOpenChange, onNavigate }: GlobalSearchProps) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [liveSearch, setLiveSearch] = useState<LiveSearchApiResponse | null>(null)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const previousFocusRef = React.useRef<HTMLElement | null>(null)

  // Store previous focus element when opening
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement
    } else {
      // Restore focus when closing
      if (previousFocusRef.current) {
        previousFocusRef.current.focus()
      }
    }
  }, [open])

  // Load recent searches on mount
  useEffect(() => {
    setRecentSearches(getRecentSearches())
  }, [open])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (useMocks && query) {
      setIsLoading(true)
      const t = setTimeout(() => setIsLoading(false), 300)
      return () => clearTimeout(t)
    }
    if (!query) setIsLoading(false)
    return undefined
  }, [query])

  useEffect(() => {
    if (useMocks || !debouncedQuery.trim()) {
      setLiveSearch(null)
      if (!useMocks) setIsLoading(false)
      return
    }
    let cancelled = false
    setIsLoading(true)
    fetchLiveSearch(debouncedQuery)
      .then((data) => {
        if (!cancelled) setLiveSearch(data)
      })
      .catch(() => {
        if (!cancelled) setLiveSearch(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  // Search and score results
  const results = useMemo(() => {
    if (!debouncedQuery.trim()) return null

    const searchResults: SearchResult[] = []

    // Search pages
    for (const page of mockPages) {
      const { score, ranges } = scoreMatch(debouncedQuery, page.label)
      if (score > 0) {
        searchResults.push({
          id: page.id,
          type: "page",
          label: page.label,
          icon: page.icon,
          route: page.route,
          score,
          matchRanges: ranges,
        })
      }
    }

    const mockCorpus = useMocks || includeMockSearchCorpus

    if (mockCorpus) {
      for (const call of mockCalls) {
        const callerScore = scoreMatch(debouncedQuery, call.caller)
        const agentScore = scoreMatch(debouncedQuery, call.agent)
        const outcomeScore = scoreMatch(debouncedQuery, call.outcome)
        const bestScore = Math.max(callerScore.score, agentScore.score, outcomeScore.score)

        if (bestScore > 0) {
          const badge =
            call.outcome === "failed"
              ? { label: "Failed", variant: "destructive" as const }
              : call.outcome === "escalated"
                ? { label: "Escalated", variant: "warning" as const }
                : undefined

          searchResults.push({
            id: call.id,
            type: "call",
            label: call.caller,
            meta: `${call.outcome} • ${call.duration} • ${call.agent} • ${call.time}`,
            badge,
            icon: "Phone",
            route: "history",
            queryParams: { callId: call.id },
            score: bestScore,
            matchRanges: callerScore.score >= agentScore.score ? callerScore.ranges : [],
          })
        }
      }

      for (const agent of mockAgents) {
        const { score, ranges } = scoreMatch(debouncedQuery, agent.name)
        if (score > 0) {
          const badge =
            agent.status === "paused"
              ? { label: "Paused", variant: "warning" as const }
              : agent.status === "draft"
                ? { label: "Draft", variant: "default" as const }
                : undefined

          searchResults.push({
            id: agent.id,
            type: "agent",
            label: agent.name,
            meta: `${agent.status} • ${agent.handledRate}% handled • ${agent.failRate}% fail`,
            badge,
            icon: "Bot",
            route: "agents",
            queryParams: { agentId: agent.id, search: agent.name },
            score,
            matchRanges: ranges,
          })
        }
      }

      for (const doc of mockKbDocs) {
        const titleScore = scoreMatch(debouncedQuery, doc.title)
        const collectionScore = scoreMatch(debouncedQuery, doc.collection)
        const bestScore = Math.max(titleScore.score, collectionScore.score)

        if (bestScore > 0) {
          const badge =
            doc.status === "processing"
              ? { label: "Processing", variant: "warning" as const }
              : doc.status === "failed"
                ? { label: "Failed", variant: "destructive" as const }
                : undefined

          searchResults.push({
            id: doc.id,
            type: "kb-doc",
            label: doc.title,
            meta: `${doc.collection} • ${doc.updatedAt}`,
            badge,
            icon: "FileText",
            route: "knowledge",
            queryParams: { docId: doc.id },
            score: bestScore,
            matchRanges: titleScore.ranges,
          })
        }
      }

      for (const integration of mockIntegrations) {
        const { score, ranges } = scoreMatch(debouncedQuery, integration.name)
        if (score > 0) {
          const badge =
            integration.status === "error"
              ? { label: "Error", variant: "destructive" as const }
              : integration.status === "degraded"
                ? { label: "Degraded", variant: "warning" as const }
                : undefined

          searchResults.push({
            id: integration.id,
            type: "integration",
            label: integration.name,
            meta: integration.status === "ok" ? "Connected" : integration.status,
            badge,
            icon: "Puzzle",
            route: "integrations",
            queryParams: { integrationId: integration.id },
            score,
            matchRanges: ranges,
          })
        }
      }
    } else if (liveSearch) {
      for (const call of liveSearch.calls) {
        const haystack = `${call.caller_number} ${call.classified_intent ?? ""}`
        const { score, ranges } = scoreMatch(debouncedQuery, haystack)
        if (score > 0) {
          searchResults.push({
            id: call.call_id,
            type: "call",
            label: call.caller_number,
            meta: `${call.classified_intent ?? "Unclassified"} • ${new Date(call.started_at).toLocaleString()}`,
            icon: "Phone",
            route: "history",
            queryParams: { callId: call.call_id },
            score,
            matchRanges: ranges,
          })
        }
      }

      for (const c of liveSearch.contacts) {
        const haystack = `${c.name ?? ""} ${c.phone ?? ""} ${c.email ?? ""}`
        const { score, ranges } = scoreMatch(debouncedQuery, haystack)
        if (score > 0) {
          const label = c.name || c.phone || c.email || c.id
          searchResults.push({
            id: c.id,
            type: "contact",
            label,
            meta: [c.phone, c.email].filter(Boolean).join(" • ") || undefined,
            icon: "User",
            route: "actions",
            queryParams: { contactId: c.id },
            score,
            matchRanges: ranges,
          })
        }
      }

      for (const f of liveSearch.followUps) {
        const haystack = `${f.type} ${f.notes ?? ""} ${f.status}`
        const { score, ranges } = scoreMatch(debouncedQuery, haystack)
        if (score > 0) {
          searchResults.push({
            id: f.id,
            type: "follow-up",
            label: f.type.replace(/_/g, " "),
            meta: f.status,
            icon: "ListTodo",
            route: "actions",
            queryParams: { followUpId: f.id, tab: "follow-ups" },
            score,
            matchRanges: ranges,
          })
        }
      }

      for (const w of liveSearch.workflows) {
        const haystack = `${w.name} ${w.trigger_key ?? ""}`
        const { score, ranges } = scoreMatch(debouncedQuery, haystack)
        if (score > 0) {
          searchResults.push({
            id: w.id,
            type: "workflow",
            label: w.name,
            meta: w.trigger_key ?? "",
            icon: "Zap",
            route: "actions",
            queryParams: { workflowId: w.id, tab: "workflows" },
            score,
            matchRanges: ranges,
          })
        }
      }

      for (const d of liveSearch.kbDocs) {
        const haystack = `${d.doc_id} ${d.namespace ?? ""}`
        const { score, ranges } = scoreMatch(debouncedQuery, haystack)
        if (score > 0) {
          searchResults.push({
            id: d.id,
            type: "kb-doc",
            label: d.doc_id,
            meta: d.namespace ?? "",
            icon: "FileText",
            route: "knowledge",
            queryParams: { docId: d.id },
            score,
            matchRanges: ranges,
          })
        }
      }

      for (const u of liveSearch.users) {
        const haystack = `${u.name ?? ""} ${u.email ?? ""}`
        const { score, ranges } = scoreMatch(debouncedQuery, haystack)
        if (score > 0) {
          searchResults.push({
            id: u.id,
            type: "page",
            label: u.name || u.email || "User",
            meta: u.email ?? "",
            icon: "User",
            route: "settings",
            queryParams: {},
            score,
            matchRanges: ranges,
          })
        }
      }
    }

    // Search settings sections
    for (const section of mockSettingsSections) {
      const { score, ranges } = scoreMatch(debouncedQuery, section.label)
      if (score > 0) {
        searchResults.push({
          id: section.id,
          type: "settings",
          label: section.label,
          icon: "Settings",
          route: "settings",
          queryParams: { section: section.id },
          score,
          matchRanges: ranges,
        })
      }
    }

    if (mockCorpus) {
      for (const contact of mockContacts) {
        const nameScore = contact.name ? scoreMatch(debouncedQuery, contact.name) : { score: 0, ranges: [] }
        const phoneScore = scoreMatch(debouncedQuery, contact.phone)
        const bestScore = Math.max(nameScore.score, phoneScore.score)

        if (bestScore > 0) {
          searchResults.push({
            id: contact.id,
            type: "contact",
            label: contact.name || contact.phone,
            meta: contact.name ? contact.phone : undefined,
            icon: "User",
            route: "actions",
            queryParams: { contactId: contact.id },
            score: bestScore,
            matchRanges: nameScore.score >= phoneScore.score ? nameScore.ranges : phoneScore.ranges,
          })
        }
      }

      for (const followUp of mockFollowUps) {
        const contactScore = scoreMatch(debouncedQuery, followUp.contact)
        const typeScore = scoreMatch(debouncedQuery, followUp.type.replace(/_/g, " "))
        const bestScore = Math.max(contactScore.score, typeScore.score)

        if (bestScore > 0) {
          const badge =
            followUp.status === "open"
              ? { label: "Open", variant: "default" as const }
              : followUp.status === "in_progress"
                ? { label: "In Progress", variant: "warning" as const }
                : undefined

          searchResults.push({
            id: followUp.id,
            type: "follow-up",
            label: `${followUp.contact} - ${followUp.type.replace(/_/g, " ")}`,
            meta: `${followUp.status} • Due: ${followUp.dueAt}`,
            badge,
            icon: "ListTodo",
            route: "actions",
            queryParams: { followUpId: followUp.id, tab: "follow-ups" },
            score: bestScore,
            matchRanges: contactScore.ranges,
          })
        }
      }

      for (const workflow of mockWorkflows) {
        const { score, ranges } = scoreMatch(debouncedQuery, workflow.name)
        if (score > 0) {
          const badge = !workflow.enabled ? { label: "Disabled", variant: "default" as const } : undefined

          searchResults.push({
            id: workflow.id,
            type: "workflow",
            label: workflow.name,
            meta: `${workflow.vertical} • ${workflow.enabled ? "Enabled" : "Disabled"}`,
            badge,
            icon: "Zap",
            route: "actions",
            queryParams: { workflowId: workflow.id, tab: "workflows" },
            score,
            matchRanges: ranges,
          })
        }
      }
    }

    // Search quick filters
    for (const filter of quickFilters) {
      const { score, ranges } = scoreMatch(debouncedQuery, filter.label)
      if (score > 0) {
        searchResults.push({
          id: filter.id,
          type: "page",
          label: filter.label,
          icon: filter.icon,
          route: filter.route,
          queryParams: filter.queryParams,
          score,
          matchRanges: ranges,
        })
      }
    }

    // Sort by score descending
    searchResults.sort((a, b) => b.score - a.score)

    return searchResults
  }, [debouncedQuery, liveSearch])

  // Group results by type
  const groupedResults = useMemo(() => {
    if (!results) return null

    const groups: Record<string, SearchResult[]> = {
      page: [],
      call: [],
      agent: [],
      contact: [],
      "follow-up": [],
      workflow: [],
      "kb-doc": [],
      integration: [],
      settings: [],
    }

    for (const result of results) {
      groups[result.type].push(result)
    }

    return groups
  }, [results])

  const handleSelect = useCallback(
    (result: SearchResult) => {
      addRecentSearch(query)
      setRecentSearches(getRecentSearches())
      onNavigate(result.route, result.queryParams)
      onOpenChange(false)
      setQuery("")
    },
    [query, onNavigate, onOpenChange],
  )

  const handleRecentSelect = useCallback((search: string) => {
    setQuery(search)
  }, [])

  const handleClearRecent = useCallback(() => {
    clearRecentSearches()
    setRecentSearches([])
  }, [])

  const totalResults = results?.length ?? 0
  const hasResults = totalResults > 0
  const showRecent = !query && recentSearches.length > 0

  const groupLabels: Record<string, string> = {
    page: "Pages",
    call: "Calls",
    agent: "Agents",
    contact: "Contacts",
    "follow-up": "Follow-ups",
    workflow: "Workflows",
    "kb-doc": "Knowledge Base",
    integration: "Integrations",
    settings: "Settings",
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Global Search</DialogTitle>
        <DialogDescription>Search across pages, calls, agents, documents, and settings</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="overflow-hidden p-0 max-w-2xl"
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium">
          <div className="flex items-center border-b px-3">
            <CommandInput
              placeholder="Search pages, calls, agents, contacts, follow-ups, workflows..."
              value={query}
              onValueChange={setQuery}
              className="h-12"
            />
            {query && (
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setQuery("")}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <CommandList className="max-h-[400px]">
            {isLoading && query ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
              </div>
            ) : (
              <>
                {/* Recent searches */}
                {showRecent && (
                  <CommandGroup
                    heading={
                      <div className="flex items-center justify-between">
                        <span>Recent</span>
                        <Button variant="ghost" size="sm" className="h-5 text-xs px-1.5" onClick={handleClearRecent}>
                          Clear
                        </Button>
                      </div>
                    }
                  >
                    {recentSearches.map((search, i) => (
                      <CommandItem
                        key={`recent-${i}`}
                        value={`recent-${search}`}
                        onSelect={() => handleRecentSelect(search)}
                      >
                        <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>{search}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {!query && !showRecent && (
                  <>
                    {(useMocks || includeMockSearchCorpus) && (
                    <CommandGroup heading="Suggested Actions">
                      {suggestedActions.map((action) => {
                        const Icon = iconMap[action.icon] || Zap
                        return (
                          <CommandItem
                            key={action.id}
                            value={action.label}
                            onSelect={() => {
                              onNavigate(action.route, { action: action.action })
                              onOpenChange(false)
                            }}
                          >
                            <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>{action.label}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              <CornerDownLeft className="h-3 w-3" />
                            </span>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                    )}
                    {(useMocks || includeMockSearchCorpus) && <CommandSeparator />}
                    <CommandGroup heading="Quick Filters">
                      {quickFilters.map((filter) => {
                        const Icon = iconMap[filter.icon] || FileText
                        return (
                          <CommandItem
                            key={filter.id}
                            value={filter.label}
                            onSelect={() => {
                              onNavigate(filter.route, filter.queryParams)
                              onOpenChange(false)
                            }}
                          >
                            <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>{filter.label}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              <CornerDownLeft className="h-3 w-3" />
                            </span>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </>
                )}

                {/* No results */}
                {query && !isLoading && !hasResults && (
                  <CommandEmpty>
                    <div className="py-6 text-center">
                      <p className="text-sm text-muted-foreground">No results found for "{query}"</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Try searching for "agents", "failed calls", "billing", "follow-ups", or "workflows"
                      </p>
                    </div>
                  </CommandEmpty>
                )}

                {/* Grouped results */}
                {groupedResults &&
                  Object.entries(groupedResults).map(([type, items]) => {
                    if (items.length === 0) return null

                    return (
                      <React.Fragment key={type}>
                        <CommandGroup heading={groupLabels[type]}>
                          {items.slice(0, 5).map((result) => {
                            const Icon = iconMap[result.icon] || FileText
                            return (
                              <CommandItem
                                key={result.id}
                                value={`${result.type}-${result.id}-${result.label}`}
                                onSelect={() => handleSelect(result)}
                                className="flex items-center justify-between"
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate">
                                        {highlightMatch(result.label, result.matchRanges)}
                                      </span>
                                      {result.badge && (
                                        <Badge
                                          variant={
                                            result.badge.variant === "warning" ? "outline" : result.badge.variant
                                          }
                                          className={cn(
                                            "shrink-0 text-[10px] px-1 py-0",
                                            result.badge.variant === "warning" && "border-amber-500 text-amber-500",
                                          )}
                                        >
                                          {result.badge.label}
                                        </Badge>
                                      )}
                                    </div>
                                    {result.meta && (
                                      <p className="text-xs text-muted-foreground truncate">{result.meta}</p>
                                    )}
                                  </div>
                                </div>
                                <span className="ml-2 text-xs text-muted-foreground shrink-0">
                                  <CornerDownLeft className="h-3 w-3" />
                                </span>
                              </CommandItem>
                            )
                          })}
                        </CommandGroup>
                        <CommandSeparator />
                      </React.Fragment>
                    )
                  })}
              </>
            )}
          </CommandList>

          {/* Footer with keyboard hints */}
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <ArrowUp className="h-3 w-3" />
                <ArrowDown className="h-3 w-3" />
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" />
                Open
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 rounded bg-muted text-[10px]">Esc</kbd>
                Close
              </span>
            </div>
            {hasResults && (
              <span>
                {totalResults} result{totalResults !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

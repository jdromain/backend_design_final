import React from "react"

export interface SearchResult {
  id: string
  type: "page" | "call" | "agent" | "contact" | "follow-up" | "workflow" | "kb-doc" | "integration" | "settings"
  label: string
  meta?: string
  badge?: {
    label: string
    variant: "default" | "secondary" | "destructive" | "outline" | "warning"
  }
  icon: string
  route: string
  queryParams?: Record<string, string>
  score: number
  matchRanges: [number, number][]
}

export interface MatchResult {
  score: number
  ranges: [number, number][]
}

/**
 * Fuzzy match scoring function
 * Returns a score (0-100) and the matching ranges for highlighting
 */
export function scoreMatch(query: string, target: string): MatchResult {
  if (!query || !target) return { score: 0, ranges: [] }

  const queryLower = query.toLowerCase()
  const targetLower = target.toLowerCase()

  // Exact match
  if (targetLower === queryLower) {
    return { score: 100, ranges: [[0, target.length]] }
  }

  // Starts with
  if (targetLower.startsWith(queryLower)) {
    return { score: 90, ranges: [[0, query.length]] }
  }

  // Contains
  const containsIndex = targetLower.indexOf(queryLower)
  if (containsIndex !== -1) {
    return { score: 70, ranges: [[containsIndex, containsIndex + query.length]] }
  }

  // Word starts with
  const words = targetLower.split(/\s+/)
  const ranges: [number, number][] = []
  let currentIndex = 0

  for (const word of words) {
    const wordStart = targetLower.indexOf(word, currentIndex)
    if (word.startsWith(queryLower)) {
      ranges.push([wordStart, wordStart + query.length])
    }
    currentIndex = wordStart + word.length
  }

  if (ranges.length > 0) {
    return { score: 60, ranges }
  }

  // Fuzzy match - characters in order
  let queryIndex = 0
  let score = 0
  const fuzzyRanges: [number, number][] = []
  let rangeStart: number | null = null

  for (let i = 0; i < targetLower.length && queryIndex < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIndex]) {
      if (rangeStart === null) rangeStart = i
      queryIndex++
      score += 10
      // Consecutive matches get bonus
      if (i > 0 && targetLower[i - 1] === queryLower[queryIndex - 2]) {
        score += 5
      }
    } else if (rangeStart !== null) {
      fuzzyRanges.push([rangeStart, i])
      rangeStart = null
    }
  }

  if (rangeStart !== null) {
    fuzzyRanges.push([rangeStart, targetLower.length])
  }

  if (queryIndex === queryLower.length) {
    return { score: Math.min(50, score), ranges: fuzzyRanges }
  }

  return { score: 0, ranges: [] }
}

/**
 * Highlights matched portions of text
 */
export function highlightMatch(text: string, ranges: [number, number][]): React.ReactNode {
  if (ranges.length === 0) return text

  const result: React.ReactNode[] = []
  let lastEnd = 0

  // Sort ranges by start position
  const sortedRanges = [...ranges].sort((a, b) => a[0] - b[0])

  for (const [start, end] of sortedRanges) {
    if (start > lastEnd) {
      result.push(text.slice(lastEnd, start))
    }
    result.push(
      React.createElement(
        "mark",
        {
          key: `${start}-${end}`,
          className: "bg-primary/20 text-foreground rounded-sm px-0.5",
        },
        text.slice(start, end),
      ),
    )
    lastEnd = end
  }

  if (lastEnd < text.length) {
    result.push(text.slice(lastEnd))
  }

  return result
}

const RECENT_SEARCHES_KEY = "rezovoai_recent_searches"
const MAX_RECENT_SEARCHES = 5

/**
 * Get recent searches from localStorage
 */
export function getRecentSearches(): string[] {
  if (typeof window === "undefined") return []
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * Add a search to recent searches
 */
export function addRecentSearch(query: string): void {
  if (typeof window === "undefined" || !query.trim()) return
  try {
    const recent = getRecentSearches()
    const filtered = recent.filter((s) => s.toLowerCase() !== query.toLowerCase())
    const updated = [query, ...filtered].slice(0, MAX_RECENT_SEARCHES)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear all recent searches
 */
export function clearRecentSearches(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY)
  } catch {
    // Ignore storage errors
  }
}

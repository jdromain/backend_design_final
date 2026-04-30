"use client"

import { Search, Upload, Plus, Filter, RefreshCw, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Collection {
  id: string
  name: string
}

interface KbToolbarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  statusFilter: string
  onStatusFilterChange: (status: string) => void
  typeFilter: string
  onTypeFilterChange: (type: string) => void
  collectionFilter: string
  onCollectionFilterChange: (collection: string) => void
  collections: Collection[]
  onUploadClick: () => void
  onCreateCollectionClick: () => void
  onRefresh?: () => void
  isRefreshing?: boolean
  /** When true, "Create collection" is disabled (not persisted in live API). */
  readOnlyCollectionManagement?: boolean
  /** Disables main actions while workspace is loading. */
  actionsDisabled?: boolean
  /** Disables search and filters (initial load or error). */
  filtersDisabled?: boolean
  /** Upload in progress — show spinner on Upload button and disable it. */
  isUploading?: boolean
  /** Show active filter count badge next to Filter icon. */
  activeFilterCount?: number
}

export function KbToolbar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  collectionFilter,
  onCollectionFilterChange,
  collections,
  onUploadClick,
  onCreateCollectionClick,
  onRefresh,
  isRefreshing,
  readOnlyCollectionManagement = false,
  actionsDisabled = false,
  filtersDisabled = false,
  isUploading = false,
  activeFilterCount = 0,
}: KbToolbarProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-muted-foreground">Manage documents and collections for your AI agents</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onRefresh && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onRefresh}
              disabled={actionsDisabled}
              title="Refresh list"
            >
              {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={onCreateCollectionClick}
            disabled={actionsDisabled || readOnlyCollectionManagement}
            title={
              readOnlyCollectionManagement
                ? "In live mode, namespaces come from your uploads (mock-only feature here)"
                : undefined
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Collection
          </Button>
          <Button type="button" onClick={onUploadClick} disabled={actionsDisabled || isUploading}>
            {isUploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {isUploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
            disabled={filtersDisabled}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex items-center">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </div>

          <Select value={statusFilter} onValueChange={onStatusFilterChange} disabled={filtersDisabled}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={onTypeFilterChange} disabled={filtersDisabled}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="File Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="docx">DOCX</SelectItem>
              <SelectItem value="txt">TXT</SelectItem>
              <SelectItem value="md">Markdown</SelectItem>
            </SelectContent>
          </Select>

          <Select value={collectionFilter} onValueChange={onCollectionFilterChange} disabled={filtersDisabled}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Collection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Collections</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {collections.map((col) => (
                <SelectItem key={col.id} value={col.id}>
                  {col.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

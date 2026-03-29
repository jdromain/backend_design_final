"use client"

import type React from "react"

import { useState, useCallback } from "react"
import { Search, SlidersHorizontal, Download, Columns, ChevronDown, X, Save, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/hooks/use-toast"

export interface TableColumn {
  id: string
  label: string
  visible: boolean
  sortable?: boolean
}

export interface SavedView {
  id: string
  name: string
  filters: Record<string, unknown>
}

interface TableToolbarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  columns: TableColumn[]
  onColumnsChange: (columns: TableColumn[]) => void
  // Filters
  filterContent?: React.ReactNode
  activeFilterCount?: number
  onClearFilters?: () => void
  // Saved Views
  savedViews?: SavedView[]
  currentViewId?: string
  onSelectView?: (view: SavedView) => void
  onSaveView?: (name: string) => void
  onDeleteView?: (id: string) => void
  // Export
  onExport?: (format: "csv" | "json") => void
  // Selection
  selectedCount?: number
  bulkActions?: React.ReactNode
}

export function TableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  columns,
  onColumnsChange,
  filterContent,
  activeFilterCount = 0,
  onClearFilters,
  savedViews = [],
  currentViewId,
  onSelectView,
  onSaveView,
  onDeleteView,
  onExport,
  selectedCount = 0,
  bulkActions,
}: TableToolbarProps) {
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [newViewName, setNewViewName] = useState("")

  const handleToggleColumn = useCallback(
    (columnId: string) => {
      onColumnsChange(columns.map((col) => (col.id === columnId ? { ...col, visible: !col.visible } : col)))
    },
    [columns, onColumnsChange],
  )

  const handleSaveView = useCallback(() => {
    if (newViewName.trim() && onSaveView) {
      onSaveView(newViewName.trim())
      setNewViewName("")
      setSaveViewOpen(false)
      toast({ title: "View saved", description: `"${newViewName}" has been saved` })
    }
  }, [newViewName, onSaveView])

  const handleExport = useCallback(
    (format: "csv" | "json") => {
      if (onExport) {
        onExport(format)
        toast({ title: "Export started", description: `Downloading ${format.toUpperCase()} file...` })
      }
    },
    [onExport],
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Main toolbar row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
        </div>

        {/* Saved Views */}
        {savedViews.length > 0 && onSelectView && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {currentViewId ? savedViews.find((v) => v.id === currentViewId)?.name : "Views"}
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Saved Views</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {savedViews.map((view) => (
                <div
                  key={view.id}
                  className="flex items-center justify-between px-2 py-1.5 text-sm hover:bg-accent rounded-sm"
                >
                  <button onClick={() => onSelectView(view)} className="flex-1 text-left">
                    {view.name}
                  </button>
                  {onDeleteView && (
                    <button onClick={() => onDeleteView(view.id)} className="ml-2 p-1 hover:bg-destructive/10 rounded">
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Filters */}
        {filterContent && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              {filterContent}
              {activeFilterCount > 0 && onClearFilters && (
                <>
                  <Separator className="my-3" />
                  <Button variant="ghost" size="sm" onClick={onClearFilters} className="w-full">
                    <X className="mr-2 h-4 w-4" />
                    Clear all filters
                  </Button>
                </>
              )}
            </PopoverContent>
          </Popover>
        )}

        <div className="flex-1" />

        {/* Save View */}
        {onSaveView && (
          <Popover open={saveViewOpen} onOpenChange={setSaveViewOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Save className="mr-2 h-4 w-4" />
                Save View
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="end">
              <div className="space-y-3">
                <p className="text-sm font-medium">Save current view</p>
                <Input
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  placeholder="View name"
                  onKeyDown={(e) => e.key === "Enter" && handleSaveView()}
                />
                <Button size="sm" onClick={handleSaveView} disabled={!newViewName.trim()} className="w-full">
                  Save
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Column Picker */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns className="mr-2 h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {columns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.visible}
                onCheckedChange={() => handleToggleColumn(column.id)}
              >
                {column.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Export */}
        {onExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem onSelect={() => handleExport("csv")}>Export as CSV</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem onSelect={() => handleExport("json")}>Export as JSON</DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Bulk actions row */}
      {selectedCount > 0 && bulkActions && (
        <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
          <span className="text-sm text-muted-foreground">
            {selectedCount} item{selectedCount > 1 ? "s" : ""} selected
          </span>
          <Separator orientation="vertical" className="h-4" />
          {bulkActions}
        </div>
      )}
    </div>
  )
}

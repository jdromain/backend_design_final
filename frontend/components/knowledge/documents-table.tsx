"use client"

import { formatDistanceToNow } from "date-fns"
import {
  MoreHorizontal,
  FileText,
  Eye,
  FolderInput,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  Bot,
  Zap,
  ToggleLeft,
  ToggleRight,
} from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { isDocStale } from "@/lib/kb-upload"

export type ProcessingStatus =
  | "ingest_requested"
  | "queued"
  | "parsing"
  | "chunking"
  | "embedding"
  | "ready"
  | "failed"

export interface KbDocument {
  id: string
  name: string
  type: "pdf" | "docx" | "txt" | "md"
  size: string
  sizeBytes: number
  collectionId: string | null
  collectionName: string | null
  status: ProcessingStatus
  processingProgress: number
  chunks: number
  tokenEstimate: number
  isActive: boolean
  errorMessage?: string
  usedByAgents: string[]
  uploadedAt: Date
  updatedAt: Date
}

interface DocumentsTableProps {
  documents: KbDocument[]
  selectedIds: string[]
  onSelectIds: (ids: string[]) => void
  onRowClick: (doc: KbDocument) => void
  onPreview: (doc: KbDocument) => void
  onAssign: (doc: KbDocument) => void
  onReprocess: (doc: KbDocument) => void
  onToggleActive: (doc: KbDocument, active: boolean) => void
  onReingest?: (doc: KbDocument) => void
  onDelete: (doc: KbDocument) => void
  onViewLogs: (doc: KbDocument) => void
  /** Live API: assignment UI is not persisted */
  allowAssign?: boolean
  /** Live API: reprocess is not available without new ingest */
  allowReprocess?: boolean
  /** Row is being deleted (dim actions) */
  pendingDeleteId?: string | null
}

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: "text-red-500",
  docx: "text-blue-500",
  txt: "text-gray-500",
  md: "text-purple-500",
}

function StatusCell({
  status,
  progress,
  error,
  updatedAt,
}: {
  status: ProcessingStatus
  progress: number
  error?: string
  updatedAt: Date
}) {
  if (status === "ready") {
    return (
      <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 whitespace-nowrap">
        <CheckCircle className="mr-1 h-3 w-3" />
        Ready
      </Badge>
    )
  }

  if (status === "failed") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" className="cursor-help whitespace-nowrap">
            <XCircle className="mr-1 h-3 w-3" />
            Failed
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {error || "Processing failed — use Re-embed or re-upload the file"}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (status === "ingest_requested") {
    return (
      <Badge variant="secondary" className="whitespace-nowrap">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Ingest
      </Badge>
    )
  }

  if (status === "queued") {
    return (
      <Badge variant="secondary" className="whitespace-nowrap">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Queued
      </Badge>
    )
  }

  // Stalled: stuck in a processing state for too long
  if (isDocStale(status, updatedAt)) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="cursor-help border-amber-500/40 bg-amber-500/8 text-amber-600 whitespace-nowrap"
          >
            <AlertTriangle className="mr-1 h-3 w-3" />
            Stalled
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          Processing has been stuck for over 10 minutes. Use "Re-embed" from the actions menu to retry.
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex w-32 items-center gap-1.5">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-500" aria-hidden />
      <Progress value={progress} className="h-1.5 flex-1" />
      <span className="w-16 truncate text-xs capitalize text-muted-foreground" title={status}>
        {status}
      </span>
    </div>
  )
}

export function DocumentsTable({
  documents,
  selectedIds,
  onSelectIds,
  onRowClick,
  onPreview,
  onAssign,
  onReprocess,
  onToggleActive,
  onReingest,
  onDelete,
  onViewLogs,
  allowAssign = true,
  allowReprocess = true,
  pendingDeleteId = null,
}: DocumentsTableProps) {
  const allSelected = documents.length > 0 && selectedIds.length === documents.length
  const someSelected = selectedIds.length > 0 && selectedIds.length < documents.length

  // Radix Checkbox accepts checked="indeterminate" natively — no ref hack needed.
  const headerChecked: boolean | "indeterminate" = allSelected ? true : someSelected ? "indeterminate" : false

  const toggleAll = () => {
    onSelectIds(allSelected ? [] : documents.map((d) => d.id))
  }

  const toggleOne = (id: string) => {
    onSelectIds(selectedIds.includes(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id])
  }

  if (documents.length === 0) return null

  return (
    <TooltipProvider>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox checked={headerChecked} onCheckedChange={toggleAll} aria-label="Select all" />
              </TableHead>

              {/* Always visible */}
              <TableHead>Document</TableHead>
              <TableHead className="min-w-[9rem]">Status</TableHead>

              {/* md+ */}
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="hidden md:table-cell">Collection</TableHead>
              <TableHead className="hidden md:table-cell text-right">Chunks</TableHead>

              {/* lg+ */}
              <TableHead className="hidden lg:table-cell whitespace-nowrap">Last updated</TableHead>
              <TableHead className="hidden lg:table-cell">Used by</TableHead>

              <TableHead className="w-10 text-right" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {documents.map((doc) => {
              const isSelected = selectedIds.includes(doc.id)
              const isPending = pendingDeleteId === doc.id
              const isFailed = doc.status === "failed"
              const isStalled = isDocStale(doc.status, doc.updatedAt)

              return (
                <TableRow
                  key={doc.id}
                  onClick={() => onRowClick(doc)}
                  aria-busy={isPending}
                  className={cn(
                    "cursor-pointer transition-colors",
                    isSelected && "bg-muted/60",
                    isFailed && !isSelected && "bg-destructive/[0.03]",
                    isStalled && !isSelected && !isFailed && "bg-amber-500/[0.03]",
                    isPending && "pointer-events-none opacity-50",
                  )}
                >
                  {/* Checkbox */}
                  <TableCell onClick={(e) => e.stopPropagation()} className="pr-0">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(doc.id)}
                      aria-label={`Select ${doc.name}`}
                    />
                  </TableCell>

                  {/* Document name */}
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <FileText className={cn("h-4 w-4 shrink-0", FILE_TYPE_COLORS[doc.type])} aria-hidden />
                      <span
                        className="max-w-[14rem] truncate font-medium leading-none lg:max-w-[20rem]"
                        title={doc.name}
                      >
                        {doc.name}
                      </span>
                    </div>
                  </TableCell>

                  {/* Status — always visible */}
                  <TableCell>
                    <StatusCell
                      status={doc.status}
                      progress={doc.processingProgress}
                      error={doc.errorMessage}
                      updatedAt={doc.updatedAt}
                    />
                  </TableCell>

                  {/* Type — md+ */}
                  <TableCell className="hidden md:table-cell">
                    <div className="whitespace-nowrap text-sm">
                      <span className="font-mono uppercase text-xs">{doc.type}</span>
                      <span className="ml-1 text-muted-foreground">{doc.size}</span>
                    </div>
                  </TableCell>

                  {/* Collection — md+ */}
                  <TableCell className="hidden md:table-cell">
                    {doc.collectionName ? (
                      <Badge variant="outline" className="font-normal">
                        {doc.collectionName}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    <div className="mt-1">
                      {doc.isActive ? (
                        <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600">Enabled</Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </div>
                  </TableCell>

                  {/* Chunks — md+ */}
                  <TableCell className="hidden md:table-cell text-right font-mono text-sm tabular-nums">
                    {doc.status === "ready" ? doc.chunks.toLocaleString() : "—"}
                  </TableCell>

                  {/* Updated — lg+ */}
                  <TableCell className="hidden lg:table-cell whitespace-nowrap text-sm text-muted-foreground">
                    {formatDistanceToNow(doc.updatedAt, { addSuffix: true })}
                  </TableCell>

                  {/* Used by — lg+ */}
                  <TableCell className="hidden lg:table-cell">
                    {doc.usedByAgents.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex cursor-default items-center gap-1">
                            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm">{doc.usedByAgents.length}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          {doc.usedByAgents.map((a) => (
                            <div key={a} className="text-xs">
                              {a}
                            </div>
                          ))}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Actions */}
                  <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Document actions">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onPreview(doc)}>
                          <Eye className="mr-2 h-4 w-4" />
                          View details
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          onClick={() => onAssign(doc)}
                          disabled={!allowAssign}
                        >
                          <FolderInput className="mr-2 h-4 w-4" />
                          Assign to collection
                          {!allowAssign && (
                            <span className="ml-2 text-xs text-muted-foreground">(mock only)</span>
                          )}
                        </DropdownMenuItem>

                        {doc.status === "failed" && (
                          <DropdownMenuItem onClick={() => onViewLogs(doc)}>
                            <AlertTriangle className="mr-2 h-4 w-4" />
                            View error details
                          </DropdownMenuItem>
                        )}

                        {/* Re-embed: shown for stalled or failed docs when reingest is wired */}
                        {(isStalled || doc.status === "failed") && onReingest && (
                          <DropdownMenuItem onClick={() => onReingest(doc)}>
                            <Zap className="mr-2 h-4 w-4 text-amber-500" />
                            Re-embed document
                          </DropdownMenuItem>
                        )}

                        <DropdownMenuItem onClick={() => onReprocess(doc)} disabled={!allowReprocess}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Reprocess
                          {!allowReprocess && (
                            <span className="ml-2 text-xs text-muted-foreground">(re-upload)</span>
                          )}
                        </DropdownMenuItem>

                        <DropdownMenuItem onClick={() => onToggleActive(doc, !doc.isActive)}>
                          {doc.isActive ? (
                            <>
                              <ToggleLeft className="mr-2 h-4 w-4" />
                              Disable in KB
                            </>
                          ) : (
                            <>
                              <ToggleRight className="mr-2 h-4 w-4" />
                              Enable in KB
                            </>
                          )}
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                          onClick={() => onDelete(doc)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  )
}

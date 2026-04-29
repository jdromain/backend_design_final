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

export type ProcessingStatus = "queued" | "parsing" | "chunking" | "embedding" | "ready" | "failed"

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
  onDelete: (doc: KbDocument) => void
  onViewLogs: (doc: KbDocument) => void
  allowReprocess?: boolean
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
  onDelete,
  onViewLogs,
  allowReprocess = true,
}: DocumentsTableProps) {
  const allSelected = documents.length > 0 && selectedIds.length === documents.length
  const someSelected = selectedIds.length > 0 && selectedIds.length < documents.length

  const toggleAll = () => {
    if (allSelected) {
      onSelectIds([])
    } else {
      onSelectIds(documents.map((d) => d.id))
    }
  }

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectIds(selectedIds.filter((i) => i !== id))
    } else {
      onSelectIds([...selectedIds, id])
    }
  }

  const getFileIcon = (type: KbDocument["type"]) => {
    const colors: Record<string, string> = {
      pdf: "text-red-500",
      docx: "text-blue-500",
      txt: "text-gray-500",
      md: "text-purple-500",
    }
    return <FileText className={`h-5 w-5 ${colors[type]}`} />
  }

  const getStatusBadge = (status: ProcessingStatus, progress: number, error?: string) => {
    switch (status) {
      case "ready":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
            <CheckCircle className="mr-1 h-3 w-3" />
            Ready
          </Badge>
        )
      case "failed":
        return (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="destructive" className="cursor-help">
                <XCircle className="mr-1 h-3 w-3" />
                Failed
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{error || "Processing failed"}</TooltipContent>
          </Tooltip>
        )
      case "queued":
        return (
          <Badge variant="secondary">
            <Loader2 className="mr-1 h-3 w-3" />
            Queued
          </Badge>
        )
      default:
        return (
          <div className="flex items-center gap-2">
            <Progress value={progress} className="w-16 h-2" />
            <span className="text-xs text-muted-foreground capitalize">{status}</span>
          </div>
        )
    }
  }

  if (documents.length === 0) {
    return null
  }

  return (
    <TooltipProvider>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={allSelected}
                  ref={(el) => {
                    if (el) (el as HTMLButtonElement & { indeterminate: boolean }).indeterminate = someSelected
                  }}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="w-[280px]">Document</TableHead>
              <TableHead>Type / Size</TableHead>
              <TableHead>Collection</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>In KB</TableHead>
              <TableHead className="text-right">Chunks</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Used By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => (
              <TableRow
                key={doc.id}
                className="cursor-pointer"
                onClick={() => onRowClick(doc)}
                data-selected={selectedIds.includes(doc.id)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selectedIds.includes(doc.id)} onCheckedChange={() => toggleOne(doc.id)} />
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-3">
                    {getFileIcon(doc.type)}
                    <span className="font-medium truncate max-w-[200px]">{doc.name}</span>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="text-sm">
                    <span className="uppercase font-mono">{doc.type}</span>
                    <span className="text-muted-foreground"> · {doc.size}</span>
                  </div>
                </TableCell>

                <TableCell>
                  {doc.collectionName ? (
                    <Badge variant="outline">{doc.collectionName}</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground">
                      Unassigned
                    </Badge>
                  )}
                </TableCell>

                <TableCell>{getStatusBadge(doc.status, doc.processingProgress, doc.errorMessage)}</TableCell>

                <TableCell>
                  {doc.isActive ? (
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Enabled</Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </TableCell>

                <TableCell className="text-right font-mono text-sm">
                  {doc.status === "ready" ? doc.chunks.toLocaleString() : "-"}
                </TableCell>

                <TableCell className="text-sm text-muted-foreground">
                  {formatDistanceToNow(doc.updatedAt, { addSuffix: true })}
                </TableCell>

                <TableCell>
                  {doc.usedByAgents.length > 0 ? (
                    <Tooltip>
                      <TooltipTrigger>
                        <div className="flex items-center gap-1">
                          <Bot className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{doc.usedByAgents.length}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-xs">
                          {doc.usedByAgents.map((a) => (
                            <div key={a}>{a}</div>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>

                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onPreview(doc)}>
                        <Eye className="mr-2 h-4 w-4" />
                        Preview
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onAssign(doc)}>
                        <FolderInput className="mr-2 h-4 w-4" />
                        Assign to Collection
                      </DropdownMenuItem>
                      {doc.status === "failed" && (
                        <>
                          <DropdownMenuItem onClick={() => onViewLogs(doc)}>
                            <AlertTriangle className="mr-2 h-4 w-4" />
                            View Logs
                          </DropdownMenuItem>
                        </>
                      )}
                      {allowReprocess && (
                        <DropdownMenuItem onClick={() => onReprocess(doc)}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Reprocess
                        </DropdownMenuItem>
                      )}
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
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  )
}

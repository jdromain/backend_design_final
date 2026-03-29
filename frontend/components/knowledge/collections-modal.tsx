"use client"

import { useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Plus, Trash2, Bot, FileText, MoreHorizontal, FolderOpen } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export interface Collection {
  id: string
  name: string
  description: string
  docsCount: number
  usedByAgents: string[]
  updatedAt: Date
}

interface CollectionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  collections: Collection[]
  onCreateCollection: (name: string, description: string) => void
  onDeleteCollection: (id: string) => void
}

export function CollectionsModal({
  open,
  onOpenChange,
  collections,
  onCreateCollection,
  onDeleteCollection,
}: CollectionsModalProps) {
  const [tab, setTab] = useState<"list" | "create">("list")
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")

  const handleCreate = () => {
    if (newName.trim()) {
      onCreateCollection(newName.trim(), newDescription.trim())
      setNewName("")
      setNewDescription("")
      setTab("list")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Collections</DialogTitle>
          <DialogDescription>Organize your documents into collections for easier management</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "create")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">Collections</TabsTrigger>
            <TabsTrigger value="create">Create New</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-4">
            {collections.length === 0 ? (
              <div className="text-center py-8">
                <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No collections yet</p>
                <Button variant="link" onClick={() => setTab("create")}>
                  Create your first collection
                </Button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {collections.map((col) => (
                  <div
                    key={col.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{col.name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {col.docsCount} docs
                        </span>
                        <span className="flex items-center gap-1">
                          <Bot className="h-3 w-3" />
                          {col.usedByAgents.length} {col.usedByAgents.length === 1 ? "agent" : "agents"}
                        </span>
                        <span>{formatDistanceToNow(col.updatedAt, { addSuffix: true })}</span>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => onDeleteCollection(col.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="create" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="col-name">Collection Name</Label>
              <Input
                id="col-name"
                placeholder="e.g., Product Documentation"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="col-desc">Description (optional)</Label>
              <Textarea
                id="col-desc"
                placeholder="Describe what documents belong in this collection..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
              />
            </div>
            <Button onClick={handleCreate} disabled={!newName.trim()} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              Create Collection
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

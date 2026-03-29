"use client"

import { useState } from "react"
import { FolderInput } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Collection } from "./collections-modal"

interface AssignCollectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentNames: string[]
  collections: Collection[]
  onAssign: (collectionId: string | null) => void
}

export function AssignCollectionModal({
  open,
  onOpenChange,
  documentNames,
  collections,
  onAssign,
}: AssignCollectionModalProps) {
  const [selectedCollection, setSelectedCollection] = useState<string>("")

  const handleAssign = () => {
    onAssign(selectedCollection === "unassigned" ? null : selectedCollection)
    setSelectedCollection("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-5 w-5" />
            Assign to Collection
          </DialogTitle>
          <DialogDescription>
            {documentNames.length === 1
              ? `Assign "${documentNames[0]}" to a collection`
              : `Assign ${documentNames.length} documents to a collection`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Select value={selectedCollection} onValueChange={setSelectedCollection}>
            <SelectTrigger>
              <SelectValue placeholder="Select a collection..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {collections.map((col) => (
                <SelectItem key={col.id} value={col.id}>
                  {col.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={!selectedCollection}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

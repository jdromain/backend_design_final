"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"

interface NotesTagsProps {
  notes: string
  tags: string[]
  onNotesChange?: (notes: string) => void
  onTagsChange?: (tags: string[]) => void
}

export function NotesTags({ notes, tags, onNotesChange, onTagsChange }: NotesTagsProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedNotes, setEditedNotes] = useState(notes)
  const [newTag, setNewTag] = useState("")

  const handleSaveNotes = () => {
    onNotesChange?.(editedNotes)
    setIsEditing(false)
  }

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      onTagsChange?.([...tags, newTag.trim()])
      setNewTag("")
    }
  }

  const handleRemoveTag = (tag: string) => {
    onTagsChange?.(tags.filter((t) => t !== tag))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Internal Notes</h4>
          {!isEditing && (
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        {isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              placeholder="Add internal notes about this call..."
              rows={3}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveNotes}>
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{notes || "No notes added yet."}</p>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Tags</h4>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button onClick={() => handleRemoveTag(tag)} className="ml-1 rounded-full hover:bg-muted">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <div className="flex items-center gap-1">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add tag..."
              className="h-7 w-24 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAddTag()
                }
              }}
            />
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleAddTag}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

"use client"

import { useState, useEffect, useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type { Contact, FollowUpType, FollowUp } from "@/lib/actions-store"
import {
  Check,
  ChevronsUpDown,
  Clock,
  Calendar,
  type Phone,
  PhoneMissed,
  CalendarCheck,
  FileText,
  CreditCard,
  AlertTriangle,
  Utensils,
  MessageSquare,
  User,
} from "lucide-react"

interface CreateFollowUpModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contacts: Contact[]
  onSubmit: (data: {
    contactId: string
    type: string
    priority: number
    dueAt: string
    notes: string
    ownerId?: string
  }) => void
  // New: prefill data from selected case
  selectedContact?: Contact | null
  selectedFollowUp?: FollowUp | null
}

const typeOptions: { value: FollowUpType; label: string; icon: typeof Phone }[] = [
  { value: "missed_call", label: "Missed Call", icon: PhoneMissed },
  { value: "booking", label: "Booking", icon: CalendarCheck },
  { value: "estimate_approval", label: "Estimate Approval", icon: FileText },
  { value: "payment_pending", label: "Payment Collection", icon: CreditCard },
  { value: "complaint", label: "Complaint Recovery", icon: AlertTriangle },
  { value: "reservation", label: "Reservation", icon: Utensils },
  { value: "catering", label: "Catering Inquiry", icon: Utensils },
  { value: "general", label: "General", icon: MessageSquare },
]

const dueChips = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "Tomorrow", minutes: 24 * 60 },
]

const priorityOptions = [
  { value: 3, label: "Low", color: "bg-muted text-muted-foreground" },
  { value: 2, label: "Medium", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  { value: 1, label: "High", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
]

const ownerOptions = [
  { value: "unassigned", label: "Unassigned" },
  { value: "current_user", label: "Me" },
  { value: "manager", label: "Manager" },
]

export function CreateFollowUpModal({
  open,
  onOpenChange,
  contacts,
  onSubmit,
  selectedContact,
  selectedFollowUp,
}: CreateFollowUpModalProps) {
  const { toast } = useToast()

  // Form state
  const [contactId, setContactId] = useState("")
  const [contactSearchOpen, setContactSearchOpen] = useState(false)
  const [type, setType] = useState<FollowUpType>("general")
  const [priority, setPriority] = useState(2)
  const [dueAt, setDueAt] = useState("")
  const [selectedDueChip, setSelectedDueChip] = useState<number | null>(null)
  const [ownerId, setOwnerId] = useState("unassigned")
  const [notes, setNotes] = useState("")

  const suggestedDueMinutes = useMemo(() => {
    switch (type) {
      case "missed_call":
        return 15
      case "complaint":
        return 30
      case "payment_pending":
        return 60
      case "booking":
        return 60
      case "estimate_approval":
        return 120
      default:
        return 60
    }
  }, [type])

  useEffect(() => {
    if (open) {
      // Prefill contact if selected
      if (selectedContact) {
        setContactId(selectedContact.id)
      } else {
        setContactId("")
      }

      // Prefill type from existing follow-up or default
      if (selectedFollowUp) {
        setType(selectedFollowUp.type)
        setPriority(selectedFollowUp.priority)
      } else if (selectedContact) {
        // Smart defaulting based on contact tags
        if (selectedContact.tags.includes("complaint")) {
          setType("complaint")
          setPriority(1)
        } else {
          setType("general")
          setPriority(2)
        }
      } else {
        setType("general")
        setPriority(2)
      }

      // Set suggested due time
      const suggestedDate = new Date(Date.now() + suggestedDueMinutes * 60 * 1000)
      setDueAt(formatDateTimeLocal(suggestedDate))
      setSelectedDueChip(null)
      setOwnerId("unassigned")
      setNotes("")
    }
  }, [open, selectedContact, selectedFollowUp, suggestedDueMinutes])

  // Format date for datetime-local input
  function formatDateTimeLocal(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  const handleDueChipSelect = (minutes: number) => {
    const newDate = new Date(Date.now() + minutes * 60 * 1000)
    setDueAt(formatDateTimeLocal(newDate))
    setSelectedDueChip(minutes)
    toast({
      title: "Due time set",
      description: `Follow-up due ${minutes < 60 ? `in ${minutes} minutes` : minutes === 60 ? "in 1 hour" : minutes === 120 ? "in 2 hours" : "tomorrow"}`,
    })
  }

  // Get selected contact
  const selectedContactData = contacts.find((c) => c.id === contactId)

  const handleCreate = () => {
    if (!contactId) {
      toast({
        title: "Contact required",
        description: "Please select a contact for this follow-up",
        variant: "destructive",
      })
      return
    }

    onSubmit({
      contactId,
      type,
      priority,
      dueAt: dueAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      notes,
      ownerId: ownerId === "unassigned" ? undefined : ownerId,
    })

    toast({
      title: "Follow-up created",
      description: `${typeOptions.find((t) => t.value === type)?.label} follow-up for ${selectedContactData?.name || selectedContactData?.phone}`,
    })

    // Reset form
    setContactId("")
    setType("general")
    setPriority(2)
    setDueAt("")
    setSelectedDueChip(null)
    setOwnerId("unassigned")
    setNotes("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            Create Follow-Up
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Contact</Label>
            <Popover open={contactSearchOpen} onOpenChange={setContactSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={contactSearchOpen}
                  className="w-full justify-between font-normal bg-transparent"
                >
                  {selectedContactData ? (
                    <span className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {selectedContactData.name || selectedContactData.phone}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Search contacts...</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[350px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search by name or phone..." />
                  <CommandList>
                    <CommandEmpty>No contact found.</CommandEmpty>
                    <CommandGroup>
                      {contacts.map((contact) => (
                        <CommandItem
                          key={contact.id}
                          value={`${contact.name || ""} ${contact.phone}`}
                          onSelect={() => {
                            setContactId(contact.id)
                            setContactSearchOpen(false)
                            toast({
                              title: "Contact selected",
                              description: contact.name || contact.phone,
                            })
                          }}
                        >
                          <Check
                            className={cn("mr-2 h-4 w-4", contactId === contact.id ? "opacity-100" : "opacity-0")}
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">{contact.name || "Unknown"}</span>
                            <span className="text-xs text-muted-foreground">{contact.phone}</span>
                          </div>
                          {contact.tags.length > 0 && (
                            <div className="ml-auto flex gap-1">
                              {contact.tags.slice(0, 2).map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Reason / Type</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v as FollowUpType)
                // Auto-adjust priority based on type
                if (v === "complaint") setPriority(1)
                else if (v === "missed_call" || v === "payment_pending") setPriority(2)
                toast({
                  title: "Type selected",
                  description: typeOptions.find((t) => t.value === v)?.label,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((option) => {
                  const Icon = option.icon
                  return (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {option.label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Due</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {dueChips.map((chip) => (
                <Button
                  key={chip.minutes}
                  type="button"
                  variant={selectedDueChip === chip.minutes ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() => handleDueChipSelect(chip.minutes)}
                >
                  {chip.label}
                </Button>
              ))}
            </div>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => {
                  setDueAt(e.target.value)
                  setSelectedDueChip(null)
                }}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Priority</Label>
            <div className="flex gap-2">
              {priorityOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={priority === option.value ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "flex-1",
                    priority === option.value && option.value === 1 && "bg-red-600 hover:bg-red-700 text-white",
                    priority === option.value && option.value === 2 && "bg-yellow-500 hover:bg-yellow-600 text-white",
                    priority === option.value && option.value === 3 && "bg-muted",
                  )}
                  onClick={() => {
                    setPriority(option.value)
                    toast({
                      title: "Priority set",
                      description: `${option.label} priority`,
                    })
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Owner</Label>
            <Select
              value={ownerId}
              onValueChange={(v) => {
                setOwnerId(v)
                toast({
                  title: "Owner set",
                  description: ownerOptions.find((o) => o.value === v)?.label,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ownerOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add context or instructions..."
              className="min-h-[60px] resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!contactId}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

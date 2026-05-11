"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  addMinutes,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
} from "date-fns"
import { CalendarDays, Clock, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { TableSkeleton } from "@/components/loading-skeleton"
import { EmptyState } from "@/components/empty-state"
import { getUiCapabilities } from "@/lib/data/capabilities"
import {
  cancelCalendarBooking,
  createCalendarBooking,
  createCalendarResource,
  getCalendarBookings,
  getCalendarResources,
  type CalendarBooking,
  type CalendarProviderType,
  type CalendarResource,
  updateCalendarBooking,
} from "@/lib/data/calendar"

type BookingFormState = {
  id?: string
  resourceId: string
  startsAtLocal: string
  endsAtLocal: string
  customerName: string
  customerPhone: string
  customerEmail: string
  partySize: string
  notes: string
}

type ResourceFormState = {
  name: string
  timezone: string
  slotIntervalMin: string
  capacityPerSlot: string
}

type CalendarCaps = {
  page: boolean
  bookingCreate: boolean
  bookingEdit: boolean
  bookingCancel: boolean
  providerSwitch: boolean
}

const DEFAULT_CAPS: CalendarCaps = {
  page: true,
  bookingCreate: true,
  bookingEdit: true,
  bookingCancel: true,
  providerSwitch: true,
}

function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ""
  const pad = (v: number) => String(v).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(localValue: string): string {
  return new Date(localValue).toISOString()
}

function providerLabel(provider: CalendarProviderType | null | undefined): string {
  if (provider === "google_calendar") return "Google"
  if (provider === "calendly") return "Calendly"
  return "Local"
}

export function CalendarPage() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [resources, setResources] = useState<CalendarResource[]>([])
  const [bookings, setBookings] = useState<CalendarBooking[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [resourceFilter, setResourceFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [providerFilter, setProviderFilter] = useState<string>("all")
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false)
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false)
  const [bookingForm, setBookingForm] = useState<BookingFormState | null>(null)
  const [resourceForm, setResourceForm] = useState<ResourceFormState>({
    name: "Primary Course",
    timezone: "America/New_York",
    slotIntervalMin: "10",
    capacityPerSlot: "1",
  })
  const [caps, setCaps] = useState<CalendarCaps>(DEFAULT_CAPS)

  const loadMonthData = useCallback(
    async (target: Date, opts?: { withSpinner?: boolean }) => {
      if (opts?.withSpinner ?? true) setIsLoading(true)
      try {
        const from = startOfMonth(target).toISOString()
        const to = endOfMonth(target).toISOString()
        const [resourceRows, bookingRows] = await Promise.all([
          getCalendarResources(),
          getCalendarBookings({ from, to }),
        ])
        setResources(resourceRows)
        setBookings(bookingRows)
      } catch (error) {
        console.error("calendar load failed", error)
        toast({
          title: "Calendar unavailable",
          description: "Could not load calendar resources or bookings.",
          variant: "destructive",
        })
      } finally {
        if (opts?.withSpinner ?? true) setIsLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const capability = await getUiCapabilities().catch(() => null)
      if (!cancelled && capability?.calendar) {
        setCaps(capability.calendar)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void loadMonthData(selectedDate, { withSpinner: true })
  }, [loadMonthData, selectedDate])

  const filteredBookings = useMemo(() => {
    return bookings.filter((booking) => {
      if (resourceFilter !== "all" && booking.resourceId !== resourceFilter) return false
      if (statusFilter !== "all" && booking.status !== statusFilter) return false
      if (providerFilter !== "all") {
        const provider = booking.providerType ?? "local"
        if (providerFilter !== provider) return false
      }
      return true
    })
  }, [bookings, providerFilter, resourceFilter, statusFilter])

  const selectedDayAgenda = useMemo(
    () =>
      filteredBookings
        .filter((booking) => isSameDay(parseISO(booking.startsAt), selectedDate))
        .sort((a, b) => parseISO(a.startsAt).getTime() - parseISO(b.startsAt).getTime()),
    [filteredBookings, selectedDate],
  )

  const bookingCountByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const booking of filteredBookings) {
      const key = format(parseISO(booking.startsAt), "yyyy-MM-dd")
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [filteredBookings])

  const bookedDates = useMemo(
    () =>
      Array.from(bookingCountByDay.keys()).map((day) => new Date(`${day}T00:00:00`)),
    [bookingCountByDay],
  )

  const buildNewBookingForm = useCallback((): BookingFormState => {
    const start = addMinutes(new Date(selectedDate), 60)
    start.setSeconds(0, 0)
    const end = addMinutes(start, 30)
    const defaultResource = resources.find((r) => r.isActive)?.id ?? resources[0]?.id ?? ""
    return {
      resourceId: defaultResource,
      startsAtLocal: isoToLocalInput(start.toISOString()),
      endsAtLocal: isoToLocalInput(end.toISOString()),
      customerName: "",
      customerPhone: "",
      customerEmail: "",
      partySize: "1",
      notes: "",
    }
  }, [resources, selectedDate])

  const openCreateBooking = useCallback(() => {
    setBookingForm(buildNewBookingForm())
    setBookingDialogOpen(true)
  }, [buildNewBookingForm])

  const openEditBooking = useCallback((booking: CalendarBooking) => {
    setBookingForm({
      id: booking.id,
      resourceId: booking.resourceId,
      startsAtLocal: isoToLocalInput(booking.startsAt),
      endsAtLocal: isoToLocalInput(booking.endsAt),
      customerName: booking.customerName ?? "",
      customerPhone: booking.customerPhone ?? "",
      customerEmail: booking.customerEmail ?? "",
      partySize: String(booking.partySize),
      notes: booking.notes ?? "",
    })
    setBookingDialogOpen(true)
  }, [])

  const saveBooking = useCallback(async () => {
    if (!bookingForm) return
    if (!bookingForm.resourceId) {
      toast({ title: "Resource required", description: "Choose a resource before saving.", variant: "destructive" })
      return
    }
    if (!bookingForm.startsAtLocal || !bookingForm.endsAtLocal) {
      toast({ title: "Time required", description: "Start and end times are required.", variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const payload = {
        resourceId: bookingForm.resourceId,
        startsAt: localInputToIso(bookingForm.startsAtLocal),
        endsAt: localInputToIso(bookingForm.endsAtLocal),
        customerName: bookingForm.customerName || null,
        customerPhone: bookingForm.customerPhone || null,
        customerEmail: bookingForm.customerEmail || null,
        partySize: Math.max(1, Number.parseInt(bookingForm.partySize || "1", 10) || 1),
        notes: bookingForm.notes || null,
        source: "local_manual" as const,
      }

      if (bookingForm.id) {
        if (!caps.bookingEdit) {
          toast({ title: "Editing disabled", description: "Calendar editing is disabled in this environment." })
          return
        }
        await updateCalendarBooking(bookingForm.id, payload)
      } else {
        if (!caps.bookingCreate) {
          toast({ title: "Creation disabled", description: "Calendar booking creation is disabled in this environment." })
          return
        }
        await createCalendarBooking(payload)
      }

      setBookingDialogOpen(false)
      setBookingForm(null)
      await loadMonthData(selectedDate, { withSpinner: false })
      toast({ title: "Booking saved", description: "Calendar booking has been updated." })
    } catch (error) {
      console.error("save booking failed", error)
      toast({
        title: "Save failed",
        description: "Could not save booking. Check provider connection and try again.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }, [bookingForm, caps.bookingCreate, caps.bookingEdit, loadMonthData, selectedDate])

  const handleCancelBooking = useCallback(
    async (bookingId: string) => {
      if (!caps.bookingCancel) {
        toast({ title: "Cancel disabled", description: "Booking cancellation is disabled in this environment." })
        return
      }
      setIsSaving(true)
      try {
        await cancelCalendarBooking(bookingId, "Cancelled from calendar UI")
        await loadMonthData(selectedDate, { withSpinner: false })
        toast({ title: "Booking cancelled", description: "The booking was successfully cancelled." })
      } catch (error) {
        console.error("cancel booking failed", error)
        toast({ title: "Cancel failed", description: "Could not cancel this booking.", variant: "destructive" })
      } finally {
        setIsSaving(false)
      }
    },
    [caps.bookingCancel, loadMonthData, selectedDate],
  )

  const createResource = useCallback(async () => {
    if (!resourceForm.name.trim()) {
      toast({ title: "Resource name required", description: "Enter a resource name.", variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      await createCalendarResource({
        name: resourceForm.name.trim(),
        timezone: resourceForm.timezone.trim() || "America/New_York",
        slotIntervalMin: Math.max(5, Number.parseInt(resourceForm.slotIntervalMin, 10) || 10),
        capacityPerSlot: Math.max(1, Number.parseInt(resourceForm.capacityPerSlot, 10) || 1),
      })
      setResourceDialogOpen(false)
      await loadMonthData(selectedDate, { withSpinner: false })
      toast({ title: "Resource created", description: "Calendar resource is ready for booking." })
    } catch (error) {
      console.error("create resource failed", error)
      toast({ title: "Resource create failed", description: "Could not create calendar resource.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }, [loadMonthData, resourceForm, selectedDate])

  if (!caps.page) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Calendar page is disabled by backend capability flags.
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
        <TableSkeleton rows={8} columns={1} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Primary booking backbone for all manual and voice bookings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setResourceDialogOpen(true)}>
            <CalendarDays className="mr-2 h-4 w-4" />
            New Resource
          </Button>
          <Button onClick={openCreateBooking} disabled={resources.length === 0 || !caps.bookingCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Booking
          </Button>
        </div>
      </div>

      {resources.length === 0 ? (
        <EmptyState
          title="No calendar resources configured"
          description="Create at least one resource before creating bookings."
          variant="default"
          action={{
            label: "Create Resource",
            onClick: () => setResourceDialogOpen(true),
          }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[420px,1fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Month View</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(day) => day && setSelectedDate(day)}
                modifiers={{ hasBookings: bookedDates }}
                modifiersClassNames={{
                  hasBookings:
                    "relative font-semibold text-primary after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
                }}
              />

              <div className="grid grid-cols-3 gap-2">
                <Select value={resourceFilter} onValueChange={setResourceFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Resource" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All resources</SelectItem>
                    {resources.map((resource) => (
                      <SelectItem key={resource.id} value={resource.id}>
                        {resource.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={providerFilter} onValueChange={setProviderFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All providers</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                    <SelectItem value="google_calendar">Google</SelectItem>
                    <SelectItem value="calendly">Calendly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Agenda for {format(selectedDate, "EEEE, MMM d")}
                </CardTitle>
                <Badge variant="secondary">{selectedDayAgenda.length} booking(s)</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedDayAgenda.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                  No bookings for this day.
                </div>
              ) : (
                selectedDayAgenda.map((booking) => {
                  const resourceName =
                    resources.find((resource) => resource.id === booking.resourceId)?.name ??
                    booking.resourceId
                  return (
                    <div key={booking.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-medium">
                              {format(parseISO(booking.startsAt), "h:mm a")} - {format(parseISO(booking.endsAt), "h:mm a")}
                            </span>
                            <Badge variant="outline">{booking.status}</Badge>
                            <Badge variant="outline">{providerLabel(booking.providerType)}</Badge>
                          </div>
                          <p className="mt-1 text-sm">{booking.customerName || "Unnamed caller"}</p>
                          <p className="text-xs text-muted-foreground">
                            {resourceName} • party {booking.partySize}
                            {booking.customerPhone ? ` • ${booking.customerPhone}` : ""}
                          </p>
                          {booking.notes ? (
                            <p className="mt-1 text-xs text-muted-foreground">{booking.notes}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEditBooking(booking)} disabled={!caps.bookingEdit}>
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="text-destructive"
                            onClick={() => void handleCancelBooking(booking.id)}
                            disabled={isSaving || booking.status === "canceled" || !caps.bookingCancel}
                          >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={bookingDialogOpen} onOpenChange={setBookingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{bookingForm?.id ? "Edit booking" : "Create booking"}</DialogTitle>
            <DialogDescription>
              Bookings are persisted through the calendar backbone and synced with active providers when connected.
            </DialogDescription>
          </DialogHeader>
          {bookingForm ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Resource</Label>
                <Select
                  value={bookingForm.resourceId}
                  onValueChange={(value) => setBookingForm((prev) => (prev ? { ...prev, resourceId: value } : prev))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select resource" />
                  </SelectTrigger>
                  <SelectContent>
                    {resources.map((resource) => (
                      <SelectItem key={resource.id} value={resource.id}>
                        {resource.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Starts</Label>
                  <Input
                    type="datetime-local"
                    value={bookingForm.startsAtLocal}
                    onChange={(e) =>
                      setBookingForm((prev) => (prev ? { ...prev, startsAtLocal: e.target.value } : prev))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ends</Label>
                  <Input
                    type="datetime-local"
                    value={bookingForm.endsAtLocal}
                    onChange={(e) =>
                      setBookingForm((prev) => (prev ? { ...prev, endsAtLocal: e.target.value } : prev))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Customer name</Label>
                  <Input
                    value={bookingForm.customerName}
                    onChange={(e) =>
                      setBookingForm((prev) => (prev ? { ...prev, customerName: e.target.value } : prev))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={bookingForm.customerPhone}
                    onChange={(e) =>
                      setBookingForm((prev) => (prev ? { ...prev, customerPhone: e.target.value } : prev))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={bookingForm.customerEmail}
                    onChange={(e) =>
                      setBookingForm((prev) => (prev ? { ...prev, customerEmail: e.target.value } : prev))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Party size</Label>
                  <Input
                    type="number"
                    min={1}
                    value={bookingForm.partySize}
                    onChange={(e) =>
                      setBookingForm((prev) => (prev ? { ...prev, partySize: e.target.value } : prev))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={bookingForm.notes}
                  onChange={(e) => setBookingForm((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={() => void saveBooking()} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resourceDialogOpen} onOpenChange={setResourceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create resource</DialogTitle>
            <DialogDescription>Resources represent books/courses/schedules bookable in this organization.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={resourceForm.name}
                onChange={(e) => setResourceForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input
                value={resourceForm.timezone}
                onChange={(e) => setResourceForm((prev) => ({ ...prev, timezone: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Slot interval (min)</Label>
                <Input
                  type="number"
                  min={5}
                  value={resourceForm.slotIntervalMin}
                  onChange={(e) => setResourceForm((prev) => ({ ...prev, slotIntervalMin: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Capacity per slot</Label>
                <Input
                  type="number"
                  min={1}
                  value={resourceForm.capacityPerSlot}
                  onChange={(e) => setResourceForm((prev) => ({ ...prev, capacityPerSlot: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResourceDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={() => void createResource()} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create Resource
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

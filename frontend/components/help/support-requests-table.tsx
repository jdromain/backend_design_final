"use client"

import { useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MessageSquare, Inbox } from "lucide-react"

export interface SupportTicket {
  id: string
  subject: string
  category: string
  priority: "low" | "medium" | "high"
  status: "open" | "waiting" | "resolved"
  updatedAt: Date
}

const mockTickets: SupportTicket[] = [
  {
    id: "RZV-1042",
    subject: "Calls stuck in Ringing state",
    category: "Calls",
    priority: "high",
    status: "open",
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
  {
    id: "RZV-1033",
    subject: "KB doc stuck processing",
    category: "Knowledge Base",
    priority: "medium",
    status: "waiting",
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
  {
    id: "RZV-0991",
    subject: "Invoice download missing VAT",
    category: "Billing",
    priority: "low",
    status: "resolved",
    updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  },
]

const priorityColors: Record<string, string> = {
  low: "bg-slate-500/10 text-slate-400",
  medium: "bg-amber-500/10 text-amber-400",
  high: "bg-red-500/10 text-red-400",
}

const statusColors: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-400",
  waiting: "bg-amber-500/10 text-amber-400",
  resolved: "bg-emerald-500/10 text-emerald-400",
}

interface SupportRequestsTableProps {
  onContactSupport: () => void
}

export function SupportRequestsTable({ onContactSupport }: SupportRequestsTableProps) {
  const [activeTab, setActiveTab] = useState("open")

  const filteredTickets = mockTickets.filter((ticket) => {
    if (activeTab === "open") return ticket.status === "open"
    if (activeTab === "waiting") return ticket.status === "waiting"
    if (activeTab === "resolved") return ticket.status === "resolved"
    return true
  })

  const EmptyState = () => (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground mb-4">No support requests yet</p>
      <Button onClick={onContactSupport}>
        <MessageSquare className="h-4 w-4 mr-2" />
        Contact Support
      </Button>
    </div>
  )

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Support Requests</h2>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="waiting">Waiting on you</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {filteredTickets.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Ticket</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead className="w-[120px]">Category</TableHead>
                    <TableHead className="w-[100px]">Priority</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[140px]">Last Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTickets.map((ticket) => (
                    <TableRow key={ticket.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-mono text-xs">{ticket.id}</TableCell>
                      <TableCell className="font-medium">{ticket.subject}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{ticket.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={priorityColors[ticket.priority]}>{ticket.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[ticket.status]}>
                          {ticket.status === "waiting" ? "Waiting" : ticket.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDistanceToNow(ticket.updatedAt, { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

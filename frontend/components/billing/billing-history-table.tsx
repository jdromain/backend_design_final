"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Download, Eye, FileText } from "lucide-react"

export interface Invoice {
  id: string
  date: string
  period: string
  status: "paid" | "pending" | "failed"
  amount: number
  lineItems: { description: string; amount: number }[]
  paymentMethod: string
  /** Set when the row is DB usage rollup, not a payable invoice. */
  recordKind?: "usage_month_rollup"
}

interface BillingHistoryTableProps {
  invoices: Invoice[]
  onViewInvoice: (invoice: Invoice) => void
  onDownloadInvoice: (invoice: Invoice) => void
}

export function BillingHistoryTable({ invoices, onViewInvoice, onDownloadInvoice }: BillingHistoryTableProps) {
  const statusStyles = {
    paid: "bg-emerald-500/10 text-emerald-500",
    pending: "bg-amber-500/10 text-amber-500",
    failed: "bg-red-500/10 text-red-500",
  }

  return (
    <Card>
        <CardHeader>
        <CardTitle>Usage & billing history</CardTitle>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="font-medium">No usage records yet</p>
            <p className="text-sm text-muted-foreground">
              Monthly usage rollups from metering will appear here when available.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Record</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onViewInvoice(invoice)}
                >
                  <TableCell className="font-medium">{invoice.id}</TableCell>
                  <TableCell className="text-muted-foreground">{invoice.date}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        invoice.recordKind === "usage_month_rollup"
                          ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                          : statusStyles[invoice.status]
                      }
                    >
                      {invoice.recordKind === "usage_month_rollup"
                        ? "Usage rollup"
                        : invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">${invoice.amount.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          onViewInvoice(invoice)
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDownloadInvoice(invoice)
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

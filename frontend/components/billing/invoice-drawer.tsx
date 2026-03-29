"use client"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Download, CreditCard, Calendar, FileText } from "lucide-react"
import type { Invoice } from "./billing-history-table"

interface InvoiceDrawerProps {
  invoice: Invoice | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: (invoice: Invoice) => void
}

export function InvoiceDrawer({ invoice, open, onOpenChange, onDownload }: InvoiceDrawerProps) {
  if (!invoice) return null

  const statusStyles = {
    paid: "bg-emerald-500/10 text-emerald-500",
    pending: "bg-amber-500/10 text-amber-500",
    failed: "bg-red-500/10 text-red-500",
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl rounded-l-xl border-l">
        <SheetHeader className="border-b border-border/80 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <SheetTitle className="flex items-center gap-2 truncate">
                <FileText className="h-5 w-5 shrink-0" />
                {invoice.id}
              </SheetTitle>
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
            </div>
            <Button
              type="button"
              variant="default"
              size="sm"
              aria-label="Download invoice"
              onClick={() => onDownload(invoice)}
            >
              <Download className="h-4 w-4 shrink-0" />
              Download
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-6">
          <div className="space-y-6 pr-4 pb-6">
            <Card className="rounded-lg shadow-sm" role="region" aria-labelledby="invoice-details-heading">
              <CardHeader className="pb-2">
                <CardTitle id="invoice-details-heading" className="text-sm font-medium">
                  {invoice.recordKind === "usage_month_rollup" ? "Usage record details" : "Invoice details"}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="flex items-start gap-2">
                  <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {invoice.recordKind === "usage_month_rollup" ? "Period" : "Invoice Date"}
                    </p>
                    <p className="font-medium">{invoice.date}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Billing Period</p>
                    <p className="font-medium">{invoice.period}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg shadow-sm" role="region" aria-labelledby="line-items-heading">
              <CardHeader className="pb-2">
                <CardTitle id="line-items-heading" className="text-sm font-medium">
                  Line Items
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {invoice.lineItems.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                    >
                      <span className="text-sm">{item.description}</span>
                      <span className="font-medium">${item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-4 mt-2 border-t-2">
                  <span className="font-semibold">Total</span>
                  <span className="text-xl font-bold">${invoice.amount.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            {invoice.recordKind !== "usage_month_rollup" ? (
              <Card className="rounded-lg shadow-sm" role="region" aria-labelledby="payment-method-heading">
                <CardHeader className="pb-2">
                  <CardTitle id="payment-method-heading" className="text-sm font-medium">
                    Payment Method
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start gap-2">
                    <CreditCard className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm text-muted-foreground">Payment Method</p>
                      <p className="font-medium">{invoice.paymentMethod}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Button
              type="button"
              className="w-full"
              aria-label={invoice.recordKind === "usage_month_rollup" ? "Download usage record" : "Download invoice"}
              onClick={() => onDownload(invoice)}
            >
              <Download className="mr-2 h-4 w-4" />
              {invoice.recordKind === "usage_month_rollup" ? "Download summary" : "Download Invoice"}
            </Button>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

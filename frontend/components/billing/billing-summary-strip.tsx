"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, ChevronRight } from "lucide-react"

interface BillingSummaryStripProps {
  variant?: "demo" | "metered"
  /** Rolling window label, e.g. "Last 30 days" — used when variant is metered. */
  periodLabel?: string
  /** Sum of metered line items for the selected period (not a subscription projection). */
  meteredPeriodTotal?: number
  planName: string
  planPrice: number
  renewalDate: string
  projectedSpend: number
  hasOverage: boolean
  overageAmount?: number
  onViewPlanDetails: () => void
}

export function BillingSummaryStrip({
  variant = "demo",
  periodLabel,
  meteredPeriodTotal = 0,
  planName,
  planPrice,
  renewalDate,
  projectedSpend,
  hasOverage,
  overageAmount = 0,
  onViewPlanDetails,
}: BillingSummaryStripProps) {
  if (variant === "metered") {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Period</p>
                <p className="font-semibold">{periodLabel ?? "Selected window"}</p>
              </div>
              <div className="h-8 w-px bg-border hidden sm:block" />
              <div>
                <p className="text-sm text-muted-foreground">Metered total (estimate)</p>
                <p className="font-semibold text-lg">${meteredPeriodTotal.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  From usage meters in this window. Not a bill, card charge, or renewal date.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Current Plan</p>
              <p className="font-semibold flex items-center gap-2">
                {planName}
                <Badge variant="secondary" className="text-xs">
                  ${planPrice}/mo
                </Badge>
              </p>
            </div>
            <div className="h-8 w-px bg-border hidden sm:block" />
            <div>
              <p className="text-sm text-muted-foreground">Next Renewal</p>
              <p className="font-semibold">{renewalDate}</p>
            </div>
            <div className="h-8 w-px bg-border hidden sm:block" />
            <div>
              <p className="text-sm text-muted-foreground">Projected Spend</p>
              <p className="font-semibold text-lg">${projectedSpend.toFixed(2)}</p>
            </div>
            {hasOverage && (
              <>
                <div className="h-8 w-px bg-border hidden sm:block" />
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-600">
                    Projected overage: ${overageAmount.toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewPlanDetails}
            className="text-muted-foreground hover:text-foreground"
          >
            View plan details
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

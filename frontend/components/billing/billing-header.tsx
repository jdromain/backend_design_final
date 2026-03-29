"use client"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Zap, Calendar } from "lucide-react"

interface BillingHeaderProps {
  variant?: "demo" | "metered"
  period: string
  onPeriodChange: (period: string) => void
  periodDates: { start: string; end: string; daysRemaining: number }
  onUpgrade: () => void
}

export function BillingHeader({
  variant = "demo",
  period,
  onPeriodChange,
  periodDates,
  onUpgrade,
}: BillingHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          {variant === "metered"
            ? "Metered usage from your tenant (rolling windows: 7 / 30 / 90 days)."
            : "Manage your subscription and view usage"}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={period} onValueChange={onPeriodChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {variant === "metered" ? (
                <>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="this-month">This month</SelectItem>
                  <SelectItem value="last-month">Last month</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="text-sm text-muted-foreground">
          <span>
            {periodDates.start} - {periodDates.end}
          </span>
          {variant === "demo" && period === "this-month" && (
            <span className="ml-2 text-foreground font-medium">({periodDates.daysRemaining} days left)</span>
          )}
        </div>
        <Button onClick={onUpgrade}>
          <Zap className="mr-2 h-4 w-4" />
          {variant === "metered" ? "Plans" : "Upgrade Plan"}
        </Button>
      </div>
    </div>
  )
}

"use client"

import { useState, useMemo, useEffect } from "react"
import { subDays } from "date-fns"
import { BillingHeader } from "@/components/billing/billing-header"
import { BillingSummaryStrip } from "@/components/billing/billing-summary-strip"
import { UsageMetersGrid } from "@/components/billing/usage-meters-grid"
import { AgentUsageCard } from "@/components/billing/agent-usage-card"
import { TopToolsUsageTable } from "@/components/billing/top-tools-usage-table"
import { PaymentMethodCard } from "@/components/billing/payment-method-card"
import { BillingHistoryTable, type Invoice } from "@/components/billing/billing-history-table"
import { InvoiceDrawer } from "@/components/billing/invoice-drawer"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"

import {
  getBillingUsage,
  getBillingBreakdown,
  getAgentUsage,
  getToolUsage,
  getInvoices,
} from "@/lib/data/billing"

type UsageMetersState = {
  callMinutes: { used: number; limit: number; trend: number }
  agents: { used: number; limit: number; trend: number }
  storage: { used: number; limit: number; trend: number }
  tokens: { used: number; limit: number; trend: number }
}

type BreakdownRow = {
  category: string
  usage: number
  usageUnit: string
  cost: number
  color: string
}

type AgentUsageState = {
  id: string
  name: string
  calls: number
  minutes: number
  tokens: number
  cost: number
}

type ToolUsageRow = { id: string; name: string; invocations: number; errorRate: number; cost: number }

const EMPTY_USAGE: UsageMetersState = {
  callMinutes: { used: 0, limit: 1, trend: 0 },
  agents: { used: 0, limit: 1, trend: 0 },
  storage: { used: 0, limit: 1, trend: 0 },
  tokens: { used: 0, limit: 1, trend: 0 },
}

const PLACEHOLDER_AGENT: AgentUsageState = {
  id: "—",
  name: "No agent usage this period",
  calls: 0,
  minutes: 0,
  tokens: 0,
  cost: 0,
}

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export function BillingPage() {
  const { toast } = useToast()
  const [period, setPeriod] = useState(() => (useMocks ? "this-month" : "30d"))
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [invoiceDrawerOpen, setInvoiceDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [usage, setUsage] = useState<UsageMetersState>(EMPTY_USAGE)
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([])
  const [agentUsage, setAgentUsage] = useState<AgentUsageState | null>(null)
  const [toolUsage, setToolUsage] = useState<ToolUsageRow[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])

  const periodDates = useMemo(() => {
    const now = new Date()
    if (useMocks) {
      if (period === "this-month") {
        const start = new Date(now.getFullYear(), now.getMonth(), 1)
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        const daysRemaining = end.getDate() - now.getDate()
        return {
          start: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          end: end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          daysRemaining,
        }
      }
      if (period === "last-month") {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const end = new Date(now.getFullYear(), now.getMonth(), 0)
        return {
          start: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          end: end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          daysRemaining: 0,
        }
      }
    }
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30
    const start = subDays(now, days - 1)
    return {
      start: start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      end: now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      daysRemaining: 0,
    }
  }, [period])

  const periodLabelMetered = useMemo(() => {
    if (period === "7d") return "Last 7 days"
    if (period === "90d") return "Last 90 days"
    return "Last 30 days"
  }, [period])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [u, b, agent, tools, inv] = await Promise.all([
          getBillingUsage(period),
          getBillingBreakdown(period),
          getAgentUsage(),
          getToolUsage(),
          getInvoices(),
        ])
        if (cancelled) return
        setUsage(u ?? EMPTY_USAGE)
        setBreakdown(Array.isArray(b) ? b : [])
        setAgentUsage(agent)
        setToolUsage(Array.isArray(tools) ? tools : [])
        setInvoices(Array.isArray(inv) ? inv : [])
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          toast({
            title: "Billing data unavailable",
            description: "Could not load usage or invoices. Showing empty state.",
            variant: "destructive",
          })
          setUsage(EMPTY_USAGE)
          setBreakdown([])
          setAgentUsage(null)
          setToolUsage([])
          setInvoices([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [period, toast])

  const totalCost = breakdown.reduce((sum, item) => sum + item.cost, 0)
  const projectedSpend =
    useMocks && period === "this-month"
      ? 149 + (totalCost > 149 ? totalCost - 149 : 0) + 18.5
      : totalCost
  const hasOverage = useMocks && period === "this-month" && projectedSpend > 149

  const storageMeter = useMocks
    ? { label: "Storage" as const, unit: "GB" as const }
    : { label: "Knowledge documents" as const, unit: "docs" as const }

  const usageMeters = [
    {
      id: "minutes",
      label: "Call Minutes",
      icon: "phone" as const,
      used: usage.callMinutes.used,
      limit: usage.callMinutes.limit,
      unit: "min",
      trend: usage.callMinutes.trend,
    },
    {
      id: "agents",
      label: "Agent",
      icon: "bot" as const,
      used: usage.agents.used,
      limit: usage.agents.limit,
      unit: "agent",
      trend: usage.agents.trend,
    },
    {
      id: "storage",
      label: storageMeter.label,
      icon: "storage" as const,
      used: usage.storage.used,
      limit: usage.storage.limit,
      unit: storageMeter.unit,
      trend: usage.storage.trend,
    },
    {
      id: "tokens",
      label: "LLM Tokens",
      icon: "tokens" as const,
      used: usage.tokens.used,
      limit: usage.tokens.limit,
      unit: "tokens",
      trend: usage.tokens.trend,
    },
  ]

  const handleViewInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice)
    setInvoiceDrawerOpen(true)
  }

  const handleDownloadInvoice = (invoice: Invoice) => {
    toast({
      title: "Downloading invoice",
      description: `${invoice.id} is being downloaded...`,
    })
  }

  const handleUpgrade = () => {
    toast({
      title: useMocks ? "Upgrade Plan" : "Plans",
      description: useMocks
        ? "Opening plan selection..."
        : "Commercial plan selection is not wired in this environment.",
    })
  }

  const handleUpdatePayment = () => {
    toast({
      title: "Payment method",
      description: useMocks
        ? "Opening payment method form..."
        : "Payment methods are not shown for live metered usage in this app.",
    })
  }

  const handleViewPlanDetails = () => {
    toast({
      title: "Plan details",
      description: useMocks
        ? "Opening plan details..."
        : "Plan metadata comes from the API when an active plan row exists.",
    })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BillingHeader
        variant={useMocks ? "demo" : "metered"}
        period={period}
        onPeriodChange={setPeriod}
        periodDates={periodDates}
        onUpgrade={handleUpgrade}
      />

      {useMocks ? (
        <BillingSummaryStrip
          planName="Pro"
          planPrice={149}
          renewalDate="January 1, 2025"
          projectedSpend={projectedSpend}
          hasOverage={hasOverage}
          overageAmount={hasOverage ? projectedSpend - 149 : 0}
          onViewPlanDetails={handleViewPlanDetails}
        />
      ) : (
        <BillingSummaryStrip
          variant="metered"
          periodLabel={periodLabelMetered}
          meteredPeriodTotal={totalCost}
          planName="Pro"
          planPrice={149}
          renewalDate="January 1, 2025"
          projectedSpend={projectedSpend}
          hasOverage={false}
          onViewPlanDetails={handleViewPlanDetails}
        />
      )}

      <UsageMetersGrid meters={usageMeters} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AgentUsageCard agent={agentUsage ?? PLACEHOLDER_AGENT} />
        <TopToolsUsageTable tools={toolUsage} />
      </div>

      {useMocks ? (
        <PaymentMethodCard
          cardLast4="4242"
          cardExpiry="12/2025"
          cardBrand="Visa"
          billingEmail="billing@acmecorp.com"
          billingAddress="123 Main St, San Francisco, CA 94102"
          onUpdate={handleUpdatePayment}
        />
      ) : null}

      <BillingHistoryTable invoices={invoices} onViewInvoice={handleViewInvoice} onDownloadInvoice={handleDownloadInvoice} />

      <InvoiceDrawer
        invoice={selectedInvoice}
        open={invoiceDrawerOpen}
        onOpenChange={setInvoiceDrawerOpen}
        onDownload={handleDownloadInvoice}
      />
    </div>
  )
}

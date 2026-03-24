"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard, TrendingUp, Activity, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

export default function BillingPage() {
  const { data: analytics, isLoading, error: analyticsError } = useQuery({
    queryKey: ["analytics", "billing"],
    queryFn: () => api.analytics.getAggregate(),
    retry: 1,
  });

  const { data: quota, error: quotaError } = useQuery({
    queryKey: ["billing", "quota"],
    queryFn: () => api.billing.canStartCall("tenant-default"),
    refetchInterval: quotaError ? false : 30000, // Reduced from 10s to 30s, stop on error
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Billing & Usage</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const totalCalls = analytics?.totalCalls || 0;
  const currentConcurrency = quota?.currentConcurrency || 0;
  const concurrencyLimit = quota?.limit || 10;
  const estimatedCost = (totalCalls * 0.15).toFixed(2); // $0.15 per call estimate

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Billing & Usage</h1>

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Current Plan</CardTitle>
              <CardDescription>Professional Plan</CardDescription>
            </div>
            <Badge variant="default" className="text-sm px-3 py-1">
              Active
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-sm text-muted-foreground">Concurrent Calls</div>
              <div className="text-2xl font-bold">{concurrencyLimit}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Monthly Calls Included</div>
              <div className="text-2xl font-bold">1,000</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Price per Extra Call</div>
              <div className="text-2xl font-bold">$0.15</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCalls}</div>
            <p className="text-xs text-muted-foreground">
              This billing cycle
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Estimated Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${estimatedCost}</div>
            <p className="text-xs text-muted-foreground">
              Current month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Calls</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {currentConcurrency} / {concurrencyLimit}
            </div>
            <p className="text-xs text-muted-foreground">
              Concurrent limit
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Remaining</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.max(0, 1000 - totalCalls)}
            </div>
            <p className="text-xs text-muted-foreground">
              Included calls left
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Method</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <CreditCard className="h-8 w-8 text-muted-foreground" />
            <div>
              <div className="font-medium">Visa ending in 4242</div>
              <div className="text-sm text-muted-foreground">Expires 12/2025</div>
            </div>
            <Badge variant="outline" className="ml-auto">
              Default
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Invoice History */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { date: "Dec 1, 2024", amount: "$150.00", status: "Paid" },
              { date: "Nov 1, 2024", amount: "$145.50", status: "Paid" },
              { date: "Oct 1, 2024", amount: "$132.75", status: "Paid" },
            ].map((invoice, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
              >
                <div>
                  <div className="font-medium">{invoice.date}</div>
                  <div className="text-sm text-muted-foreground">
                    Monthly subscription
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{invoice.amount}</div>
                  <Badge variant="outline" className="mt-1">
                    {invoice.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


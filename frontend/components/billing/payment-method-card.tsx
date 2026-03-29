"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CreditCard, Mail, MapPin, Pencil } from "lucide-react"

interface PaymentMethodCardProps {
  cardLast4: string
  cardExpiry: string
  cardBrand: string
  billingEmail: string
  billingAddress: string
  onUpdate: () => void
}

export function PaymentMethodCard({
  cardLast4,
  cardExpiry,
  cardBrand,
  billingEmail,
  billingAddress,
  onUpdate,
}: PaymentMethodCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Payment Method</CardTitle>
          <Button variant="outline" size="sm" onClick={onUpdate}>
            <Pencil className="mr-2 h-3 w-3" />
            Update
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 rounded-lg border p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
            <CreditCard className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="font-medium">
              {cardBrand} •••• {cardLast4}
            </p>
            <p className="text-sm text-muted-foreground">Expires {cardExpiry}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-start gap-3">
            <Mail className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Billing Email</p>
              <p className="text-sm font-medium">{billingEmail}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Billing Address</p>
              <p className="text-sm font-medium">{billingAddress}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

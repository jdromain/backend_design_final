"use client"

import { type LucideIcon, FileQuestion, Search, Inbox, Upload, BookOpen, Phone, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  variant?: "default" | "search" | "error" | "onboarding"
  size?: "default" | "compact"
}

export function EmptyState({ icon: Icon, title, description, action, variant = "default", size = "default" }: EmptyStateProps) {
  const DefaultIcon = variant === "search" ? Search : variant === "error" ? FileQuestion : variant === "onboarding" ? Sparkles : Inbox

  const padding = size === "compact" ? "py-8" : "py-12"
  const iconSize = size === "compact" ? "h-6 w-6" : "h-8 w-8"
  const iconPadding = size === "compact" ? "p-3" : "p-4"

  return (
    <div className={`flex flex-col items-center justify-center ${padding} px-4 text-center`}>
      <div className={`rounded-full bg-muted ${iconPadding} mb-4`}>
        {Icon ? (
          <Icon className={`${iconSize} text-muted-foreground`} />
        ) : (
          <DefaultIcon className={`${iconSize} text-muted-foreground`} />
        )}
      </div>
      <h3 className={`${size === "compact" ? "text-base" : "text-lg"} font-semibold mb-1`}>{title}</h3>
      {description && <p className={`text-sm text-muted-foreground max-w-sm ${size === "compact" ? "mb-3" : "mb-4"}`}>{description}</p>}
      {action && (
        <Button onClick={action.onClick} size={size === "compact" ? "sm" : "default"}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

interface OnboardingEmptyStateProps {
  title: string
  description: string
  steps: Array<{
    icon: LucideIcon
    text: string
  }>
  primaryAction?: {
    label: string
    onClick: () => void
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
}

export function OnboardingEmptyState({ title, description, steps, primaryAction, secondaryAction }: OnboardingEmptyStateProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-6">
            <Sparkles className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">{title}</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-8">{description}</p>

          <div className="w-full max-w-md space-y-4 mb-8">
            {steps.map((step, index) => {
              const StepIcon = step.icon
              return (
                <div key={index} className="flex items-start gap-3 text-left">
                  <div className="rounded-full bg-primary/10 p-2 mt-0.5">
                    <StepIcon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-sm text-foreground flex-1 pt-0.5">{step.text}</p>
                </div>
              )
            })}
          </div>

          <div className="flex gap-3">
            {primaryAction && (
              <Button onClick={primaryAction.onClick} size="default">
                {primaryAction.label}
              </Button>
            )}
            {secondaryAction && (
              <Button onClick={secondaryAction.onClick} variant="outline" size="default">
                {secondaryAction.label}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

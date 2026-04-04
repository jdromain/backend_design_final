"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Phone,
  Clock,
  FileText,
  Puzzle,
  PhoneCall,
  Rocket,
  CheckCircle2,
  Circle,
  ArrowRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface OnboardingStep {
  id: string
  title: string
  description: string
  icon: "phone" | "clock" | "docs" | "integration" | "test" | "live"
  completed: boolean
  optional?: boolean
  action: {
    label: string
    page: string
  }
}

interface OnboardingChecklistProps {
  steps: OnboardingStep[]
  onAction: (page: string) => void
}

const iconMap = {
  phone: Phone,
  clock: Clock,
  docs: FileText,
  integration: Puzzle,
  test: PhoneCall,
  live: Rocket,
}

export function OnboardingChecklist({ steps, onAction }: OnboardingChecklistProps) {
  const completedCount = steps.filter((s) => s.completed).length
  const progress = (completedCount / steps.length) * 100

  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Get Started with RezovoAI</CardTitle>
            <CardDescription>Complete these steps to start handling calls</CardDescription>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold">{completedCount}</span>
            <span className="text-muted-foreground">/{steps.length}</span>
          </div>
        </div>
        <Progress value={progress} className="h-2 mt-4" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {steps.map((step, index) => {
            const Icon = iconMap[step.icon] ?? Phone
            const action = step.action ?? { label: "Continue", page: "dashboard" }
            return (
              <div
                key={step.id}
                className={cn(
                  "flex items-center gap-4 p-3 rounded-lg border transition-colors",
                  step.completed
                    ? "bg-muted/30 border-muted"
                    : "hover:bg-muted/50 border-border"
                )}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                    step.completed
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-primary/10 text-primary"
                  )}
                >
                  {step.completed ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4
                      className={cn(
                        "font-medium text-sm",
                        step.completed && "text-muted-foreground line-through"
                      )}
                    >
                      {step.title}
                    </h4>
                    {step.optional && (
                      <span className="text-xs text-muted-foreground">(Optional)</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                </div>
                {!step.completed && (
                  <Button
                    size="sm"
                    variant={index === completedCount ? "default" : "outline"}
                    className="shrink-0"
                    onClick={() => onAction(action.page)}
                  >
                    {action.label}
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

"use client"

import { useState } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Mic,
  Brain,
  Wrench,
  Phone,
  Eye,
  Play,
  AlertTriangle,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { Agent } from "./agents-table"

interface CreateAgentWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingAgents: Agent[]
  onCreateAgent: (agent: Partial<Agent>) => void
}

type CreateMethod = "template" | "clone" | "blank"

interface AgentFormData {
  createMethod: CreateMethod
  cloneFromId?: string
  templateId?: string
  name: string
  description: string
  llmProvider: string
  llmModel: string
  llmTemperature: number
  voiceId: string
  knowledgeNamespaces: string[]
  enabledTools: string[]
  phoneLines: string[]
}

const STEPS = [
  { id: "method", title: "Create Method", icon: Copy },
  { id: "basics", title: "Basics", icon: FileText },
  { id: "voice", title: "Voice & Model", icon: Mic },
  { id: "knowledge", title: "Knowledge", icon: Brain },
  { id: "tools", title: "Tools", icon: Wrench },
  { id: "routing", title: "Phone Routing", icon: Phone },
  { id: "review", title: "Review", icon: Eye },
]

const TEMPLATES = [
  { id: "booking", name: "Booking Agent", description: "Handles appointments and reservations" },
  { id: "support", name: "Support Agent", description: "Customer service and troubleshooting" },
  { id: "sales", name: "Sales Agent", description: "Product inquiries and lead qualification" },
]

const LLM_PROVIDERS = [
  { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"] },
  { id: "anthropic", name: "Anthropic", models: ["claude-3-5-sonnet", "claude-3-opus", "claude-3-haiku"] },
  { id: "google", name: "Google", models: ["gemini-1.5-pro", "gemini-1.5-flash"] },
]

const VOICES = [
  { id: "alloy", name: "Alloy", description: "Neutral and balanced" },
  { id: "echo", name: "Echo", description: "Warm and friendly" },
  { id: "fable", name: "Fable", description: "Expressive and dynamic" },
  { id: "onyx", name: "Onyx", description: "Deep and authoritative" },
  { id: "nova", name: "Nova", description: "Bright and energetic" },
  { id: "shimmer", name: "Shimmer", description: "Soft and soothing" },
]

const KNOWLEDGE_NAMESPACES = [
  { id: "products", name: "Product Catalog" },
  { id: "faq", name: "FAQ & Help Articles" },
  { id: "policies", name: "Company Policies" },
  { id: "pricing", name: "Pricing Information" },
]

const TOOLS = [
  { id: "calendar", name: "Calendar", provider: "Google", requiresCredentials: false },
  { id: "crm", name: "CRM Lookup", provider: "Salesforce", requiresCredentials: true },
  { id: "booking", name: "Booking System", provider: "OpenTable", requiresCredentials: false },
  { id: "payment", name: "Payment Processing", provider: "Stripe", requiresCredentials: true },
  { id: "email", name: "Send Email", provider: "SendGrid", requiresCredentials: false },
  { id: "sms", name: "Send SMS", provider: "Twilio", requiresCredentials: false },
]

const PHONE_LINES = [
  { id: "line1", number: "+1 (555) 123-4567", name: "Main Line" },
  { id: "line2", number: "+1 (555) 234-5678", name: "Support Line" },
  { id: "line3", number: "+1 (555) 345-6789", name: "Sales Line" },
]

export function CreateAgentWizard({ open, onOpenChange, existingAgents, onCreateAgent }: CreateAgentWizardProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<AgentFormData>({
    createMethod: "template",
    name: "",
    description: "",
    llmProvider: "openai",
    llmModel: "gpt-4o",
    llmTemperature: 0.7,
    voiceId: "alloy",
    knowledgeNamespaces: [],
    enabledTools: [],
    phoneLines: [],
  })
  const [configPreviewOpen, setConfigPreviewOpen] = useState(false)

  const currentStepData = STEPS[currentStep]
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === STEPS.length - 1

  const canProceed = () => {
    switch (currentStep) {
      case 0: // Method
        if (formData.createMethod === "clone" && !formData.cloneFromId) return false
        if (formData.createMethod === "template" && !formData.templateId) return false
        return true
      case 1: // Basics
        return formData.name.trim().length > 0
      default:
        return true
    }
  }

  const handleNext = () => {
    if (isLastStep) {
      // Create agent
      const newAgent: Partial<Agent> = {
        id: `agent_${Date.now()}`,
        name: formData.name,
        description: formData.description,
        version: 1,
        status: "draft",
        agentType: (formData.templateId as Agent["agentType"]) || "custom",
        callsToday: 0,
        handledRate: 0,
        escalationRate: 0,
        failureRate: 0,
        toolErrorRate: 0,
        phoneLines: formData.phoneLines,
        knowledgeBase:
          formData.knowledgeNamespaces.length > 0
            ? { status: "connected", name: formData.knowledgeNamespaces.join(", ") }
            : { status: "missing" },
        integrations: formData.enabledTools.map((toolId) => {
          const tool = TOOLS.find((t) => t.id === toolId)
          return { name: tool?.provider || toolId, status: "healthy" as const }
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      onCreateAgent(newAgent)
      onOpenChange(false)
      // Reset form
      setCurrentStep(0)
      setFormData({
        createMethod: "template",
        name: "",
        description: "",
        llmProvider: "openai",
        llmModel: "gpt-4o",
        llmTemperature: 0.7,
        voiceId: "alloy",
        knowledgeNamespaces: [],
        enabledTools: [],
        phoneLines: [],
      })
    } else {
      setCurrentStep((prev) => prev + 1)
    }
  }

  const handleBack = () => {
    setCurrentStep((prev) => prev - 1)
  }

  const selectedProvider = LLM_PROVIDERS.find((p) => p.id === formData.llmProvider)

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Create Method
        return (
          <div className="space-y-4">
            <RadioGroup
              value={formData.createMethod}
              onValueChange={(v) => setFormData((prev) => ({ ...prev, createMethod: v as CreateMethod }))}
              className="space-y-3"
            >
              <label
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors",
                  formData.createMethod === "template" && "border-primary bg-primary/5",
                )}
              >
                <RadioGroupItem value="template" className="mt-0.5" />
                <div>
                  <p className="font-medium">Start from template</p>
                  <p className="text-sm text-muted-foreground">Choose a pre-configured agent type</p>
                </div>
                <Badge className="ml-auto">Recommended</Badge>
              </label>

              <label
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors",
                  formData.createMethod === "clone" && "border-primary bg-primary/5",
                )}
              >
                <RadioGroupItem value="clone" className="mt-0.5" />
                <div>
                  <p className="font-medium">Clone existing agent</p>
                  <p className="text-sm text-muted-foreground">Copy settings from another agent</p>
                </div>
              </label>

              <label
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors",
                  formData.createMethod === "blank" && "border-primary bg-primary/5",
                )}
              >
                <RadioGroupItem value="blank" className="mt-0.5" />
                <div>
                  <p className="font-medium">Blank agent</p>
                  <p className="text-sm text-muted-foreground">Start from scratch</p>
                </div>
              </label>
            </RadioGroup>

            {formData.createMethod === "template" && (
              <div className="mt-4 space-y-2">
                <Label>Select template</Label>
                <div className="grid gap-2">
                  {TEMPLATES.map((template) => (
                    <label
                      key={template.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                        formData.templateId === template.id && "border-primary bg-primary/5",
                      )}
                    >
                      <Checkbox
                        checked={formData.templateId === template.id}
                        onCheckedChange={() => setFormData((prev) => ({ ...prev, templateId: template.id }))}
                      />
                      <div>
                        <p className="font-medium">{template.name}</p>
                        <p className="text-sm text-muted-foreground">{template.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {formData.createMethod === "clone" && (
              <div className="mt-4 space-y-2">
                <Label>Select agent to clone</Label>
                <Select
                  value={formData.cloneFromId}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, cloneFromId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {existingAgents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} (v{agent.version})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )

      case 1: // Basics
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Agent name *</Label>
              <Input
                id="name"
                placeholder="e.g., Customer Support Agent"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="What does this agent do?"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-sm text-muted-foreground">
                Status will be set to <Badge variant="outline">Draft</Badge> until you activate
              </p>
            </div>
          </div>
        )

      case 2: // Voice & Model
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <Label>LLM Provider</Label>
              <Select
                value={formData.llmProvider}
                onValueChange={(v) =>
                  setFormData((prev) => ({
                    ...prev,
                    llmProvider: v,
                    llmModel: LLM_PROVIDERS.find((p) => p.id === v)?.models[0] || "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LLM_PROVIDERS.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <Label>Model</Label>
              <Select
                value={formData.llmModel}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, llmModel: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedProvider?.models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Temperature</Label>
                <span className="text-sm text-muted-foreground">{formData.llmTemperature}</span>
              </div>
              <Slider
                value={[formData.llmTemperature]}
                onValueChange={([v]) => setFormData((prev) => ({ ...prev, llmTemperature: v }))}
                min={0}
                max={1}
                step={0.1}
              />
              <p className="text-xs text-muted-foreground">Lower = more focused, Higher = more creative</p>
            </div>

            <div className="space-y-4">
              <Label>Voice</Label>
              <div className="grid grid-cols-2 gap-2">
                {VOICES.map((voice) => (
                  <label
                    key={voice.id}
                    className={cn(
                      "flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors",
                      formData.voiceId === voice.id && "border-primary bg-primary/5",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={formData.voiceId === voice.id}
                        onCheckedChange={() => setFormData((prev) => ({ ...prev, voiceId: voice.id }))}
                      />
                      <div>
                        <p className="text-sm font-medium">{voice.name}</p>
                        <p className="text-xs text-muted-foreground">{voice.description}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.preventDefault()}>
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )

      case 3: // Knowledge
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Knowledge namespaces</Label>
              <p className="text-sm text-muted-foreground">Select the knowledge bases this agent can access</p>
            </div>
            <div className="space-y-2">
              {KNOWLEDGE_NAMESPACES.map((ns) => (
                <label
                  key={ns.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    formData.knowledgeNamespaces.includes(ns.id) && "border-primary bg-primary/5",
                  )}
                >
                  <Checkbox
                    checked={formData.knowledgeNamespaces.includes(ns.id)}
                    onCheckedChange={(checked) => {
                      setFormData((prev) => ({
                        ...prev,
                        knowledgeNamespaces: checked
                          ? [...prev.knowledgeNamespaces, ns.id]
                          : prev.knowledgeNamespaces.filter((id) => id !== ns.id),
                      }))
                    }}
                  />
                  <span className="font-medium">{ns.name}</span>
                </label>
              ))}
            </div>
            {formData.knowledgeNamespaces.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {formData.knowledgeNamespaces.map((nsId) => {
                  const ns = KNOWLEDGE_NAMESPACES.find((n) => n.id === nsId)
                  return (
                    <Badge key={nsId} variant="secondary">
                      {ns?.name}
                    </Badge>
                  )
                })}
              </div>
            )}
            <Button variant="outline" className="w-full mt-2 bg-transparent">
              Upload documents
            </Button>
          </div>
        )

      case 4: // Tools
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Enabled tools</Label>
              <p className="text-sm text-muted-foreground">Select the tools and integrations this agent can use</p>
            </div>
            <div className="space-y-2">
              {TOOLS.map((tool) => (
                <label
                  key={tool.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    formData.enabledTools.includes(tool.id) && "border-primary bg-primary/5",
                  )}
                >
                  <Checkbox
                    checked={formData.enabledTools.includes(tool.id)}
                    onCheckedChange={(checked) => {
                      setFormData((prev) => ({
                        ...prev,
                        enabledTools: checked
                          ? [...prev.enabledTools, tool.id]
                          : prev.enabledTools.filter((id) => id !== tool.id),
                      }))
                    }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{tool.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {tool.provider}
                      </Badge>
                    </div>
                  </div>
                  {tool.requiresCredentials && (
                    <div className="flex items-center gap-1 text-amber-500">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span className="text-xs">Requires credentials</span>
                    </div>
                  )}
                </label>
              ))}
            </div>
            <Button variant="link" className="px-0">
              Go to Integrations
            </Button>
          </div>
        )

      case 5: // Phone Routing
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Assign phone lines (optional)</Label>
              <p className="text-sm text-muted-foreground">You can assign phone lines now or do this later</p>
            </div>
            <div className="space-y-2">
              {PHONE_LINES.map((line) => (
                <label
                  key={line.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    formData.phoneLines.includes(line.number) && "border-primary bg-primary/5",
                  )}
                >
                  <Checkbox
                    checked={formData.phoneLines.includes(line.number)}
                    onCheckedChange={(checked) => {
                      setFormData((prev) => ({
                        ...prev,
                        phoneLines: checked
                          ? [...prev.phoneLines, line.number]
                          : prev.phoneLines.filter((n) => n !== line.number),
                      }))
                    }}
                  />
                  <div>
                    <p className="font-mono text-sm">{line.number}</p>
                    <p className="text-xs text-muted-foreground">{line.name}</p>
                  </div>
                </label>
              ))}
            </div>
            {formData.phoneLines.length === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground">No phone lines selected. You can assign them later.</p>
              </div>
            )}
          </div>
        )

      case 6: // Review
        return (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="font-medium">{formData.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="outline">Draft</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Model</span>
                <span className="text-sm">
                  {formData.llmProvider} / {formData.llmModel}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Voice</span>
                <span className="text-sm">{VOICES.find((v) => v.id === formData.voiceId)?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Knowledge</span>
                <span className="text-sm">
                  {formData.knowledgeNamespaces.length > 0
                    ? `${formData.knowledgeNamespaces.length} namespace(s)`
                    : "None"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Tools</span>
                <span className="text-sm">
                  {formData.enabledTools.length > 0 ? `${formData.enabledTools.length} tool(s)` : "None"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Phone Lines</span>
                <span className="text-sm">
                  {formData.phoneLines.length > 0 ? `${formData.phoneLines.length} line(s)` : "Not assigned"}
                </span>
              </div>
            </div>

            <Collapsible open={configPreviewOpen} onOpenChange={setConfigPreviewOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between bg-transparent">
                  Config Preview (JSON)
                  <ChevronRight className={cn("h-4 w-4 transition-transform", configPreviewOpen && "rotate-90")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 rounded-lg bg-muted p-4 text-xs overflow-auto max-h-[200px]">
                  {JSON.stringify(
                    {
                      name: formData.name,
                      description: formData.description,
                      llmProvider: formData.llmProvider,
                      llmModel: formData.llmModel,
                      llmTemperature: formData.llmTemperature,
                      voiceId: formData.voiceId,
                      knowledgeNamespaces: formData.knowledgeNamespaces,
                      enabledTools: formData.enabledTools,
                    },
                    null,
                    2,
                  )}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Agent</DialogTitle>
          <DialogDescription>{currentStepData.title}</DialogDescription>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="flex items-center justify-between px-2 py-4 border-b">
          {STEPS.map((step, index) => {
            const Icon = step.icon
            const isCompleted = index < currentStep
            const isCurrent = index === currentStep

            return (
              <div key={step.id} className="flex items-center">
                <div
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors",
                    isCompleted && "bg-primary border-primary",
                    isCurrent && "border-primary",
                    !isCompleted && !isCurrent && "border-muted-foreground/30",
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4 text-primary-foreground" />
                  ) : (
                    <Icon className={cn("h-4 w-4", isCurrent ? "text-primary" : "text-muted-foreground/50")} />
                  )}
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={cn("w-8 h-0.5 mx-1", index < currentStep ? "bg-primary" : "bg-muted-foreground/30")}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto py-4 px-1">{renderStepContent()}</div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-4">
          <Button variant="outline" onClick={handleBack} disabled={isFirstStep}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button onClick={handleNext} disabled={!canProceed()}>
            {isLastStep ? "Create Agent" : "Next"}
            {!isLastStep && <ChevronRight className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

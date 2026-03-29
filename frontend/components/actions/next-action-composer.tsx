"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useToast } from "@/hooks/use-toast"
import {
  Send,
  Calendar,
  MessageSquare,
  Bot,
  Mail,
  Sparkles,
  Phone,
  Edit2,
  ChevronDown,
  AlertTriangle,
  Clock,
} from "lucide-react"
import type { Contact, Template, FollowUp } from "@/lib/actions-store"

interface NextActionComposerProps {
  contact: Contact | null
  followUp?: FollowUp | null
  templates: Template[]
  quietHoursEnabled: boolean
  onSendMessage: (channel: string, message: string) => void
  onScheduleFollowUp: (data: { dueAt: string; priority: number; notes: string }) => void
}

// Quick templates for SMB
const quickTemplates = [
  { id: "complaint_apology", label: "Complaint apology", message: "Hi, I'm sorry to hear about your experience. I'd like to make this right. Can we schedule a call to discuss?" },
  { id: "missed_call", label: "Missed call follow-up", message: "Hi! We missed your call earlier. How can we help you today? Reply or call us back at your convenience." },
  { id: "appointment", label: "Appointment confirmation", message: "Your appointment is confirmed for {{date}} at {{time}}. Reply YES to confirm or call us to reschedule." },
  { id: "estimate", label: "Estimate approval", message: "Your estimate is ready for review. Total: {{amount}}. Reply APPROVE to proceed or call us with questions." },
  { id: "payment", label: "Payment reminder", message: "Friendly reminder: Your invoice of {{amount}} is due. Pay online here: {{link}} or call us to discuss payment options." },
]

export function NextActionComposer({
  contact,
  followUp,
  templates,
  quietHoursEnabled,
  onSendMessage,
  onScheduleFollowUp,
}: NextActionComposerProps) {
  const [activeTab, setActiveTab] = useState("sms")
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")
  const [messageText, setMessageText] = useState("")
  const [isScheduled, setIsScheduled] = useState(false)
  const [scheduledDateTime, setScheduledDateTime] = useState("")

  // Schedule state
  const [scheduleDue, setScheduleDue] = useState("")
  const [schedulePriority, setSchedulePriority] = useState("2")
  const [scheduleNotes, setScheduleNotes] = useState("")

  const [aiCallSettingsOpen, setAiCallSettingsOpen] = useState(false)
  const [recommendedStepOpen, setRecommendedStepOpen] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isScheduling, setIsScheduling] = useState(false)
  const { toast } = useToast()

  // Reset form when contact changes
  useEffect(() => {
    setMessageText("")
    setSelectedTemplate("")
    setIsScheduled(false)
    setScheduledDateTime("")
    setScheduleDue("")
    setSchedulePriority("2")
    setScheduleNotes("")
    setActiveTab("sms")
  }, [contact?.id])

  // Recommended next step
  const recommendedStep = useMemo(() => {
    if (!contact || !followUp) return null

    // Generate recommendation based on follow-up type and status
    const recommendations: Record<string, { title: string; reasoning: string; channel: string; message?: string }> = {
      missed_call: {
        title: "Send callback SMS",
        reasoning: "Customer called but didn't reach anyone",
        channel: "sms",
        message: "Hi! We missed your call. Click here to schedule a callback: [link]",
      },
      booking: {
        title: "Confirm appointment",
        reasoning: "Booking requires confirmation",
        channel: "sms",
        message: "Your appointment is confirmed! Reply YES to confirm or call us to reschedule.",
      },
      estimate_approval: {
        title: "Send estimate reminder",
        reasoning: "Estimate pending approval",
        channel: "sms",
        message: "Your estimate is ready! Review and approve here: [link]",
      },
      complaint: {
        title: "Manager callback required",
        reasoning: "Complaint + negative sentiment + overdue",
        channel: "call",
      },
      catering: {
        title: "Send catering form",
        reasoning: "Catering inquiry needs intake form",
        channel: "sms",
        message: "Thanks for your interest in catering! Please fill out this form: [link]",
      },
      ready_pickup: {
        title: "Notify ready for pickup",
        reasoning: "Vehicle/order is ready",
        channel: "sms",
        message: "Great news! Your vehicle is ready for pickup. We're open until 6 PM today.",
      },
      payment_pending: {
        title: "Send payment reminder",
        reasoning: "Invoice is due",
        channel: "sms",
        message: "Reminder: Your invoice is ready for payment. Pay online here: [link]",
      },
    }

    return recommendations[followUp.type] || { title: "Follow up with customer", reasoning: "General follow-up required", channel: "sms" }
  }, [contact, followUp])

  // Filter templates by vertical
  const filteredTemplates = useMemo(() => {
    if (!followUp) return templates
    return templates.filter((t) => t.vertical === followUp.vertical || t.vertical === "Common")
  }, [templates, followUp])

  // Handle template selection
  const handleTemplateSelect = useCallback((templateId: string) => {
    if (!templateId) return
    
    setSelectedTemplate(templateId)
    const template = templates.find((t) => t && t.id === templateId)
    if (template && template.smsTemplate) {
      try {
        let message = template.smsTemplate
        if (contact?.name) {
          message = message.replace(/\{\{name\}\}/g, contact.name)
        }
        if (followUp?.metadata) {
          Object.entries(followUp.metadata).forEach(([key, value]) => {
            if (key && value) {
              message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value))
            }
          })
        }
        setMessageText(message)
      } catch (error) {
        console.error("Error processing template:", error)
        toast({
          title: "Template error",
          description: "Failed to process template. Please try again.",
          variant: "destructive",
        })
      }
    } else {
      toast({
        title: "Template not found",
        description: "The selected template could not be loaded.",
        variant: "destructive",
      })
    }
  }, [contact, followUp, templates, toast, setMessageText])

  // Handle quick template selection
  const handleQuickTemplate = useCallback((template: typeof quickTemplates[0]) => {
    if (!template || !template.message) {
      toast({
        title: "Template error",
        description: "Template message is missing.",
        variant: "destructive",
      })
      return
    }

    try {
      let message = template.message
      if (contact?.name) {
        message = message.replace(/\{\{name\}\}/g, contact.name)
      }
      setMessageText(message)
    } catch (error) {
      console.error("Error processing quick template:", error)
      toast({
        title: "Template error",
        description: "Failed to process template. Please try again.",
        variant: "destructive",
      })
    }
  }, [contact, toast, setMessageText])

  // Handle send message with loading state and form reset
  const handleSendMessage = useCallback(async (channel: string, message: string) => {
    // Validation
    if (!message.trim()) {
      toast({
        title: "Message required",
        description: "Please enter a message before sending",
        variant: "destructive",
      })
      return
    }

    if (isSending) return

    if (!contact) {
      toast({
        title: "No contact selected",
        description: "Please select a contact from the queue",
        variant: "destructive",
      })
      return
    }

    if (channel === "sms" && contact.smsOptOut) {
      toast({
        title: "SMS not allowed",
        description: "This contact has opted out of SMS messages",
        variant: "destructive",
      })
      return
    }
    
    setIsSending(true)
    try {
      await onSendMessage(channel, message)
      // Clear form after successful send
      setMessageText("")
      setSelectedTemplate("")
      setIsScheduled(false)
      setScheduledDateTime("")
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to send message"
      toast({
        title: "Failed to send",
        description: errorMessage,
        variant: "destructive",
      })
      console.error("Failed to send message:", error)
    } finally {
      setIsSending(false)
    }
  }, [contact, isSending, onSendMessage, toast])

  // Handle schedule follow-up with loading state and form reset
  const handleScheduleFollowUp = useCallback(async (data: { dueAt: string; priority: number; notes: string }) => {
    // Validation
    if (!data.dueAt) {
      toast({
        title: "Due date required",
        description: "Please select a due date and time for the follow-up",
        variant: "destructive",
      })
      return
    }

    if (isScheduling) return

    if (!contact) {
      toast({
        title: "No contact selected",
        description: "Please select a contact from the queue",
        variant: "destructive",
      })
      return
    }

    // Validate due date is in the future
    const dueDate = new Date(data.dueAt)
    const now = new Date()
    if (dueDate <= now) {
      toast({
        title: "Invalid due date",
        description: "Due date must be in the future",
        variant: "destructive",
      })
      return
    }
    
    setIsScheduling(true)
    try {
      await onScheduleFollowUp(data)
      // Clear form after successful schedule
      setScheduleDue("")
      setSchedulePriority("2")
      setScheduleNotes("")
      setActiveTab("sms") // Switch back to SMS tab
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to schedule follow-up"
      toast({
        title: "Failed to schedule",
        description: errorMessage,
        variant: "destructive",
      })
      console.error("Failed to schedule follow-up:", error)
    } finally {
      setIsScheduling(false)
    }
  }, [contact, isScheduling, onScheduleFollowUp, toast])

  // Quick schedule presets
  const schedulePresets = [
    { label: "15m", minutes: 15 },
    { label: "1h", minutes: 60 },
    {
      label: "Tomorrow 9am",
      date: (() => {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(9, 0, 0, 0)
        return d
      })(),
    },
    {
      label: "Next business day",
      date: (() => {
        const d = new Date()
        do {
          d.setDate(d.getDate() + 1)
        } while (d.getDay() === 0 || d.getDay() === 6)
        d.setHours(9, 0, 0, 0)
        return d
      })(),
    },
  ]

  // Empty state with 3-step guide
  if (!contact) {
    return (
      <div className="h-full flex flex-col bg-background/50 border-l border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Next Action</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-[280px]">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
              <Send className="h-8 w-8 text-primary/70" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-2">Ready to take action</h3>
            <p className="text-xs text-muted-foreground mb-6">
              Select a contact from the queue to compose messages, schedule follow-ups, or send automated responses.
            </p>
            <div className="text-left space-y-4">
              <div className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-semibold mt-0.5">
                  1
                </div>
                <p className="text-xs text-muted-foreground pt-0.5">Select a follow-up from the queue</p>
              </div>
              <div className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-semibold mt-0.5">
                  2
                </div>
                <p className="text-xs text-muted-foreground pt-0.5">Review contact context and transcript</p>
              </div>
              <div className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-semibold mt-0.5">
                  3
                </div>
                <p className="text-xs text-muted-foreground pt-0.5">Send message or schedule follow-up</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background/50 border-l border-border">
      {/* Follow-up Status Bar - Compact */}
      {followUp && (
        <div className="px-4 py-3 border-b border-border bg-card/50">
          <div className="flex items-center gap-2 text-xs min-w-0">
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 whitespace-nowrap",
                followUp.status === "open" && "bg-blue-500/10 text-blue-400 border-blue-500/30",
                followUp.status === "snoozed" && "bg-amber-500/10 text-amber-400 border-amber-500/30",
                followUp.status === "done" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
              )}
            >
              {followUp.status}
            </Badge>
            <span className="text-muted-foreground truncate min-w-0 flex-1">
              Due {new Date(followUp.dueAt).toLocaleDateString()}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 whitespace-nowrap",
                followUp.priority === 1 && "bg-red-500/10 text-red-400 border-red-500/30",
                followUp.priority === 2 && "bg-amber-500/10 text-amber-400 border-amber-500/30",
                followUp.priority === 3 && "bg-muted text-muted-foreground",
              )}
            >
              {followUp.priority === 1 ? "High" : followUp.priority === 2 ? "Medium" : "Low"}
            </Badge>
          </div>
        </div>
      )}

      {/* Recommended Next Step - Collapsible */}
      {recommendedStep && (
        <Collapsible open={recommendedStepOpen} onOpenChange={setRecommendedStepOpen}>
          <div className="border-b border-border bg-primary/5">
            <CollapsibleTrigger asChild>
              <div className="px-4 py-3 cursor-pointer hover:bg-primary/10 transition-colors">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{recommendedStep.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{recommendedStep.reasoning}</p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                      recommendedStepOpen && "rotate-180",
                    )}
                  />
                </div>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-3 space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {recommendedStep.channel === "call" ? (
                    <Button size="sm" className="flex-1 min-w-[100px]">
                      <Phone className="h-3.5 w-3.5 mr-1.5" />
                      Call now
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="flex-1 min-w-[100px]"
                      onClick={() => {
                        if (recommendedStep.message) {
                          onSendMessage("sms", recommendedStep.message)
                        }
                      }}
                    >
                      <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                      Send SMS
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent shrink-0"
                    onClick={() => {
                      if (recommendedStep.message) {
                        setMessageText(recommendedStep.message)
                      }
                      setActiveTab(recommendedStep.channel === "call" ? "call" : "sms")
                    }}
                    disabled={isSending || isScheduling}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="bg-transparent shrink-0" 
                    onClick={() => setActiveTab("schedule")}
                    disabled={isSending || isScheduling}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Composer Tabs - SMS / Call / Email */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full grid grid-cols-4">
              <TabsTrigger value="sms" className="text-xs flex items-center justify-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">SMS</span>
              </TabsTrigger>
              <TabsTrigger value="call" className="text-xs flex items-center justify-center gap-1.5">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">Call</span>
              </TabsTrigger>
              <TabsTrigger value="email" className="text-xs flex items-center justify-center gap-1.5">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">Email</span>
              </TabsTrigger>
              <TabsTrigger value="schedule" className="text-xs flex items-center justify-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">Schedule</span>
              </TabsTrigger>
            </TabsList>

            {/* SMS Tab */}
            <TabsContent value="sms" className="mt-4 space-y-4">
              {/* Warnings */}
              {contact.smsOptOut && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                  <span className="text-xs text-red-400">Contact has opted out of SMS</span>
                </div>
              )}

              {/* Unified Template Selection */}
              <div className="space-y-1.5">
                <Label className="text-xs">Templates</Label>
                <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                  <SelectTrigger className="h-9" aria-label="Select message template">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Quick templates as chips below */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {quickTemplates.map((qt) => (
                    <Button
                      key={qt.id}
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2 bg-transparent whitespace-nowrap"
                      onClick={() => handleQuickTemplate(qt)}
                    >
                      {qt.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Message editor */}
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="sms-message">Message</Label>
                <Textarea
                  id="sms-message"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type your message..."
                  className="min-h-[100px] resize-none"
                  aria-label="SMS message text"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{messageText.length} characters</span>
                  {messageText.length > 160 && (
                    <span className="text-amber-400">{Math.ceil(messageText.length / 160)} SMS segments</span>
                  )}
                </div>
              </div>

              {/* Send now vs Schedule toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="schedule-toggle" className="text-xs">Schedule for later</Label>
                <Switch
                  id="schedule-toggle"
                  checked={isScheduled}
                  onCheckedChange={setIsScheduled}
                  className="scale-75"
                />
              </div>

              {isScheduled && (
                <Input
                  type="datetime-local"
                  value={scheduledDateTime}
                  onChange={(e) => setScheduledDateTime(e.target.value)}
                  className="h-9"
                />
              )}

              {/* Send button */}
              <Button
                className="w-full"
                onClick={() => handleSendMessage("sms", messageText)}
                disabled={!messageText.trim() || contact.smsOptOut || isSending}
                aria-label={isSending ? "Sending SMS message" : isScheduled ? "Schedule SMS message" : "Send SMS message"}
              >
                <Send className="h-4 w-4 mr-2" aria-hidden="true" />
                {isSending ? "Sending..." : isScheduled ? "Schedule SMS" : "Send SMS"}
              </Button>
            </TabsContent>

            {/* Call Tab */}
            <TabsContent value="call" className="mt-4 space-y-4">
              {quietHoursEnabled && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="text-xs text-amber-400">Quiet hours active - AI calls may be delayed</span>
                </div>
              )}

              {/* Call script */}
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="call-script">Call script / goal</Label>
                <Textarea
                  id="call-script"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Enter call script or goal for AI..."
                  className="min-h-[100px] resize-none"
                  aria-label="AI call script or goal"
                />
              </div>

              {/* AI Call Settings */}
              <Collapsible open={aiCallSettingsOpen} onOpenChange={setAiCallSettingsOpen}>
                <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", aiCallSettingsOpen && "rotate-180")}
                  />
                  Advanced settings
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Max attempts</Label>
                    <Select defaultValue="2">
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="2">2</SelectItem>
                        <SelectItem value="3">3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="fallback-sms" className="rounded" defaultChecked />
                    <Label htmlFor="fallback-sms" className="text-xs">
                      Fallback to SMS if no answer
                    </Label>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex gap-2">
                <Button 
                  className="flex-1" 
                  onClick={() => handleSendMessage("ai_call", messageText)}
                  disabled={!messageText.trim() || isSending}
                  aria-label={isSending ? "Initiating AI call" : "Initiate AI call"}
                >
                  <Bot className="h-4 w-4 mr-2" aria-hidden="true" />
                  {isSending ? "Sending..." : "AI Call"}
                </Button>
                <Button variant="outline" className="flex-1 bg-transparent" aria-label="Initiate manual call">
                  <Phone className="h-4 w-4 mr-2" aria-hidden="true" />
                  Manual Call
                </Button>
              </div>
            </TabsContent>

            {/* Email Tab */}
            <TabsContent value="email" className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="email-subject">Subject</Label>
                <Input id="email-subject" placeholder="Email subject..." className="h-9" aria-label="Email subject" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="email-message">Message</Label>
                <Textarea
                  id="email-message"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type your email..."
                  className="min-h-[120px] resize-none"
                  aria-label="Email message text"
                />
              </div>

              <Button 
                className="w-full" 
                onClick={() => handleSendMessage("email", messageText)} 
                disabled={!messageText.trim() || isSending}
                aria-label={isSending ? "Sending email" : "Send email"}
              >
                <Mail className="h-4 w-4 mr-2" aria-hidden="true" />
                {isSending ? "Sending..." : "Send Email"}
              </Button>
            </TabsContent>

            {/* Schedule Tab */}
            <TabsContent value="schedule" className="mt-4 space-y-4">
              {/* Quick presets */}
              <div className="space-y-1.5">
                <Label className="text-xs">Quick Schedule</Label>
                <div className="flex flex-wrap gap-2">
                  {schedulePresets.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs bg-transparent"
                      onClick={() => {
                        const date = preset.date || new Date(Date.now() + preset.minutes! * 60000)
                        setScheduleDue(date.toISOString().slice(0, 16))
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Date/time picker */}
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="schedule-due">Due Date & Time</Label>
                <Input
                  id="schedule-due"
                  type="datetime-local"
                  value={scheduleDue}
                  onChange={(e) => setScheduleDue(e.target.value)}
                  className="h-9"
                  aria-label="Follow-up due date and time"
                />
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="schedule-priority">Priority</Label>
                <Select value={schedulePriority} onValueChange={setSchedulePriority}>
                  <SelectTrigger id="schedule-priority" className="h-9" aria-label="Follow-up priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">High</SelectItem>
                    <SelectItem value="2">Medium</SelectItem>
                    <SelectItem value="3">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="schedule-notes">Notes</Label>
                <Textarea
                  id="schedule-notes"
                  value={scheduleNotes}
                  onChange={(e) => setScheduleNotes(e.target.value)}
                  placeholder="Add notes for this follow-up..."
                  className="min-h-[80px] resize-none"
                  aria-label="Follow-up notes"
                />
              </div>

              {/* Schedule button */}
              <Button
                className="w-full"
                onClick={() =>
                  handleScheduleFollowUp({
                    dueAt: new Date(scheduleDue).toISOString(),
                    priority: Number.parseInt(schedulePriority),
                    notes: scheduleNotes,
                  })
                }
                disabled={!scheduleDue || isScheduling}
                aria-label={isScheduling ? "Scheduling follow-up" : "Schedule follow-up"}
              >
                <Calendar className="h-4 w-4 mr-2" aria-hidden="true" />
                {isScheduling ? "Scheduling..." : "Schedule Follow-Up"}
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  )
}

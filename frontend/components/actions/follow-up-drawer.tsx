"use client"

import { useState, useMemo } from "react"
import { format, formatDistanceToNow } from "date-fns"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Calendar, CheckCircle, Link2, MessageSquare, Phone, PhoneCall, Send, User, Ban } from "lucide-react"
import { useActionsState, type FollowUp, type Channel } from "@/lib/actions-store"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface FollowUpDrawerProps {
  followUp: FollowUp | null
  open: boolean
  onClose: () => void
}

const channelIcons: Record<Channel, typeof Phone> = {
  sms: MessageSquare,
  ai_call: PhoneCall,
  email: Send,
  manual: User,
}

export function FollowUpDrawer({ followUp, open, onClose }: FollowUpDrawerProps) {
  const { state, dispatch, getContact, getCall, getTemplate } = useActionsState()
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState("compose")
  const [messageText, setMessageText] = useState("")
  const [notes, setNotes] = useState("")

  const contact = followUp ? getContact(followUp.contactId) : null
  const call = followUp?.callId ? getCall(followUp.callId) : null

  // Get appropriate template
  const template = useMemo(() => {
    if (!followUp) return null
    return state.templates.find(
      (t) => t.type === followUp.type && (t.vertical === followUp.vertical || t.vertical === "Common"),
    )
  }, [followUp, state.templates])

  // Initialize message from template
  const initialMessage = useMemo(() => {
    if (!template || !contact) return ""
    let msg = template.smsTemplate
    msg = msg.replace("{name}", contact.name || "there")
    msg = msg.replace("{phone}", contact.phone)
    msg = msg.replace("{shopName}", "Mike's Auto Shop")
    msg = msg.replace("{restaurantName}", "Bella's Kitchen")
    msg = msg.replace("{vehicle}", followUp?.metadata?.vehicle || "your vehicle")
    msg = msg.replace("{partySize}", followUp?.metadata?.partySize || "your party")
    msg = msg.replace("{hours}", "Mon-Fri 8am-6pm")
    msg = msg.replace("{bookingLink}", template.links.bookingLink || "https://book.example.com")
    msg = msg.replace("{paymentLink}", template.links.paymentLink || "https://pay.example.com")
    msg = msg.replace("{estimateLink}", template.links.estimateLink || "https://estimate.example.com")
    msg = msg.replace("{formLink}", template.links.formLink || "https://forms.example.com")
    return msg
  }, [template, contact, followUp])

  const handleSendSms = () => {
    if (!followUp || !messageText.trim()) return

    if (contact?.smsOptOut) {
      toast({
        title: "Cannot send SMS",
        description: "Contact has opted out of SMS messages",
        variant: "destructive",
      })
      return
    }

    // Add attempt
    dispatch({
      type: "ADD_ATTEMPT",
      followUpId: followUp.id,
      attempt: {
        id: `att-${Date.now()}`,
        type: "sms",
        time: new Date().toISOString(),
        result: "sent",
        note: messageText.slice(0, 50) + "...",
      },
    })

    // Update status
    dispatch({
      type: "UPDATE_FOLLOW_UP",
      id: followUp.id,
      updates: { status: "waiting_on_customer" },
    })

    toast({ title: "SMS sent", description: "Message sent successfully" })
    setMessageText("")
  }

  const handleAiCall = () => {
    if (!followUp) return

    dispatch({
      type: "ADD_ATTEMPT",
      followUpId: followUp.id,
      attempt: {
        id: `att-${Date.now()}`,
        type: "ai_call",
        time: new Date().toISOString(),
        result: Math.random() > 0.3 ? "completed" : "no_answer",
      },
    })

    dispatch({
      type: "UPDATE_FOLLOW_UP",
      id: followUp.id,
      updates: { status: "waiting_on_customer" },
    })

    toast({ title: "AI Call initiated", description: "Call is being placed" })
  }

  const handleMarkComplete = () => {
    if (!followUp) return
    dispatch({ type: "UPDATE_FOLLOW_UP", id: followUp.id, updates: { status: "done" } })
    toast({ title: "Follow-up completed" })
    onClose()
  }

  const handleSimulateReply = (reply: string) => {
    if (!followUp) return

    dispatch({
      type: "ADD_ATTEMPT",
      followUpId: followUp.id,
      attempt: {
        id: `att-${Date.now()}`,
        type: "sms",
        time: new Date().toISOString(),
        result: "replied",
        note: `Customer replied: "${reply}"`,
      },
    })

    if (reply.toUpperCase() === "STOP") {
      dispatch({ type: "UPDATE_CONTACT", id: followUp.contactId, updates: { smsOptOut: true } })
      dispatch({ type: "UPDATE_FOLLOW_UP", id: followUp.id, updates: { status: "canceled" } })
      toast({ title: "Contact opted out", description: "SMS messaging disabled for this contact" })
    } else {
      toast({ title: "Customer replied", description: `Reply: "${reply}"` })
    }
  }

  const handleClaim = () => {
    if (!followUp) return
    dispatch({
      type: "UPDATE_FOLLOW_UP",
      id: followUp.id,
      updates: { ownerId: "current_user", status: "in_progress" },
    })
    toast({ title: "Follow-up claimed" })
  }

  if (!followUp) return null

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-hidden flex flex-col">
        <SheetHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <SheetTitle>Follow-Up Details</SheetTitle>
            <Badge variant={followUp.status === "done" ? "secondary" : "default"}>
              {followUp.status.replace("_", " ")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{followUp.id}</p>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 py-4">
            {/* Summary Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  {contact?.name ? (
                    <span className="text-lg font-medium">
                      {contact.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                  ) : (
                    <User className="h-6 w-6" />
                  )}
                </div>
                <div>
                  <p className="font-semibold">{contact?.name || "Unknown Contact"}</p>
                  <p className="text-sm text-muted-foreground">{contact?.phone}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Type</p>
                  <p className="font-medium">{followUp.type.replace("_", " ")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vertical</p>
                  <p className="font-medium">{followUp.vertical}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Severity</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      followUp.severity === "critical" && "border-red-500 text-red-500",
                      followUp.severity === "high" && "border-orange-500 text-orange-500",
                    )}
                  >
                    {followUp.severity}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Due</p>
                  <p className={cn("font-medium", new Date(followUp.dueAt) < new Date() && "text-red-500")}>
                    {formatDistanceToNow(new Date(followUp.dueAt), { addSuffix: true })}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Owner</p>
                  <p className="font-medium">
                    {followUp.ownerId === "current_user"
                      ? "You"
                      : followUp.ownerId === "manager"
                        ? "Manager"
                        : followUp.ownerId || "Unassigned"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium">{format(new Date(followUp.createdAt), "MMM d, h:mm a")}</p>
                </div>
              </div>

              {contact?.smsOptOut && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg text-red-600">
                  <Ban className="h-4 w-4" />
                  <span className="text-sm">Contact has opted out of SMS</span>
                </div>
              )}
            </div>

            <Separator />

            {/* Call Context */}
            {call && (
              <>
                <div className="space-y-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Call Context
                  </h4>
                  <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                    {call.summary && <p className="text-sm">{call.summary}</p>}
                    <div className="flex flex-wrap gap-2 text-xs">
                      {call.intent && <Badge variant="outline">Intent: {call.intent}</Badge>}
                      {call.sentiment && (
                        <Badge
                          variant="outline"
                          className={cn(
                            call.sentiment === "positive" && "border-green-500",
                            call.sentiment === "negative" && "border-red-500",
                          )}
                        >
                          {call.sentiment}
                        </Badge>
                      )}
                      <Badge variant="outline">{call.outcome}</Badge>
                    </div>
                    {Object.keys(call.extractedFields).length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {Object.entries(call.extractedFields).map(([k, v]) => (
                          <span key={k} className="mr-2">
                            {k}: <span className="font-medium">{v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Action Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full">
                <TabsTrigger value="compose" className="flex-1">
                  Compose
                </TabsTrigger>
                <TabsTrigger value="timeline" className="flex-1">
                  Timeline
                </TabsTrigger>
                <TabsTrigger value="checklist" className="flex-1">
                  Checklist
                </TabsTrigger>
              </TabsList>

              <TabsContent value="compose" className="mt-4 space-y-4">
                {/* Quick Actions */}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="h-auto py-3 flex-col gap-1 bg-transparent"
                    onClick={() => {
                      setMessageText(initialMessage)
                    }}
                    disabled={contact?.smsOptOut}
                  >
                    <MessageSquare className="h-5 w-5" />
                    <span className="text-xs">Send SMS</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-3 flex-col gap-1 bg-transparent"
                    onClick={handleAiCall}
                  >
                    <PhoneCall className="h-5 w-5" />
                    <span className="text-xs">AI Call</span>
                  </Button>
                  {template?.links.bookingLink && (
                    <Button variant="outline" className="h-auto py-3 flex-col gap-1 bg-transparent">
                      <Calendar className="h-5 w-5" />
                      <span className="text-xs">Booking Link</span>
                    </Button>
                  )}
                  {template?.links.paymentLink && (
                    <Button variant="outline" className="h-auto py-3 flex-col gap-1 bg-transparent">
                      <Link2 className="h-5 w-5" />
                      <span className="text-xs">Payment Link</span>
                    </Button>
                  )}
                </div>

                {/* Message Composer */}
                <div className="space-y-2">
                  <Label>SMS Message</Label>
                  <Textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder={contact?.smsOptOut ? "Contact has opted out of SMS" : "Type your message..."}
                    disabled={contact?.smsOptOut}
                    rows={4}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{messageText.length} characters</span>
                    <Button size="sm" onClick={handleSendSms} disabled={!messageText.trim() || contact?.smsOptOut}>
                      <Send className="h-4 w-4 mr-2" />
                      Send SMS
                    </Button>
                  </div>
                </div>

                {/* Simulate Reply (for demo) */}
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Simulate Customer Reply</Label>
                  <div className="flex flex-wrap gap-2">
                    {template?.quickReplies?.map((reply) => (
                      <Button key={reply} variant="outline" size="sm" onClick={() => handleSimulateReply(reply)}>
                        {reply}
                      </Button>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 bg-transparent"
                      onClick={() => handleSimulateReply("STOP")}
                    >
                      STOP
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="timeline" className="mt-4">
                <div className="space-y-4">
                  {followUp.attempts.length === 0 && followUp.scheduledSteps.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No attempts yet</p>
                  ) : (
                    <>
                      {/* Attempts */}
                      {followUp.attempts.map((attempt) => {
                        const Icon = channelIcons[attempt.type]
                        return (
                          <div key={attempt.id} className="flex gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm capitalize">{attempt.type.replace("_", " ")}</span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-xs",
                                    attempt.result === "completed" && "border-green-500 text-green-500",
                                    attempt.result === "replied" && "border-blue-500 text-blue-500",
                                    attempt.result === "failed" && "border-red-500 text-red-500",
                                    attempt.result === "no_answer" && "border-orange-500 text-orange-500",
                                  )}
                                >
                                  {attempt.result}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(attempt.time), "MMM d, h:mm a")}
                              </p>
                              {attempt.note && <p className="text-sm text-muted-foreground mt-1">{attempt.note}</p>}
                            </div>
                          </div>
                        )
                      })}

                      {/* Scheduled Steps */}
                      {followUp.scheduledSteps
                        .filter((s) => s.status === "scheduled")
                        .map((step) => {
                          const Icon = channelIcons[step.channel]
                          return (
                            <div key={step.id} className="flex gap-3 opacity-60">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed">
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{step.actionKey.replace("_", " ")}</span>
                                  <Badge variant="outline" className="text-xs">
                                    Scheduled
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(step.runAt), "MMM d, h:mm a")}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                    </>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="checklist" className="mt-4">
                {template?.checklist && template.checklist.length > 0 ? (
                  <div className="space-y-2">
                    {template.checklist.map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="checkbox" className="rounded" />
                        <span className="text-sm">{item}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No checklist for this follow-up type</p>
                )}
              </TabsContent>
            </Tabs>

            <Separator />

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes || followUp.notes || ""}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes..."
                rows={2}
              />
            </div>
          </div>
        </ScrollArea>

        {/* Footer Actions */}
        <div className="flex items-center gap-2 pt-4 border-t">
          {!followUp.ownerId && (
            <Button variant="outline" onClick={handleClaim}>
              Claim
            </Button>
          )}
          <Button variant="outline" className="flex-1 bg-transparent" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleMarkComplete} disabled={followUp.status === "done"}>
            <CheckCircle className="h-4 w-4 mr-2" />
            Complete
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

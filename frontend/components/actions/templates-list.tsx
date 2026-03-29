"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Edit, Eye } from "lucide-react"
import { useActionsState, type Template } from "@/lib/actions-store"
import { useToast } from "@/hooks/use-toast"
import { EmptyState } from "@/components/empty-state"

export function TemplatesList() {
  const { state, dispatch } = useActionsState()
  const { toast } = useToast()

  const [viewTemplate, setViewTemplate] = useState<Template | null>(null)
  const [editTemplate, setEditTemplate] = useState<Template | null>(null)

  const groupedTemplates = {
    AutoShop: state.templates.filter((t) => t.vertical === "AutoShop"),
    Restaurant: state.templates.filter((t) => t.vertical === "Restaurant"),
    Common: state.templates.filter((t) => t.vertical === "Common"),
  }

  const handleSaveTemplate = () => {
    if (!editTemplate) return
    dispatch({ type: "UPDATE_TEMPLATE", id: editTemplate.id, updates: editTemplate })
    toast({ title: "Template saved" })
    setEditTemplate(null)
  }

  if (state.templates.length === 0) {
    return <EmptyState title="No templates" description="Templates will appear here when created." variant="default" />
  }

  return (
    <div className="space-y-4">
      <Accordion type="multiple" defaultValue={["AutoShop", "Restaurant", "Common"]} className="space-y-4">
        {Object.entries(groupedTemplates).map(([vertical, templates]) => {
          if (templates.length === 0) return null

          return (
            <AccordionItem key={vertical} value={vertical} className="border rounded-lg">
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{vertical}</span>
                  <Badge variant="secondary">{templates.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {templates.map((template) => (
                    <Card key={template.id} className="overflow-hidden">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-sm">{template.title}</CardTitle>
                            <Badge variant="outline" className="text-xs mt-1">
                              {template.type.replace("_", " ")}
                            </Badge>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setViewTemplate(template)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setEditTemplate(template)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pb-3">
                        <p className="text-xs text-muted-foreground line-clamp-2">{template.smsTemplate}</p>
                        {template.tokens.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {template.tokens.slice(0, 3).map((token) => (
                              <Badge key={token} variant="secondary" className="text-xs">
                                {`{${token}}`}
                              </Badge>
                            ))}
                            {template.tokens.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{template.tokens.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>

      {/* View Template Modal */}
      <Dialog open={!!viewTemplate} onOpenChange={() => setViewTemplate(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewTemplate?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">SMS Template</Label>
              <div className="mt-1 p-3 bg-muted rounded-lg text-sm whitespace-pre-wrap">
                {viewTemplate?.smsTemplate}
              </div>
            </div>

            {viewTemplate?.quickReplies && viewTemplate.quickReplies.length > 0 && (
              <div>
                <Label className="text-muted-foreground">Quick Replies</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {viewTemplate.quickReplies.map((reply) => (
                    <Badge key={reply} variant="outline">
                      {reply}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {viewTemplate?.checklist && viewTemplate.checklist.length > 0 && (
              <div>
                <Label className="text-muted-foreground">Checklist</Label>
                <ul className="mt-1 space-y-1">
                  {viewTemplate.checklist.map((item, i) => (
                    <li key={i} className="text-sm flex items-center gap-2">
                      <span className="w-4 h-4 rounded border" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <Label className="text-muted-foreground">Available Tokens</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {viewTemplate?.tokens.map((token) => (
                  <Badge key={token} variant="secondary">{`{${token}}`}</Badge>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Template Modal */}
      <Dialog open={!!editTemplate} onOpenChange={() => setEditTemplate(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input
                value={editTemplate?.title || ""}
                onChange={(e) => setEditTemplate(editTemplate ? { ...editTemplate, title: e.target.value } : null)}
              />
            </div>
            <div>
              <Label>SMS Template</Label>
              <Textarea
                value={editTemplate?.smsTemplate || ""}
                onChange={(e) =>
                  setEditTemplate(editTemplate ? { ...editTemplate, smsTemplate: e.target.value } : null)
                }
                rows={4}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Available tokens: {editTemplate?.tokens.map((t) => `{${t}}`).join(", ")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTemplate(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

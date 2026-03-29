"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Copy, Edit, MoreHorizontal, Play, Trash2 } from "lucide-react"
import { useActionsState, type Workflow } from "@/lib/actions-store"
import { useToast } from "@/hooks/use-toast"
import { EmptyState } from "@/components/empty-state"

interface WorkflowListProps {
  onEdit: (id: string) => void
}

export function WorkflowList({ onEdit }: WorkflowListProps) {
  const { state, dispatch } = useActionsState()
  const { toast } = useToast()

  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleToggle = (workflow: Workflow) => {
    dispatch({
      type: "UPDATE_WORKFLOW",
      id: workflow.id,
      updates: { enabled: !workflow.enabled },
    })
    toast({
      title: workflow.enabled ? "Workflow disabled" : "Workflow enabled",
    })
  }

  const handleDuplicate = (workflow: Workflow) => {
    const newWorkflow: Workflow = {
      ...workflow,
      id: `wf-${Date.now()}`,
      name: `${workflow.name} (Copy)`,
      isBuiltIn: false,
      enabled: false,
    }
    dispatch({ type: "ADD_WORKFLOW", workflow: newWorkflow })
    toast({ title: "Workflow duplicated" })
  }

  const handleDelete = () => {
    if (!deleteId) return
    dispatch({ type: "DELETE_WORKFLOW", id: deleteId })
    setDeleteId(null)
    toast({ title: "Workflow deleted" })
  }

  const groupedWorkflows = {
    Common: state.workflows.filter((w) => w.vertical === "Common"),
    AutoShop: state.workflows.filter((w) => w.vertical === "AutoShop"),
    Restaurant: state.workflows.filter((w) => w.vertical === "Restaurant"),
  }

  if (state.workflows.length === 0) {
    return (
      <EmptyState
        title="No workflows"
        description="Create your first workflow to automate follow-ups."
        variant="default"
      />
    )
  }

  return (
    <div className="space-y-6">
      {Object.entries(groupedWorkflows).map(([vertical, workflows]) => {
        if (workflows.length === 0) return null

        return (
          <Card key={vertical}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{vertical}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Steps</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead>Budget</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workflows.map((workflow) => (
                    <TableRow key={workflow.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{workflow.name}</span>
                          {workflow.isBuiltIn && (
                            <Badge variant="secondary" className="text-xs">
                              Built-in
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {workflow.triggerKey.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{workflow.steps.length} steps</TableCell>
                      <TableCell className="text-muted-foreground">
                        {workflow.slaMinutes < 60
                          ? `${workflow.slaMinutes}m`
                          : `${Math.round(workflow.slaMinutes / 60)}h`}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {workflow.attemptBudget.smsMax} SMS, {workflow.attemptBudget.aiCallMax} AI
                      </TableCell>
                      <TableCell>
                        <Switch checked={workflow.enabled} onCheckedChange={() => handleToggle(workflow)} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(workflow.id)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(workflow)}>
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggle(workflow)}>
                              <Play className="h-4 w-4 mr-2" />
                              {workflow.enabled ? "Disable" : "Enable"}
                            </DropdownMenuItem>
                            {!workflow.isBuiltIn && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-red-500" onClick={() => setDeleteId(workflow.id)}>
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The workflow will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

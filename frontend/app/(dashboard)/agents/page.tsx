"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bot, Plus, Edit, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { AgentConfig } from "@/lib/types";

// Install dialog component if needed
function AgentEditDialog({
  agent,
  onClose,
}: {
  agent?: AgentConfig;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(agent?.name || "");
  const [configJson, setConfigJson] = useState(
    JSON.stringify(agent?.config || {}, null, 2)
  );

  const createMutation = useMutation({
    mutationFn: (data: { name: string; config: Record<string, unknown> }) =>
      api.config.createAgent(data.name, data.config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: {
      agentId: string;
      name: string;
      config: Record<string, unknown>;
    }) => api.config.updateAgent(data.agentId, data.name, data.config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const config = JSON.parse(configJson);
      if (agent) {
        updateMutation.mutate({ agentId: agent.id, name, config });
      } else {
        createMutation.mutate({ name, config });
      }
    } catch (error) {
      alert("Invalid JSON configuration");
    }
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{agent ? "Edit Agent" : "Create Agent"}</DialogTitle>
        <DialogDescription>
          {agent ? "Update" : "Create"} an AI agent configuration
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Agent Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Restaurant Agent"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="config">Configuration (JSON)</Label>
          <textarea
            id="config"
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            className="w-full min-h-[300px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            placeholder='{"greeting": "Hello!", "llm": "gpt-4"}'
            required
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {createMutation.isPending || updateMutation.isPending
              ? "Saving..."
              : agent
              ? "Update"
              : "Create"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

export default function AgentsPage() {
  const [editingAgent, setEditingAgent] = useState<AgentConfig | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.config.getAgents(),
  });

  const deleteMutation = useMutation({
    mutationFn: (agentId: string) => api.config.deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const handleEdit = (agent: AgentConfig) => {
    setEditingAgent(agent);
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingAgent(undefined);
    setDialogOpen(true);
  };

  const handleClose = () => {
    setDialogOpen(false);
    setEditingAgent(undefined);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">AI Agents</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">AI Agents</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Agent
            </Button>
          </DialogTrigger>
          {dialogOpen && (
            <AgentEditDialog agent={editingAgent} onClose={handleClose} />
          )}
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Bot className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Agents Yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Create your first AI agent to start handling calls.
              </p>
              <Button onClick={handleCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create Agent
              </Button>
            </CardContent>
          </Card>
        ) : (
          agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="h-5 w-5" />
                      {agent.name}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      Version {agent.version}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{agent.tenantId}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <div>
                      Created:{" "}
                      {new Date(agent.createdAt).toLocaleDateString()}
                    </div>
                    <div>
                      Updated:{" "}
                      {new Date(agent.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(agent)}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        if (
                          confirm(
                            `Are you sure you want to delete ${agent.name}?`
                          )
                        ) {
                          deleteMutation.mutate(agent.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}


"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Puzzle, CheckCircle, Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

type Integration = {
  id: string;
  name: string;
  description: string;
  icon: string;
  configured: boolean;
  fields: Array<{ name: string; label: string; type: string; required: boolean }>;
};

const integrations: Integration[] = [
  {
    id: "calendly",
    name: "Calendly",
    description: "Sync calendars and schedule appointments",
    icon: "📅",
    configured: false,
    fields: [
      { name: "apiKey", label: "API Key", type: "password", required: true },
      { name: "eventTypeUrl", label: "Event Type URL", type: "text", required: true },
    ],
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Access and manage Google Calendar events",
    icon: "📆",
    configured: false,
    fields: [
      { name: "clientId", label: "Client ID", type: "text", required: true },
      { name: "clientSecret", label: "Client Secret", type: "password", required: true },
      { name: "refreshToken", label: "Refresh Token", type: "password", required: true },
    ],
  },
  {
    id: "twilio",
    name: "Twilio",
    description: "Send SMS and manage phone communications",
    icon: "📱",
    configured: false,
    fields: [
      { name: "accountSid", label: "Account SID", type: "text", required: true },
      { name: "authToken", label: "Auth Token", type: "password", required: true },
      { name: "from", label: "From Number", type: "text", required: true },
    ],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Manage contacts and CRM data",
    icon: "🎯",
    configured: false,
    fields: [
      { name: "apiKey", label: "API Key", type: "password", required: true },
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Process payments and manage subscriptions",
    icon: "💳",
    configured: false,
    fields: [
      { name: "secretKey", label: "Secret Key", type: "password", required: true },
      { name: "publishableKey", label: "Publishable Key", type: "text", required: true },
    ],
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    description: "Send transactional emails",
    icon: "📧",
    configured: false,
    fields: [
      { name: "apiKey", label: "API Key", type: "password", required: true },
      { name: "fromEmail", label: "From Email", type: "email", required: true },
    ],
  },
];

function ConfigureDialog({
  integration,
  onClose,
}: {
  integration: Integration;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Record<string, string>>({});

  const saveMutation = useMutation({
    mutationFn: (data: { provider: string; credentials: Record<string, unknown> }) =>
      api.tools.saveCredentials(data.provider, data.credentials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      alert(`${integration.name} configured successfully!`);
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      provider: integration.id,
      credentials: formData,
    });
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          Configure {integration.name} {integration.icon}
        </DialogTitle>
        <DialogDescription>{integration.description}</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        {integration.fields.map((field) => (
          <div key={field.name} className="space-y-2">
            <Label htmlFor={field.name}>
              {field.label}
              {field.required && <span className="text-red-500">*</span>}
            </Label>
            <Input
              id={field.name}
              type={field.type}
              value={formData[field.name] || ""}
              onChange={(e) =>
                setFormData({ ...formData, [field.name]: e.target.value })
              }
              required={field.required}
            />
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Save Credentials"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

export default function IntegrationsPage() {
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleConfigure = (integration: Integration) => {
    setSelectedIntegration(integration);
    setDialogOpen(true);
  };

  const handleClose = () => {
    setDialogOpen(false);
    setSelectedIntegration(null);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Integrations</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => (
          <Card key={integration.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-4xl">{integration.icon}</div>
                  <div>
                    <CardTitle>{integration.name}</CardTitle>
                    {integration.configured && (
                      <Badge variant="default" className="mt-1">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Configured
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="mb-4">
                {integration.description}
              </CardDescription>
              <Dialog open={dialogOpen && selectedIntegration?.id === integration.id} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant={integration.configured ? "outline" : "default"}
                    size="sm"
                    className="w-full"
                    onClick={() => handleConfigure(integration)}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    {integration.configured ? "Reconfigure" : "Configure"}
                  </Button>
                </DialogTrigger>
                {dialogOpen && selectedIntegration?.id === integration.id && (
                  <ConfigureDialog
                    integration={integration}
                    onClose={handleClose}
                  />
                )}
              </Dialog>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>About Integrations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Integrations allow your AI agents to connect with external services and perform actions on your behalf.
          </p>
          <p>
            Configure each integration by providing the required credentials. These are securely stored and used only when your agent needs to interact with the service.
          </p>
          <p className="font-semibold text-foreground">
            Note: Credentials are encrypted and never exposed in logs or API responses.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


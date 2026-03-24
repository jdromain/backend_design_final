"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BookOpen, Upload, FileText, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatDistance } from "date-fns";

function UploadDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [namespace, setNamespace] = useState("general");
  const [text, setText] = useState("");
  const [metadata, setMetadata] = useState("");

  const uploadMutation = useMutation({
    mutationFn: (data: {
      namespace: string;
      text: string;
      metadata?: Record<string, unknown>;
    }) => api.kb.ingestDocument(data.namespace, data.text, data.metadata),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kb", "status"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let parsedMetadata: Record<string, unknown> | undefined;
    
    if (metadata.trim()) {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch {
        alert("Invalid JSON metadata");
        return;
      }
    }

    uploadMutation.mutate({ namespace, text, metadata: parsedMetadata });
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Upload Document</DialogTitle>
        <DialogDescription>
          Add a new document to the knowledge base
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="namespace">Namespace</Label>
          <Input
            id="namespace"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="general, menu, hours, etc."
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="text">Document Text</Label>
          <textarea
            id="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Enter the document content..."
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="metadata">Metadata (JSON, optional)</Label>
          <textarea
            id="metadata"
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            placeholder='{"source": "website", "category": "menu"}'
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

export default function KnowledgeBasePage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: documents = [], isLoading, error } = useQuery({
    queryKey: ["kb", "status"],
    queryFn: () => api.kb.getStatus(),
    refetchInterval: (query) => (query.state.error ? false : 10000),
    retry: 1,
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "embedded":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "processing":
      case "ingest_requested":
        return <Clock className="h-4 w-4 text-yellow-500 animate-spin" />;
      case "failed":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      embedded: "default",
      processing: "secondary",
      ingest_requested: "outline",
      failed: "destructive",
    };
    return variants[status] || "outline";
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Knowledge Base</h1>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Knowledge Base</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              Upload Document
            </Button>
          </DialogTrigger>
          {dialogOpen && <UploadDialog onClose={() => setDialogOpen(false)} />}
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documents ({documents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <BookOpen className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Documents Yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Upload documents to build your AI agent's knowledge base.
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Upload Document
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document ID</TableHead>
                  <TableHead>Namespace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Ingested</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.docId}>
                    <TableCell className="font-mono text-xs">
                      {doc.docId.substring(0, 8)}...
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{doc.namespace}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(doc.status)}
                        <Badge variant={getStatusBadge(doc.status)}>
                          {doc.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {doc.status === "embedded"
                        ? `${doc.embeddedChunks} chunks`
                        : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistance(new Date(doc.ingestedAt), new Date(), {
                        addSuffix: true,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


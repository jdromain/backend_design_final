"use client";

import { AgentsPage } from "@/components/pages/agents-page";
import { useAppNavigate } from "@/hooks/use-app-navigate";

export default function AgentsRoutePage() {
  const navigate = useAppNavigate();
  return (
    <AgentsPage onNavigateToAgent={(agentId) => navigate(`agent:${agentId}`)} />
  );
}

"use client";

import { use } from "react";
import { AgentDetailPage } from "@/components/pages/agent-detail-page";
import { useRouter } from "next/navigation";

export default function AgentDetailRoutePage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const router = useRouter();
  const { agentId } = use(params);
  return (
    <AgentDetailPage
      agentId={agentId}
      onBack={() => router.push("/agents")}
    />
  );
}

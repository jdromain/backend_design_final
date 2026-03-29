"use client";

import { AgentDetailPage } from "@/components/pages/agent-detail-page";
import { useRouter } from "next/navigation";

export default function AgentDetailRoutePage({
  params,
}: {
  params: { agentId: string };
}) {
  const router = useRouter();
  return (
    <AgentDetailPage
      agentId={params.agentId}
      onBack={() => router.push("/agents")}
    />
  );
}

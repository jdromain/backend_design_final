"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { HistoryPage } from "@/components/pages/history-page";

function HistoryWithParams() {
  const sp = useSearchParams();
  return (
    <HistoryPage
      initialFilter={sp.get("filter") ?? undefined}
      initialIntent={sp.get("intent") ?? undefined}
      initialReason={sp.get("reason") ?? undefined}
    />
  );
}

export default function HistoryRoutePage() {
  return (
    <Suspense fallback={null}>
      <HistoryWithParams />
    </Suspense>
  );
}

"use client";

import { AnalyticsPage } from "@/components/pages/analytics-page";
import { useAppNavigate } from "@/hooks/use-app-navigate";

export default function AnalyticsRoutePage() {
  const onNavigate = useAppNavigate();
  return <AnalyticsPage onNavigate={onNavigate} />;
}

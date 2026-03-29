"use client"

import { useState } from "react"
import { HelpHeader } from "@/components/help/help-header"
import { SearchHelpCenter, type Article } from "@/components/help/search-help-center"
import { PopularArticles } from "@/components/help/popular-articles"
import { SupportRequestsTable } from "@/components/help/support-requests-table"
import { SystemStatusCard } from "@/components/help/system-status-card"
import { QuickActionsCard } from "@/components/help/quick-actions-card"
import { DeveloperResources } from "@/components/help/developer-resources"
import { ContactSupportModal } from "@/components/help/contact-support-modal"
import { ReportBugModal } from "@/components/help/report-bug-modal"
import { DownloadDiagnosticsModal } from "@/components/help/download-diagnostics-modal"
import { ArticleDrawer } from "@/components/help/article-drawer"
import { SystemStatusModal } from "@/components/help/system-status-modal"
import { useToast } from "@/hooks/use-toast"

export function HelpPage() {
  const { toast } = useToast()
  /** Help center has no admin API yet; extra actions stay off until wired. */
  const [isAdmin] = useState(false)

  // Modal states
  const [contactSupportOpen, setContactSupportOpen] = useState(false)
  const [reportBugOpen, setReportBugOpen] = useState(false)
  const [downloadDiagnosticsOpen, setDownloadDiagnosticsOpen] = useState(false)
  const [systemStatusOpen, setSystemStatusOpen] = useState(false)

  // Drawer states
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  const [articleDrawerOpen, setArticleDrawerOpen] = useState(false)

  const handleArticleClick = (article: Article) => {
    setSelectedArticle(article)
    setArticleDrawerOpen(true)
  }

  const handleContactSupportSubmit = () => {
    toast({
      title: "Support request sent",
      description: "We'll get back to you within 24 hours.",
    })
  }

  const handleReportBugSubmit = () => {
    toast({
      title: "Bug report created",
      description: "Thank you for helping us improve Rezovo.",
    })
  }

  const handleRequestFeature = () => {
    toast({
      title: "Feature request noted",
      description: "We'll review your suggestion.",
    })
  }

  return (
    <div className="space-y-6">
      <HelpHeader
        onContactSupport={() => setContactSupportOpen(true)}
        onReportBug={() => setReportBugOpen(true)}
        onViewStatus={() => setSystemStatusOpen(true)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main content */}
        <div className="space-y-8">
          <SearchHelpCenter onArticleClick={handleArticleClick} />
          <PopularArticles onArticleClick={handleArticleClick} />
          <SupportRequestsTable onContactSupport={() => setContactSupportOpen(true)} />
        </div>

        {/* Utility rail */}
        <div className="space-y-4">
          <SystemStatusCard onViewDetails={() => setSystemStatusOpen(true)} />
          <QuickActionsCard
            isAdmin={isAdmin}
            onContactSupport={() => setContactSupportOpen(true)}
            onReportBug={() => setReportBugOpen(true)}
            onRequestFeature={handleRequestFeature}
            onDownloadDiagnostics={() => setDownloadDiagnosticsOpen(true)}
          />
          <DeveloperResources />
        </div>
      </div>

      {/* Modals */}
      <ContactSupportModal
        open={contactSupportOpen}
        onOpenChange={setContactSupportOpen}
        onSubmit={handleContactSupportSubmit}
        isAdmin={isAdmin}
      />
      <ReportBugModal open={reportBugOpen} onOpenChange={setReportBugOpen} onSubmit={handleReportBugSubmit} />
      <DownloadDiagnosticsModal open={downloadDiagnosticsOpen} onOpenChange={setDownloadDiagnosticsOpen} />
      <SystemStatusModal open={systemStatusOpen} onOpenChange={setSystemStatusOpen} />

      {/* Article drawer */}
      <ArticleDrawer article={selectedArticle} open={articleDrawerOpen} onOpenChange={setArticleDrawerOpen} />
    </div>
  )
}

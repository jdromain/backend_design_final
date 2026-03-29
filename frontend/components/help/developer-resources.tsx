"use client"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Github, MessageCircle, Users, FileText, ExternalLink } from "lucide-react"

const resources = [
  {
    icon: Github,
    title: "File GitHub issue",
    description: "For API issues and bug reports",
    link: "https://github.com/rezovo/issues",
  },
  {
    icon: MessageCircle,
    title: "Slack channel",
    description: "#frontend-backend-integration",
    link: "#",
  },
  {
    icon: Users,
    title: "Backend contacts",
    description: "API Lead: api-lead@rezovo.com | DevOps: devops@rezovo.com",
    link: "mailto:api-lead@rezovo.com",
  },
  {
    icon: FileText,
    title: "Documentation updates",
    description: "Submit a PR to update docs",
    link: "https://github.com/rezovo/docs",
  },
]

export function DeveloperResources() {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium">Developer Resources</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <Accordion type="single" collapsible>
          <AccordionItem value="resources" className="border-0">
            <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:no-underline">
              Platform & internal resources
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-2">
                {resources.map((resource) => {
                  const Icon = resource.icon
                  return (
                    <a
                      key={resource.title}
                      href={resource.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium group-hover:text-primary transition-colors">
                          {resource.title}
                          <ExternalLink className="h-3 w-3 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </p>
                        <p className="text-xs text-muted-foreground">{resource.description}</p>
                      </div>
                    </a>
                  )
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  )
}

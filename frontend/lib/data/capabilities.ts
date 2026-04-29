import { appendOrgQuery, get } from "@/lib/api-client"

export type UiCapabilities = {
  knowledge: {
    documentDelete: boolean
    documentUpdate: boolean
    reprocess: boolean
  }
  calls: {
    transcriptDownload: boolean
    recordingPlayback: boolean
    historyBulkMutations: boolean
  }
  integrations: {
    liveProbe: boolean
    logs: boolean
    disconnect: boolean
    configure: boolean
  }
}

const FALLBACK_CAPABILITIES: UiCapabilities = {
  knowledge: { documentDelete: true, documentUpdate: true, reprocess: false },
  calls: { transcriptDownload: false, recordingPlayback: false, historyBulkMutations: false },
  integrations: { liveProbe: false, logs: false, disconnect: false, configure: false },
}

export async function getUiCapabilities(): Promise<UiCapabilities> {
  try {
    return await get<UiCapabilities>(appendOrgQuery("/ui/capabilities"))
  } catch {
    return FALLBACK_CAPABILITIES
  }
}

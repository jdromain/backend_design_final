// Re-exports mock generators for the actions data layer.
// The generators live in lib/actions-store.tsx alongside the state they populate.
// This module acts as the mock data entry point for lib/data/actions.ts.
export {
  generateContacts,
  generateCalls,
  generateFollowUps,
  generateWorkflows,
  generateTemplates,
} from "@/lib/actions-store"

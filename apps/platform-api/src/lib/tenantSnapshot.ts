export function agentDisplayName(agent: { name?: string; id?: string }): string {
  return agent.name || agent.id || "Unknown Agent";
}

export function phoneLineLabel(phone: { displayName?: string; phoneNumber: string }): string {
  return phone.displayName || phone.phoneNumber;
}

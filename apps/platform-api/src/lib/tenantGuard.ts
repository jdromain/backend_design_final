import { FastifyRequest, FastifyReply } from "fastify";
import { sendError } from "./responses";

export function assertSameTenant(
  request: FastifyRequest,
  reply: FastifyReply,
  resourceTenantId: string
): boolean {
  const auth = request.auth;
  if (!auth || auth.tenant_id !== resourceTenantId) {
    sendError(reply, 403, "tenant_mismatch", "Access denied for this tenant");
    return false;
  }
  return true;
}

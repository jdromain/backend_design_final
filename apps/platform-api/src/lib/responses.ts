import { FastifyReply } from "fastify";

export function sendData<T>(reply: FastifyReply, data: T, status = 200): void {
  reply.status(status).send({ data });
}

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId?: string
): void {
  reply.status(status).send({ error: { code, message, requestId } });
}

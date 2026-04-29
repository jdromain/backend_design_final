import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolvedAuthHook } from "../auth/jwt";
import { sendData } from "../lib/responses";

type UiCapabilities = {
  knowledge: {
    documentDelete: boolean;
    documentUpdate: boolean;
    reprocess: boolean;
  };
  calls: {
    transcriptDownload: boolean;
    recordingPlayback: boolean;
    historyBulkMutations: boolean;
  };
  integrations: {
    liveProbe: boolean;
    logs: boolean;
    disconnect: boolean;
    configure: boolean;
  };
};

const DEFAULT_CAPABILITIES: UiCapabilities = {
  knowledge: {
    documentDelete: true,
    documentUpdate: true,
    reprocess: false,
  },
  calls: {
    transcriptDownload: false,
    recordingPlayback: false,
    historyBulkMutations: true,
  },
  integrations: {
    liveProbe: true,
    logs: true,
    disconnect: true,
    configure: true,
  },
};

export function registerUiCapabilitiesRoutes(app: FastifyInstance) {
  app.get(
    "/ui/capabilities",
    { preHandler: resolvedAuthHook(["admin", "editor", "viewer"]) },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      sendData(reply, DEFAULT_CAPABILITIES);
    },
  );
}

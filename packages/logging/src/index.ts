type LogLevel = "debug" | "info" | "warn" | "error";

type LoggerContext = {
  service: string;
  module?: string;
  tenantId?: string;
  callId?: string;
};

type LogPayload = Record<string, unknown> | undefined;

function formatMessage(level: LogLevel, message: string, context: LoggerContext, payload?: LogPayload): string {
  const base = {
    level,
    service: context.service,
    module: context.module,
    tenant_id: context.tenantId,
    call_id: context.callId,
    message,
    ...payload
  };

  return JSON.stringify(base);
}

export function createLogger(context: LoggerContext) {
  return {
    debug(message: string, payload?: LogPayload): void {
      console.debug(formatMessage("debug", message, context, payload));
    },
    info(message: string, payload?: LogPayload): void {
      console.info(formatMessage("info", message, context, payload));
    },
    warn(message: string, payload?: LogPayload): void {
      console.warn(formatMessage("warn", message, context, payload));
    },
    error(message: string, payload?: LogPayload): void {
      console.error(formatMessage("error", message, context, payload));
    }
  };
}


import { describe, it, expect } from "vitest";
import { mapTwilioTerminalStatus } from "./twilio";

describe("mapTwilioTerminalStatus", () => {
  it("maps completed -> handled/completed", () => {
    const mapped = mapTwilioTerminalStatus("completed", {});
    expect(mapped).toEqual({
      status: "completed",
      outcome: "handled",
      endReason: "caller_hangup",
    });
  });

  it("maps busy -> failed/error with failure type", () => {
    const mapped = mapTwilioTerminalStatus("busy", {});
    expect(mapped?.status).toBe("failed");
    expect(mapped?.outcome).toBe("failed");
    expect(mapped?.endReason).toBe("error");
    expect(mapped?.failureType).toBe("busy");
  });

  it("maps no-answer -> failed/timeout with failure type", () => {
    const mapped = mapTwilioTerminalStatus("no-answer", {});
    expect(mapped?.status).toBe("failed");
    expect(mapped?.outcome).toBe("failed");
    expect(mapped?.endReason).toBe("timeout");
    expect(mapped?.failureType).toBe("no-answer");
  });

  it("maps failed -> failed/error and carries carrier detail", () => {
    const mapped = mapTwilioTerminalStatus("failed", { ErrorMessage: "SIP 503", ErrorCode: "503" });
    expect(mapped?.status).toBe("failed");
    expect(mapped?.outcome).toBe("failed");
    expect(mapped?.endReason).toBe("error");
    expect(mapped?.failureType).toBe("SIP 503");
  });

  it("maps canceled -> abandoned/caller_hangup", () => {
    const mapped = mapTwilioTerminalStatus("canceled", {});
    expect(mapped?.status).toBe("abandoned");
    expect(mapped?.outcome).toBe("abandoned");
    expect(mapped?.endReason).toBe("caller_hangup");
    expect(mapped?.failureType).toBe("canceled");
  });
});

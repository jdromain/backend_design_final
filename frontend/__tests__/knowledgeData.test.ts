import { describe, it, expect } from "vitest";
import { mapRowToKbDocument, type KbDocumentApiRow } from "@/lib/data/knowledge";

const baseRow = (): KbDocumentApiRow => ({
  id: "d1",
  namespace: "ns",
  name: "t.txt",
  type: "txt",
  sizeBytes: 10,
  status: "failed",
  chunks: 0,
  ingestedAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
});

describe("mapRowToKbDocument", () => {
  it("sets errorMessage from errorMessage or last_error", () => {
    const a = mapRowToKbDocument({
      ...baseRow(),
      errorMessage: "Embedding rate limited",
    });
    expect(a.errorMessage).toBe("Embedding rate limited");
    const b = mapRowToKbDocument({
      ...baseRow(),
      last_error: "  timeout  ",
    });
    expect(b.errorMessage).toBe("timeout");
  });

  it("omits errorMessage when no API error is present", () => {
    const d = mapRowToKbDocument({ ...baseRow() });
    expect(d.errorMessage).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PersistenceStore } from "./store";
import { query } from "./dbClient";

vi.mock("./dbClient", () => ({
  query: vi.fn(),
}));

describe("PersistenceStore.appendDocument", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it("rethrows db errors so callers fail fast", async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error("db insert failed"));
    const store = new PersistenceStore();

    await expect(
      store.appendDocument({
        orgId: "org-1",
        businessId: "biz-1",
        namespace: "general",
        docId: "doc-1",
        text: "hello world",
        metadata: { source: "unit-test" },
        ingestedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("db insert failed");
  });
});

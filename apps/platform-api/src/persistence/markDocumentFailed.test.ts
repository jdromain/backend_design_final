import { describe, it, expect, vi, beforeEach } from "vitest";
import { PersistenceStore } from "./store";
import { query } from "./dbClient";

vi.mock("./dbClient", () => ({
  query: vi.fn(),
}));

describe("PersistenceStore.markDocumentFailed", () => {
  beforeEach(() => {
    vi.mocked(query).mockClear();
    vi.mocked(query).mockResolvedValue({ rowCount: 1 } as never);
  });

  it("sets status, last_error, and uses bounded message", async () => {
    const store = new PersistenceStore();
    await store.markDocumentFailed("org-1", "doc-1", "OpenAI 429: rate limit");

    expect(query).toHaveBeenCalled();
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    const args = vi.mocked(query).mock.calls[0][1] as unknown[];
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain("last_error");
    expect(sql).toContain("updated_at = now()");
    expect(args[0]).toBe("org-1");
    expect(args[1]).toBe("doc-1");
    expect(args[2]).toBe("OpenAI 429: rate limit");
  });

  it("uses fallback when message is empty", async () => {
    const store = new PersistenceStore();
    await store.markDocumentFailed("org-1", "doc-1", "   ");
    const args = vi.mocked(query).mock.calls[0][1] as unknown[];
    expect(args[2]).toBe("unknown error");
  });
});

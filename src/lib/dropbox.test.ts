import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withDropboxRetry, DropboxApiError, listSharedLinkFolder } from "./dropbox";

const noSleep = () => Promise.resolve();

describe("withDropboxRetry", () => {
  it("retries 429 then succeeds", async () => {
    let calls = 0;
    const result = await withDropboxRetry(
      async () => {
        calls++;
        if (calls < 3) throw new DropboxApiError(429, "too_many_requests/..", 0);
        return "ok";
      },
      { sleep: noSleep }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("honours Retry-After from a 429", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await withDropboxRetry(
      async () => {
        calls++;
        if (calls === 1) throw new DropboxApiError(429, "too_many_requests/..", 7);
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms) }
    );
    expect(sleeps[0]).toBeGreaterThanOrEqual(7000);
  });

  it("retries 5xx", async () => {
    let calls = 0;
    await withDropboxRetry(
      async () => {
        calls++;
        if (calls === 1) throw new DropboxApiError(503, "", 0);
        return "ok";
      },
      { sleep: noSleep }
    );
    expect(calls).toBe(2);
  });

  it("does not retry 409 (link errors) and rethrows after max retries", async () => {
    let calls = 0;
    await expect(
      withDropboxRetry(
        async () => {
          calls++;
          throw new DropboxApiError(409, "shared_link_not_found/", 0);
        },
        { sleep: noSleep }
      )
    ).rejects.toThrow(DropboxApiError);
    expect(calls).toBe(1);

    await expect(
      withDropboxRetry(
        async () => {
          throw new DropboxApiError(429, "", 0);
        },
        { retries: 2, sleep: noSleep }
      )
    ).rejects.toThrow();
  });
});

describe("listSharedLinkFolder", () => {
  const LINK = "https://www.dropbox.com/scl/fo/abc/AAB?rlkey=k";

  beforeEach(() => {
    process.env.DROPBOX_APP_KEY = "k";
    process.env.DROPBOX_APP_SECRET = "s";
    process.env.DROPBOX_REFRESH_TOKEN = "r";
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(pages: object[]) {
    let page = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes("oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "t", expires_in: 14400 }));
        }
        return new Response(JSON.stringify(pages[page++]));
      })
    );
  }

  it("maps entries to DriveFolderChildren with relative-path ids, following pagination", async () => {
    stubFetch([
      {
        entries: [
          { ".tag": "folder", name: "Day 1" },
          { ".tag": "file", name: "a.mp4", size: 5 },
        ],
        has_more: true,
        cursor: "c1",
      },
      {
        entries: [{ ".tag": "file", name: "b.mov", size: 9 }],
        has_more: false,
      },
    ]);
    const r = await listSharedLinkFolder(LINK, "");
    expect(r.folders).toEqual([{ id: "/Day 1", name: "Day 1" }]);
    expect(r.files).toContainEqual({
      id: "/a.mp4", name: "a.mp4", mimeType: "application/octet-stream", size: 5,
    });
    expect(r.files).toContainEqual({
      id: "/b.mov", name: "b.mov", mimeType: "application/octet-stream", size: 9,
    });
  });

  it("prefixes subfolder paths", async () => {
    stubFetch([
      { entries: [{ ".tag": "file", name: "c.mp4", size: 1 }], has_more: false },
    ]);
    const r = await listSharedLinkFolder(LINK, "/Day 1");
    expect(r.files[0].id).toBe("/Day 1/c.mp4");
  });
});

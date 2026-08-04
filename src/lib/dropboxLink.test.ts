import { describe, it, expect } from "vitest";
import { parseDropboxLink } from "./dropboxLink";

describe("parseDropboxLink", () => {
  it("parses a modern shared folder link and strips dl/st", () => {
    const r = parseDropboxLink(
      "https://www.dropbox.com/scl/fo/abc123xyz/AABBcc?rlkey=k9m2&st=xyz&dl=0"
    );
    expect(r).toEqual({
      url: "https://www.dropbox.com/scl/fo/abc123xyz/AABBcc?rlkey=k9m2",
      kind: "folder",
    });
  });

  it("parses a modern shared file link", () => {
    const r = parseDropboxLink("https://www.dropbox.com/scl/fi/def456/clip.mp4?rlkey=r1&dl=1");
    expect(r).toEqual({
      url: "https://www.dropbox.com/scl/fi/def456/clip.mp4?rlkey=r1",
      kind: "file",
    });
  });

  it("parses legacy /sh/ folder and /s/ file links", () => {
    expect(parseDropboxLink("https://www.dropbox.com/sh/abc/AACkey?dl=0")?.kind).toBe("folder");
    expect(parseDropboxLink("https://www.dropbox.com/s/abc/file.mov")?.kind).toBe("file");
  });

  it("accepts bare dropbox.com host and forces https", () => {
    const r = parseDropboxLink("http://dropbox.com/scl/fo/abc/AAB?rlkey=k");
    expect(r?.url).toBe("https://dropbox.com/scl/fo/abc/AAB?rlkey=k");
  });

  it("rejects non-Dropbox and garbage input", () => {
    expect(parseDropboxLink("https://drive.google.com/drive/folders/abc123def456")).toBeNull();
    expect(parseDropboxLink("not a url")).toBeNull();
    expect(parseDropboxLink("")).toBeNull();
    expect(parseDropboxLink("https://evil.com/scl/fo/abc")).toBeNull();
  });
});

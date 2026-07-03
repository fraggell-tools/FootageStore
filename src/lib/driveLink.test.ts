import { describe, it, expect } from "vitest";
import { parseDriveFolderLink } from "./driveLink";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz12345";

describe("parseDriveFolderLink", () => {
  it("parses a standard folders URL", () => {
    expect(parseDriveFolderLink(`https://drive.google.com/drive/folders/${ID}`)).toBe(ID);
  });

  it("parses a folders URL with ?usp=sharing", () => {
    expect(parseDriveFolderLink(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toBe(ID);
  });

  it("parses a user-scoped URL (/drive/u/0/folders/...)", () => {
    expect(parseDriveFolderLink(`https://drive.google.com/drive/u/0/folders/${ID}`)).toBe(ID);
  });

  it("parses an open?id= URL", () => {
    expect(parseDriveFolderLink(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
  });

  it("accepts a raw folder ID", () => {
    expect(parseDriveFolderLink(ID)).toBe(ID);
  });

  it("trims surrounding whitespace", () => {
    expect(parseDriveFolderLink(`  https://drive.google.com/drive/folders/${ID}  `)).toBe(ID);
  });

  it("rejects non-Google URLs", () => {
    expect(parseDriveFolderLink(`https://evil.com/drive/folders/${ID}`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseDriveFolderLink("not a link")).toBeNull();
    expect(parseDriveFolderLink("")).toBeNull();
    expect(parseDriveFolderLink("https://drive.google.com/drive/my-drive")).toBeNull();
  });
});

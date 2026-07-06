import { describe, it, expect } from "vitest";
import { isVideoFile } from "./isVideoFile";

describe("isVideoFile", () => {
  it("accepts files with a video mime type", () => {
    expect(isVideoFile("clip.mp4", "video/mp4")).toBe(true);
    expect(isVideoFile("clip.mov", "video/quicktime")).toBe(true);
    expect(isVideoFile("weird-name-no-ext", "video/x-matroska")).toBe(true);
  });

  it("rejects images, audio, docs and other non-video types", () => {
    expect(isVideoFile("photo.jpg", "image/jpeg")).toBe(false);
    expect(isVideoFile("still.heic", "image/heif")).toBe(false);
    expect(isVideoFile("vo.mp3", "audio/mpeg")).toBe(false);
    expect(isVideoFile("vo.m4a", "audio/x-m4a")).toBe(false);
    expect(isVideoFile("script", "application/vnd.google-apps.document")).toBe(false);
    expect(isVideoFile("link", "application/vnd.google-apps.shortcut")).toBe(false);
    expect(isVideoFile("notes.txt", "text/plain")).toBe(false);
  });

  it("falls back to the extension when Drive reports a generic mime type", () => {
    expect(isVideoFile("raw.braw", "application/octet-stream")).toBe(true);
    expect(isVideoFile("red.R3D", "application/octet-stream")).toBe(true);
    expect(isVideoFile("Shot 9a.MOV", "")).toBe(true);
    expect(isVideoFile("doc.pdf", "application/octet-stream")).toBe(false);
    expect(isVideoFile("CTA A alt", "application/octet-stream")).toBe(false);
  });

  it("does not let a video extension override a known non-video mime type", () => {
    expect(isVideoFile("fake.mp4", "image/jpeg")).toBe(false);
  });
});

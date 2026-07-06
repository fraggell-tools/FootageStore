/**
 * Policy for what the sync ingests as a clip: video files only.
 * Drive sometimes reports camera formats (BRAW, R3D, MXF…) as generic
 * binary, so a known video extension counts when the mime type is
 * missing or generic — but a concrete non-video mime type always wins.
 */
const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "m4v", "avi", "mkv", "webm", "mpg", "mpeg", "wmv",
  "flv", "3gp", "mts", "m2ts", "mxf", "r3d", "braw", "crm", "qt",
]);

const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export function isVideoFile(name: string, mimeType: string): boolean {
  if (mimeType.startsWith("video/")) return true;
  if (!GENERIC_MIMES.has(mimeType)) return false;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return VIDEO_EXTENSIONS.has(ext);
}

import { google, drive_v3 } from "googleapis";
import { Readable } from "stream";

let driveClient: drive_v3.Drive | null = null;

function getDrive(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google OAuth env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN"
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  driveClient = google.drive({ version: "v3", auth: oauth2Client });
  return driveClient;
}

function getParentFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_PARENT_FOLDER_ID env var is not set");
  return id;
}

/**
 * Create a folder inside the parent "Footage Storage" folder.
 * Returns the Google Drive folder ID.
 */
export async function createClientFolder(clientName: string): Promise<string> {
  const drive = getDrive();
  const parentId = getParentFolderId();

  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: clientName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  return res.data.id!;
}

/**
 * Rename a client folder in Google Drive.
 */
export async function renameClientFolder(folderId: string, newName: string): Promise<void> {
  const drive = getDrive();
  await drive.files.update({
    fileId: folderId,
    supportsAllDrives: true,
    requestBody: { name: newName },
  });
}

/**
 * Delete a client folder (and all contents) from Google Drive.
 */
export async function deleteClientFolder(folderId: string): Promise<void> {
  const drive = getDrive();
  await drive.files.delete({
    fileId: folderId,
    supportsAllDrives: true,
  });
}

/**
 * Get a fresh access token for client-side Drive uploads.
 */
export async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN!;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { token } = await oauth2Client.getAccessToken();
  if (!token) throw new Error("Failed to get access token");
  return token;
}

/**
 * Create a resumable upload session on Google Drive.
 * Returns the resumable upload URL that the browser can PUT data to.
 */
export async function getUploadUrl(
  folderId: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const accessToken = await getAccessToken();

  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create resumable upload: ${res.status} ${text}`);
  }

  const uploadUrl = res.headers.get("location");
  if (!uploadUrl) throw new Error("No upload URL in response");

  return uploadUrl;
}

/**
 * Upload a file to a client's folder in Google Drive.
 * Returns the Google Drive file ID.
 */
export async function uploadFileToDrive(
  folderId: string,
  fileName: string,
  mimeType: string,
  fileStream: Readable
): Promise<string> {
  const drive = getDrive();

  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: fileStream,
    },
    fields: "id",
  });

  return res.data.id!;
}

/**
 * Delete a file from Google Drive.
 */
export async function deleteFileFromDrive(fileId: string): Promise<void> {
  const drive = getDrive();
  await drive.files.delete({
    fileId,
    supportsAllDrives: true,
  });
}

/**
 * Get a readable stream of a file from Google Drive.
 */
export async function downloadFileFromDrive(
  fileId: string
): Promise<Readable> {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  return res.data as unknown as Readable;
}

/**
 * Get file metadata (size) from Google Drive.
 */
export async function getDriveFileSize(fileId: string): Promise<number> {
  const drive = getDrive();
  const res = await drive.files.get({
    fileId,
    supportsAllDrives: true,
    fields: "size",
  });
  return parseInt(res.data.size || "0", 10);
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
}

/**
 * List all subfolders inside the parent "Footage Storage" folder.
 */
export async function listClientFolders(): Promise<DriveFile[]> {
  const drive = getDrive();
  const parentId = getParentFolderId();

  const folders: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, createdTime)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken,
    });

    for (const f of res.data.files || []) {
      folders.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        size: 0,
        createdTime: f.createdTime!,
      });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return folders;
}

/**
 * List all video files inside a specific folder.
 */
export async function listFilesInFolder(folderId: string): Promise<DriveFile[]> {
  const drive = getDrive();
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType contains 'video/' or mimeType = 'application/octet-stream')`,
      fields: "nextPageToken, files(id, name, mimeType, size, createdTime)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken,
    });

    for (const f of res.data.files || []) {
      files.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        size: parseInt(f.size || "0", 10),
        createdTime: f.createdTime!,
      });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

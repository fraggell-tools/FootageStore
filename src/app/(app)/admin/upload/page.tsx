"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Client {
  id: string;
  name: string;
  slug: string;
}

interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "complete" | "error";
  error?: string;
}

export default function UploadPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);

  // Inline "new folder" (creates a top-level folder on the shared drive and
  // registers it, then selects it as the upload destination).
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState("");

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    setFolderError("");
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create folder");
      // Add to the list, select it, and reset the input.
      setClients((prev) =>
        [...prev, { id: data.id, name: data.name, slug: data.slug }].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      setSelectedClientId(data.id);
      setNewFolderName("");
      setShowNewFolder(false);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Could not create folder");
    } finally {
      setCreatingFolder(false);
    }
  }, [newFolderName, creatingFolder]);

  // "Sync from Drive" — pull in folders created directly in Google Drive without
  // waiting for the worker's ~3-minute cycle.
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const syncFromDrive = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await fetch("/api/clients/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      const listRes = await fetch("/api/clients");
      const listData = await listRes.json();
      setClients(Array.isArray(listData) ? listData : listData.clients || []);
      const n = data.clientsCreated || 0;
      setSyncMsg(n > 0 ? `Found ${n} new folder${n === 1 ? "" : "s"} from Drive.` : "Up to date — no new folders.");
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.clients || [];
        setClients(list);
        if (list.length > 0 && !selectedClientId) {
          setSelectedClientId(list[0].id);
        }
      });
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const validExtensions = [".mp4", ".mov", ".mkv"];
    const newItems: UploadItem[] = Array.from(files)
      .filter((f) =>
        validExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
      )
      .map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
        status: "pending" as const,
      }));

    if (newItems.length > 0) {
      setQueue((prev) => [...prev, ...newItems]);
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (uploading.current || !selectedClientId) return;
    uploading.current = true;

    setQueue((prev) => {
      const nextPending = prev.find((item) => item.status === "pending");
      if (!nextPending) {
        uploading.current = false;
        return prev;
      }

      const upload = async (item: UploadItem) => {
        setQueue((q) =>
          q.map((i) => (i.id === item.id ? { ...i, status: "uploading" } : i))
        );

        try {
          // Step 1: Get a resumable upload URL from our server
          const initRes = await fetch("/api/upload/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: selectedClientId,
              fileName: item.file.name,
              mimeType: item.file.type || "video/mp4",
            }),
          });

          if (!initRes.ok) {
            const err = await initRes.json();
            throw new Error(err.error || "Failed to initialize upload");
          }

          const { uploadUrl } = await initRes.json();

          // Step 2: Upload directly to Google Drive with progress
          const driveFileId = await uploadToDrive(uploadUrl, item.file, (pct) => {
            setQueue((q) =>
              q.map((i) => (i.id === item.id ? { ...i, progress: pct } : i))
            );
          });

          // Step 3: Tell our server the upload is complete
          const completeRes = await fetch("/api/upload/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: selectedClientId,
              driveFileId,
              fileName: item.file.name,
              fileSize: item.file.size,
              mimeType: item.file.type || "video/mp4",
            }),
          });

          if (!completeRes.ok) {
            throw new Error("Failed to register clip");
          }

          setQueue((q) =>
            q.map((i) =>
              i.id === item.id
                ? { ...i, progress: 100, status: "complete" }
                : i
            )
          );
        } catch (err) {
          setQueue((q) =>
            q.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    status: "error",
                    error: err instanceof Error ? err.message : "Upload failed",
                  }
                : i
            )
          );
        }

        uploading.current = false;
        processQueue();
      };

      upload(nextPending);
      return prev;
    });
  }, [selectedClientId]);

  useEffect(() => {
    if (queue.some((item) => item.status === "pending") && !uploading.current) {
      processQueue();
    }
  }, [queue, processQueue]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const removeItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const clearCompleted = () => {
    setQueue((prev) => prev.filter((item) => item.status !== "complete"));
  };

  const completedCount = queue.filter((i) => i.status === "complete").length;

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Upload</h1>
        <p className="text-muted text-sm mt-1">Upload video footage for a client</p>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-neutral-300 mb-2">
          Client / folder
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-fg focus:outline-none focus:border-accent w-full max-w-sm appearance-none"
          >
            <option value="" disabled>
              Select a client...
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          {!showNewFolder && (
            <button
              type="button"
              onClick={() => { setShowNewFolder(true); setFolderError(""); }}
              className="text-sm text-accent hover:text-accent-hover border border-border rounded-lg px-3 py-2.5 whitespace-nowrap"
            >
              + New folder
            </button>
          )}
          <button
            type="button"
            onClick={syncFromDrive}
            disabled={syncing}
            title="Pull in folders created directly in Google Drive"
            className="text-sm text-muted hover:text-fg border border-border rounded-lg px-3 py-2.5 whitespace-nowrap disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "↺ Sync from Drive"}
          </button>
        </div>
        {syncMsg && <p className="text-muted text-xs mt-2">{syncMsg}</p>}

        {showNewFolder && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createFolder();
                if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); setFolderError(""); }
              }}
              placeholder="New folder name"
              className="bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-fg focus:outline-none focus:border-accent w-full max-w-xs"
            />
            <button
              type="button"
              onClick={createFolder}
              disabled={creatingFolder || !newFolderName.trim()}
              className="text-sm bg-accent text-white rounded-lg px-3 py-2.5 disabled:opacity-50 whitespace-nowrap"
            >
              {creatingFolder ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setShowNewFolder(false); setNewFolderName(""); setFolderError(""); }}
              className="text-sm text-muted hover:text-fg px-2 py-2.5"
            >
              Cancel
            </button>
          </div>
        )}
        {folderError && <p className="text-red-400 text-xs mt-2">{folderError}</p>}
        <p className="text-muted text-xs mt-2">
          Creating a folder makes a new top-level folder on the shared drive; footage you upload lands there.
        </p>
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
          isDragging
            ? "border-accent bg-accent/5"
            : "border-border hover:border-accent/50 hover:bg-surface"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".mp4,.mov,.mkv"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <svg
          className={`w-12 h-12 mx-auto mb-4 ${isDragging ? "text-accent" : "text-muted"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        <p className="text-white font-medium mb-1">
          Drop video files here or click to browse
        </p>
        <p className="text-muted text-sm">MP4, MOV, MKV — uploads directly to Google Drive</p>
      </div>

      {queue.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-neutral-300">
              Upload Queue ({queue.length} file{queue.length !== 1 ? "s" : ""})
            </h2>
            {completedCount > 0 && (
              <button
                onClick={clearCompleted}
                className="text-xs text-muted hover:text-white transition-colors"
              >
                Clear completed
              </button>
            )}
          </div>

          <div className="space-y-2">
            {queue.map((item) => (
              <div
                key={item.id}
                className="bg-surface border border-border rounded-lg px-4 py-3 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{item.file.name}</p>
                  <p className="text-xs text-muted">
                    {(item.file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>

                <div className="w-48 shrink-0">
                  {item.status === "uploading" && (
                    <div className="w-full bg-border rounded-full h-1.5">
                      <div
                        className="bg-accent h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                  {item.status === "pending" && (
                    <span className="text-xs text-muted">Waiting...</span>
                  )}
                  {item.status === "complete" && (
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Complete
                    </span>
                  )}
                  {item.status === "error" && (
                    <span className="text-xs text-red-400">{item.error}</span>
                  )}
                </div>

                {item.status === "uploading" && (
                  <span className="text-xs text-muted w-10 text-right">
                    {item.progress}%
                  </span>
                )}

                {(item.status === "pending" || item.status === "error") && (
                  <button
                    onClick={() => removeItem(item.id)}
                    className="text-muted hover:text-white transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Upload a file directly to Google Drive using a resumable upload URL.
 * Returns the Drive file ID.
 */
async function uploadToDrive(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response.id);
        } catch {
          reject(new Error("Failed to parse Drive response"));
        }
      } else {
        reject(new Error(`Drive upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

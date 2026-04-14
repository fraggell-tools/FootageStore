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
          const formData = new FormData();
          formData.append("file", item.file);
          formData.append("clientId", selectedClientId);

          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/upload");

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setQueue((q) =>
                q.map((i) => (i.id === item.id ? { ...i, progress: pct } : i))
              );
            }
          };

          await new Promise<void>((resolve, reject) => {
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                setQueue((q) =>
                  q.map((i) =>
                    i.id === item.id
                      ? { ...i, progress: 100, status: "complete" }
                      : i
                  )
                );
                resolve();
              } else {
                reject(new Error(`Upload failed: ${xhr.status}`));
              }
            };
            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send(formData);
          });
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
          Client
        </label>
        <select
          value={selectedClientId}
          onChange={(e) => setSelectedClientId(e.target.value)}
          className="bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent w-full max-w-sm appearance-none"
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
        <p className="text-muted text-sm">MP4, MOV, MKV</p>
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

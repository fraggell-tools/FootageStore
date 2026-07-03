"use client";

import { useEffect, useRef, useState } from "react";

interface BrowseFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}
interface BrowseFolder {
  id: string;
  name: string;
}
interface TreeNode extends BrowseFolder {
  loaded: boolean;
  expanded: boolean;
  folders: TreeNode[];
  files: BrowseFile[];
}
interface ClientOption {
  id: string;
  name: string;
}
interface ImportStatus {
  id: string;
  status: "pending" | "running" | "completed" | "completed_with_errors" | "error";
  totalFiles: number;
  copiedFiles: number;
  skippedFiles: number;
  errors: { fileName: string; path: string; message: string }[] | null;
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

async function browse(body: { link?: string; folderId?: string }) {
  const res = await fetch("/api/admin/import/browse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Browse failed");
  return data as { folder: BrowseFolder; folders: BrowseFolder[]; files: BrowseFile[] };
}

export default function ImportPage() {
  const [link, setLink] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data: ClientOption[]) => setClients(data))
      .catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim() || resolving) return;
    setResolving(true);
    setResolveError(null);
    setRoot(null);
    setChecked(new Set());
    setImportStatus(null);
    try {
      const data = await browse({ link: link.trim() });
      setRoot({
        ...data.folder,
        loaded: true,
        expanded: true,
        folders: data.folders.map((f) => ({ ...f, loaded: false, expanded: false, folders: [], files: [] })),
        files: data.files,
      });
    } catch (err) {
      setResolveError((err as Error).message);
    } finally {
      setResolving(false);
    }
  }

  async function toggleExpand(node: TreeNode) {
    if (!node.loaded) {
      try {
        const data = await browse({ folderId: node.id });
        node.folders = data.folders.map((f) => ({ ...f, loaded: false, expanded: false, folders: [], files: [] }));
        node.files = data.files;
        node.loaded = true;
      } catch {
        return; // leave collapsed; user can retry
      }
    }
    node.expanded = !node.expanded;
    setRoot((r) => (r ? { ...r } : r));
  }

  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Collect top-level checked folders/files (nothing under a checked ancestor). */
  function collectSelection(node: TreeNode): {
    folders: BrowseFolder[];
    files: { id: string; name: string }[];
  } {
    const folders: BrowseFolder[] = [];
    const files: { id: string; name: string }[] = [];
    function walk(n: TreeNode) {
      if (checked.has(n.id)) {
        folders.push({ id: n.id, name: n.name });
        return; // whole subtree included — don't descend
      }
      for (const f of n.files) if (checked.has(f.id)) files.push({ id: f.id, name: f.name });
      for (const sub of n.folders) walk(sub);
    }
    walk(node);
    return { folders, files };
  }

  async function handleCreateClient() {
    if (!newClientName.trim() || creatingClient) return;
    setCreatingClient(true);
    setStartError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newClientName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create client");
      setClients((c) => [...c, { id: data.id, name: data.name }].sort((a, b) => a.name.localeCompare(b.name)));
      setClientId(data.id);
      setNewClientName("");
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setCreatingClient(false);
    }
  }

  function startPolling(importId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/import/${importId}`);
        if (!res.ok) return;
        const data: ImportStatus = await res.json();
        setImportStatus(data);
        if (data.status !== "pending" && data.status !== "running" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // transient poll failure — keep polling
      }
    }, 2000);
  }

  async function handleStart() {
    if (!root || !clientId || starting) return;
    const selection = collectSelection(root);
    if (selection.folders.length === 0 && selection.files.length === 0) {
      setStartError("Select at least one folder or file");
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          sourceFolderId: root.id,
          sourceFolderName: root.name,
          selection,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start import");
      setImportStatus({
        id: data.id,
        status: "pending",
        totalFiles: 0,
        copiedFiles: 0,
        skippedFiles: 0,
        errors: null,
      });
      startPolling(data.id);
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  function renderFolder(node: TreeNode, depth: number, ancestorChecked: boolean) {
    const isChecked = ancestorChecked || checked.has(node.id);
    return (
      <div key={node.id}>
        <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 20 }}>
          <input
            type="checkbox"
            checked={isChecked}
            disabled={ancestorChecked}
            onChange={() => toggleChecked(node.id)}
            className="accent-[#C60D60]"
            aria-label={`Select folder ${node.name}`}
          />
          <button
            type="button"
            onClick={() => toggleExpand(node)}
            className="flex items-center gap-1.5 text-sm text-neutral-200 hover:text-white"
          >
            <span className="text-xs text-neutral-500">{node.expanded ? "▾" : "▸"}</span>
            <span>📁 {node.name}</span>
          </button>
        </div>
        {node.expanded && (
          <>
            {node.folders.map((sub) => renderFolder(sub, depth + 1, isChecked))}
            {node.files.map((file) => {
              const fileChecked = isChecked || checked.has(file.id);
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-2 py-0.5"
                  style={{ paddingLeft: (depth + 1) * 20 }}
                >
                  <input
                    type="checkbox"
                    checked={fileChecked}
                    disabled={isChecked}
                    onChange={() => toggleChecked(file.id)}
                    className="accent-[#C60D60]"
                    aria-label={`Select file ${file.name}`}
                  />
                  <span className="text-sm text-neutral-400 truncate">
                    🎬 {file.name}
                    <span className="ml-2 text-xs text-neutral-600">{formatBytes(file.size)}</span>
                  </span>
                </div>
              );
            })}
            {node.loaded && node.folders.length === 0 && node.files.length === 0 && (
              <p className="text-xs text-neutral-600" style={{ paddingLeft: (depth + 1) * 20 }}>
                empty
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  const running = importStatus && (importStatus.status === "pending" || importStatus.status === "running");

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Import from Drive</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Paste a link to an external Google Drive folder that&apos;s been shared with us. Select what
          to import and it will be copied into a client folder, then ingested automatically.
        </p>
      </div>

      <form onSubmit={handleResolve} className="flex gap-2 mb-4">
        <input
          type="text"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
          className="flex-1 bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={resolving || !link.trim()}
          className="px-5 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "#C60D60" }}
        >
          {resolving ? "Opening…" : "Open"}
        </button>
      </form>
      {resolveError && <p className="text-sm text-red-400 mb-4">{resolveError}</p>}

      {root && (
        <>
          <div className="bg-surface border border-border rounded-lg p-4 mb-4 max-h-96 overflow-y-auto">
            {renderFolder(root, 0, false)}
          </div>

          <div className="flex items-end gap-3 mb-4 flex-wrap">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Destination client</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent appearance-none"
              >
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">…or create new</label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="New client name"
                  className="bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-accent"
                />
              </div>
              <button
                type="button"
                onClick={handleCreateClient}
                disabled={creatingClient || !newClientName.trim()}
                className="px-4 py-2.5 rounded-lg text-sm border border-border text-neutral-300 disabled:opacity-50"
              >
                {creatingClient ? "Creating…" : "Create"}
              </button>
            </div>
            <button
              type="button"
              onClick={handleStart}
              disabled={starting || !clientId || !!running}
              className="ml-auto px-5 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#C60D60" }}
            >
              {starting ? "Starting…" : "Import selected"}
            </button>
          </div>
          {startError && <p className="text-sm text-red-400 mb-4">{startError}</p>}
        </>
      )}

      {importStatus && (
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-white">
              {running
                ? "Importing…"
                : importStatus.status === "completed"
                  ? "Import complete"
                  : importStatus.status === "completed_with_errors"
                    ? "Import finished with errors"
                    : "Import failed"}
            </p>
            <p className="text-xs text-neutral-400">
              {importStatus.copiedFiles} copied
              {importStatus.skippedFiles > 0 && ` · ${importStatus.skippedFiles} skipped (already present)`}
              {importStatus.totalFiles > 0 && ` · ${importStatus.totalFiles} total`}
            </p>
          </div>
          {importStatus.totalFiles > 0 && (
            <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: "#2A2A2A" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  background: "#C60D60",
                  width: `${Math.min(
                    100,
                    ((importStatus.copiedFiles +
                      importStatus.skippedFiles +
                      (importStatus.errors?.length || 0)) /
                      importStatus.totalFiles) *
                      100
                  )}%`,
                }}
              />
            </div>
          )}
          {importStatus.errors && importStatus.errors.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {importStatus.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-400">
                  {e.path ? `${e.path}/` : ""}
                  {e.fileName || "Import"}: {e.message}
                </p>
              ))}
            </div>
          )}
          {!running && importStatus.status !== "error" && (
            <p className="text-xs text-neutral-500 mt-2">
              Copied footage is being ingested — clips will appear under the client shortly.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

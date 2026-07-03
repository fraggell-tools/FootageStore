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
  loadError: boolean;
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

const mono: React.CSSProperties = {
  fontFamily: "'Geist Mono', 'SF Mono', monospace",
};
const eyebrow: React.CSSProperties = {
  ...mono,
  fontSize: "0.6875rem",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return n > 0 ? `${n} B` : "";
}

function newNode(f: BrowseFolder): TreeNode {
  return { ...f, loaded: false, expanded: false, loadError: false, folders: [], files: [] };
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

/* ── Icons ──────────────────────────────────────────────────── */

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.5} className="opacity-20" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function FilmIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" strokeLinecap="round" />
    </svg>
  );
}

function Checkbox({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className={`relative flex-shrink-0 ${disabled ? "cursor-default" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
        className="peer sr-only"
      />
      <span
        className={`flex items-center justify-center w-4 h-4 rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-1 ${
          checked
            ? disabled
              ? "bg-accent/40 border-transparent"
              : "bg-accent border-transparent"
            : "bg-transparent border-border hover:border-muted"
        }`}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
    </label>
  );
}

/* ── Page ───────────────────────────────────────────────────── */

export default function ImportPage() {
  const [link, setLink] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
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
        ...newNode(data.folder),
        loaded: true,
        expanded: true,
        folders: data.folders.map(newNode),
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
      setLoadingIds((s) => new Set(s).add(node.id));
      try {
        const data = await browse({ folderId: node.id });
        node.folders = data.folders.map(newNode);
        node.files = data.files;
        node.loaded = true;
        node.loadError = false;
        node.expanded = true;
      } catch {
        node.loadError = true;
      } finally {
        setLoadingIds((s) => {
          const next = new Set(s);
          next.delete(node.id);
          return next;
        });
        setRoot((r) => (r ? { ...r } : r));
      }
      return;
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
        return;
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
      setStartError("Select at least one folder or file first");
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

  /* ── Tree rendering ─────────────────────────────────────── */

  function renderFolder(node: TreeNode, depth: number, ancestorChecked: boolean) {
    const isChecked = ancestorChecked || checked.has(node.id);
    const isLoading = loadingIds.has(node.id);
    return (
      <div key={node.id}>
        <div className="group flex items-center gap-2.5 h-8 px-2 rounded-md hover:bg-surface-hover transition-colors">
          <Checkbox
            checked={isChecked}
            disabled={ancestorChecked}
            onChange={() => toggleChecked(node.id)}
            label={`Select folder ${node.name}`}
          />
          <button
            type="button"
            onClick={() => toggleExpand(node)}
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left text-sm text-fg"
            aria-expanded={node.expanded}
          >
            <span className="text-muted">{isLoading ? <SpinnerIcon /> : <ChevronIcon expanded={node.expanded} />}</span>
            <FolderIcon />
            <span className="truncate">{node.name}</span>
            {node.loadError && (
              <span className="text-xs text-red-500 flex-shrink-0">Couldn&apos;t load — click to retry</span>
            )}
          </button>
        </div>
        {node.expanded && (
          <div className="ml-[27px] pl-2 border-l border-border">
            {node.folders.map((sub) => renderFolder(sub, depth + 1, isChecked))}
            {node.files.map((file) => {
              const fileChecked = isChecked || checked.has(file.id);
              return (
                <div
                  key={file.id}
                  className="group flex items-center gap-2.5 h-8 px-2 rounded-md hover:bg-surface-hover transition-colors"
                >
                  <Checkbox
                    checked={fileChecked}
                    disabled={isChecked}
                    onChange={() => toggleChecked(file.id)}
                    label={`Select file ${file.name}`}
                  />
                  <FilmIcon />
                  <span className="truncate flex-1 text-sm text-fg">{file.name}</span>
                  <span className="text-xs text-muted tabular-nums flex-shrink-0" style={mono}>
                    {formatBytes(file.size)}
                  </span>
                </div>
              );
            })}
            {node.loaded && node.folders.length === 0 && node.files.length === 0 && (
              <p className="h-8 flex items-center px-2 text-xs text-muted">This folder is empty</p>
            )}
          </div>
        )}
      </div>
    );
  }

  const selection = root ? collectSelection(root) : { folders: [], files: [] };
  const selectionCount = selection.folders.length + selection.files.length;
  const running = importStatus && (importStatus.status === "pending" || importStatus.status === "running");
  const progressDone = importStatus
    ? importStatus.copiedFiles + importStatus.skippedFiles + (importStatus.errors?.length || 0)
    : 0;

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-fg">Import from Drive</h1>
        <p className="text-sm text-muted mt-1.5 max-w-xl">
          Paste a link to a Google Drive folder that&apos;s been shared with us, choose what to bring
          in, and it&apos;s copied into a client folder — then picked up by the library automatically.
        </p>
      </div>

      {/* Source */}
      <p className="text-muted mb-2" style={eyebrow}>
        Source folder
      </p>
      <form onSubmit={handleResolve} className="flex gap-2 mb-6">
        <input
          type="text"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
          className="flex-1 bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-fg placeholder:text-muted/60 focus:outline-none focus:border-accent transition-colors"
          style={mono}
        />
        <button
          type="submit"
          disabled={resolving || !link.trim()}
          className="px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent transition-colors"
        >
          {resolving ? "Opening…" : "Open folder"}
        </button>
      </form>
      {resolveError && (
        <div className="flex items-start gap-2 mb-6 -mt-3 text-sm text-red-500">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span>{resolveError}</span>
        </div>
      )}

      {/* Select */}
      {root && (
        <>
          <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <FolderIcon />
                <span className="text-sm font-medium text-fg truncate">{root.name}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-muted tabular-nums" style={mono}>
                  {selectionCount === 0
                    ? "Nothing selected"
                    : [
                        selection.folders.length > 0 &&
                          `${selection.folders.length} folder${selection.folders.length === 1 ? "" : "s"}`,
                        selection.files.length > 0 &&
                          `${selection.files.length} file${selection.files.length === 1 ? "" : "s"}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
                <button
                  type="button"
                  onClick={() => toggleChecked(root.id)}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {checked.has(root.id) ? "Clear selection" : "Select everything"}
                </button>
              </div>
            </div>
            <div className="p-2 max-h-96 overflow-y-auto">{renderFolder(root, 0, false)}</div>
          </div>

          {/* Destination */}
          <p className="text-muted mb-2" style={eyebrow}>
            Destination
          </p>
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="bg-surface border border-border rounded-lg px-4 py-2.5 pr-9 text-sm text-fg focus:outline-none focus:border-accent transition-colors appearance-none"
            >
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted px-1">or</span>
            <input
              type="text"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              placeholder="New client name"
              className="bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-fg placeholder:text-muted/60 focus:outline-none focus:border-accent transition-colors"
            />
            <button
              type="button"
              onClick={handleCreateClient}
              disabled={creatingClient || !newClientName.trim()}
              className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-fg hover:bg-surface-hover disabled:opacity-40 transition-colors"
            >
              {creatingClient ? "Creating…" : "Create client"}
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={starting || !clientId || selectionCount === 0 || !!running}
              className="ml-auto px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent transition-colors"
            >
              {starting ? "Starting…" : "Import selected"}
            </button>
          </div>
          {startError && <p className="text-sm text-red-500 mb-6 -mt-3">{startError}</p>}
        </>
      )}

      {/* Progress */}
      {importStatus && (
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  running
                    ? "bg-accent animate-pulse"
                    : importStatus.status === "completed"
                      ? "bg-emerald-500"
                      : importStatus.status === "completed_with_errors"
                        ? "bg-amber-500"
                        : "bg-red-500"
                }`}
              />
              <p className="text-sm font-medium text-fg">
                {running
                  ? "Copying into Drive…"
                  : importStatus.status === "completed"
                    ? "Import complete"
                    : importStatus.status === "completed_with_errors"
                      ? "Import finished — some files couldn't be copied"
                      : "Import failed"}
              </p>
            </div>
            <p className="text-xs text-muted tabular-nums flex-shrink-0" style={mono}>
              {importStatus.copiedFiles} copied
              {importStatus.skippedFiles > 0 && ` · ${importStatus.skippedFiles} already there`}
              {importStatus.totalFiles > 0 && ` · ${importStatus.totalFiles} total`}
            </p>
          </div>
          {importStatus.totalFiles > 0 && (
            <div className="h-1.5 rounded-full bg-border overflow-hidden mb-3">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.min(100, (progressDone / importStatus.totalFiles) * 100)}%` }}
              />
            </div>
          )}
          {importStatus.errors && importStatus.errors.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto mb-1">
              {importStatus.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-500" style={mono}>
                  {e.path ? `${e.path}/` : ""}
                  {e.fileName || "Import"} — {e.message}
                </p>
              ))}
            </div>
          )}
          {!running && importStatus.status !== "error" && (
            <p className="text-xs text-muted">
              The copied footage is being processed — clips appear under the client as they&apos;re ready.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";

interface Client {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  clipCount: number;
  totalStorageBytes: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ManageClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editError, setEditError] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const fetchClients = async () => {
    try {
      const res = await fetch("/api/clients");
      if (!res.ok) return;
      const data = await res.json();
      setClients(Array.isArray(data) ? data : data.clients || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create client");
      }

      setNewName("");
      setShowForm(false);
      fetchClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setSubmitting(false);
    }
  };

  const startEditing = (client: Client) => {
    setEditingId(client.id);
    setEditName(client.name);
    setEditDisplayName(client.displayName || "");
    setEditError("");
    setConfirmDeleteId(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName("");
    setEditDisplayName("");
    setEditError("");
  };

  const handleSaveEdit = async (clientId: string) => {
    if (!editName.trim()) return;
    setEditSubmitting(true);
    setEditError("");

    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), displayName: editDisplayName.trim() || null }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update client");
      }

      setEditingId(null);
      fetchClients();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async (clientId: string) => {
    setDeleteSubmitting(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
      if (res.ok) {
        setConfirmDeleteId(null);
        fetchClients();
      }
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-fg)" }}>Manage Clients</h1>
          <p className="text-muted text-sm mt-1">
            {clients.length} client{clients.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Client
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleAddClient}
          className="bg-surface border border-border rounded-xl p-4 mb-6 flex items-end gap-4"
        >
          <div className="flex-1">
            <label className="block text-sm font-medium text-muted mb-1.5">
              Client Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter client name..."
              className="bg-bg border border-border rounded-lg px-4 py-2 text-sm placeholder-muted focus:outline-none focus:border-accent w-full"
              style={{ color: "var(--color-fg)" }}
              autoFocus
            />
            {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setNewName("");
                setError("");
              }}
              className="px-4 py-2 text-sm text-muted hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !newName.trim()}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-surface rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-5 py-3">
                  Name / Display Name
                </th>
                <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-5 py-3">
                  Clips
                </th>
                <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-5 py-3">
                  Storage
                </th>
                <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-5 py-3">
                  Date Added
                </th>
                <th className="text-right text-xs font-medium text-muted uppercase tracking-wider px-5 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-surface-hover transition-colors group">
                  <td className="px-5 py-3.5">
                    {editingId === client.id ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") cancelEditing(); }}
                            className="bg-bg border border-accent rounded-md px-3 py-1 text-sm focus:outline-none w-full max-w-xs"
                            style={{ color: "var(--color-fg)" }}
                            placeholder="Brand slug name"
                            autoFocus
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editDisplayName}
                            onChange={(e) => setEditDisplayName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(client.id);
                              if (e.key === "Escape") cancelEditing();
                            }}
                            className="bg-bg border border-border rounded-md px-3 py-1 text-sm focus:outline-none w-full max-w-xs"
                            style={{ color: "var(--color-fg)" }}
                            placeholder="Display name (optional)"
                          />
                          <button
                            onClick={() => handleSaveEdit(client.id)}
                            disabled={editSubmitting || !editName.trim()}
                            className="text-accent hover:text-accent-hover disabled:opacity-50 p-1"
                            title="Save"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="text-muted hover:text-white p-1"
                            title="Cancel"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        {editError && <span className="text-red-400 text-xs">{editError}</span>}
                      </div>
                    ) : (
                      <div>
                        <span className="text-sm font-medium" style={{ color: "var(--color-fg)" }}>{client.displayName || client.name}</span>
                        {client.displayName && (
                          <p className="text-xs text-muted mt-0.5">{client.name}</p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-muted">{client.clipCount}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-muted">
                      {formatBytes(client.totalStorageBytes || 0)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-muted">
                      {client.createdAt ? formatDate(client.createdAt) : "-"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {confirmDeleteId === client.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-red-400">Delete {client.clipCount} clips?</span>
                        <button
                          onClick={() => handleDelete(client.id)}
                          disabled={deleteSubmitting}
                          className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1 rounded-md transition-colors"
                        >
                          {deleteSubmitting ? "..." : "Yes"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-muted hover:text-white px-2 py-1 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : editingId === client.id ? null : (
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEditing(client)}
                          className="text-muted hover:text-white p-1.5 rounded-md hover:bg-white/5 transition-colors"
                          title="Edit"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setConfirmDeleteId(client.id);
                            setEditingId(null);
                          }}
                          className="text-muted hover:text-red-400 p-1.5 rounded-md hover:bg-red-500/10 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted text-sm">
                    No clients yet. Click &ldquo;Add Client&rdquo; to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

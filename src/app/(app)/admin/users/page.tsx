"use client";

import { useState, useEffect } from "react";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("editor");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Edit modal state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("editor");
  const [editPassword, setEditPassword] = useState("");
  const [editError, setEditError] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/users");
      if (!res.ok) return;
      const data = await res.json();
      // API returns an array directly
      setUsers(Array.isArray(data) ? data : data.users || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const generatePassword = (target: "new" | "edit" = "new") => {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < 12; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    if (target === "new") setNewPassword(result);
    else setEditPassword(result);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditPassword("");
    setEditError("");
  };

  const closeEdit = () => {
    setEditingUser(null);
    setEditError("");
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setEditSubmitting(true);
    setEditError("");

    try {
      const payload: Record<string, string> = {
        name: editName.trim(),
        email: editEmail.trim(),
        role: editRole,
      };
      if (editPassword.trim()) payload.password = editPassword;

      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update user");
      }

      closeEdit();
      fetchUsers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editingUser) return;
    if (!confirm(`Delete ${editingUser.name}? This can't be undone.`)) return;

    setEditSubmitting(true);
    setEditError("");

    try {
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete user");
      }

      closeEdit();
      fetchUsers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newName.trim() || !newPassword.trim()) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          name: newName.trim(),
          password: newPassword,
          role: newRole,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user");
      }

      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setNewRole("editor");
      setShowForm(false);
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  };

  const roleBadge = (role: string) => {
    const styles: Record<string, string> = {
      admin: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      editor: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    };
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border capitalize ${
          styles[role] || styles.editor
        }`}
      >
        {role}
      </span>
    );
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-muted text-sm mt-1">
            {users.length} user{users.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          Add User
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-surface border border-border rounded-xl p-4 mb-6 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Full name"
                className="bg-bg border border-border rounded-lg px-4 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent w-full"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="email@example.com"
                className="bg-bg border border-border rounded-lg px-4 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                Password
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Set a password"
                  className="bg-bg border border-border rounded-lg px-4 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent w-full font-mono"
                />
                <button
                  type="button"
                  onClick={() => generatePassword("new")}
                  className="bg-bg border border-border hover:border-accent text-neutral-300 hover:text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
                >
                  Generate
                </button>
              </div>
              <p className="text-xs text-muted mt-1">
                Share this with the user — they can change it later.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                Role
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="bg-bg border border-border rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent w-full appearance-none"
              >
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setError("");
              }}
              className="px-4 py-2 text-sm text-muted hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                !newEmail.trim() ||
                !newName.trim() ||
                !newPassword.trim()
              }
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {submitting ? "Creating..." : "Create User"}
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
                  Name
                </th>
                <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-5 py-3">
                  Email
                </th>
                <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-5 py-3">
                  Role
                </th>
                <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-5 py-3">
                  Created
                </th>
                <th className="text-right text-xs font-medium text-muted uppercase tracking-wider px-5 py-3">
                  {/* actions */}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-surface-hover transition-colors">
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-white font-medium">{user.name}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-neutral-300">{user.email}</span>
                  </td>
                  <td className="px-5 py-3.5">{roleBadge(user.role)}</td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-neutral-300">
                      {formatDate(user.createdAt)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => openEdit(user)}
                      className="text-xs font-medium text-neutral-300 hover:text-white border border-border hover:border-accent rounded-md px-3 py-1.5 transition-colors"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted text-sm">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingUser && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={closeEdit}
        >
          <div
            className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">Edit user</h2>
              <button
                type="button"
                onClick={closeEdit}
                className="text-muted hover:text-white"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="bg-bg border border-border rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="bg-bg border border-border rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Role
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="bg-bg border border-border rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent w-full appearance-none"
                >
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Reset password
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                    className="bg-bg border border-border rounded-lg px-4 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent w-full font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => generatePassword("edit")}
                    className="bg-bg border border-border hover:border-accent text-neutral-300 hover:text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Generate
                  </button>
                </div>
                <p className="text-xs text-muted mt-1">
                  Share any new password with the user directly.
                </p>
              </div>

              {editError && <p className="text-red-400 text-xs">{editError}</p>}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={editSubmitting}
                  className="text-red-400 hover:text-red-300 disabled:opacity-50 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
                >
                  Delete user
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeEdit}
                    className="px-4 py-2 text-sm text-muted hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      editSubmitting ||
                      !editName.trim() ||
                      !editEmail.trim()
                    }
                    className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {editSubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

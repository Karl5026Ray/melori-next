"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";

type Role = "free" | "superfan" | "artist" | "admin";
type Status = "active" | "suspended" | "deleted";

interface AccountRow {
  id: string;
  username: string | null;
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: Role;
  membership_tier: string | null;
  membership_status: string | null;
  verified: boolean | null;
  status: Status;
  suspended_reason: string | null;
  deleted_at: string | null;
  deleted_reason: string | null;
  created_at: string | null;
  email: string | null;
  last_sign_in_at: string | null;
  artist: { id: number; slug: string; is_verified: boolean; is_published: boolean } | null;
}

interface Stats {
  total: number;
  artists: number;
  active: number;
  suspended: number;
}

interface ActivityRow {
  id: string;
  admin_email: string | null;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

const ROLES: Role[] = ["free", "superfan", "artist", "admin"];

function fmtDate(v: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function roleBadge(role: Role): string {
  switch (role) {
    case "admin":
      return "bg-melori-purple/20 text-melori-accent border-melori-purple/40";
    case "artist":
      return "bg-melori-pink/20 text-melori-pink border-melori-pink/40";
    case "superfan":
      return "bg-blue-500/20 text-blue-300 border-blue-500/40";
    default:
      return "bg-white/5 text-text-secondary border-brand-border";
  }
}

function statusBadge(status: Status): string {
  switch (status) {
    case "active":
      return "bg-melori-success/20 text-melori-success border-melori-success/40";
    case "suspended":
      return "bg-melori-warning/20 text-melori-warning border-melori-warning/40";
    case "deleted":
      return "bg-melori-danger/20 text-melori-danger border-melori-danger/40";
  }
}

export default function AdminAccountsPage() {
  const [authState, setAuthState] = useState<"checking" | "denied" | "ok">("checking");
  const [tab, setTab] = useState<"accounts" | "activity">("accounts");

  const [users, setUsers] = useState<AccountRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [search, setSearch] = useState("");

  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [editRow, setEditRow] = useState<AccountRow | null>(null);
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{ email: string; password: string } | null>(null);

  // Gate: must be an admin (profiles.role === 'admin').
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) {
        if (active) setAuthState("denied");
        return;
      }
      const res = await authFetch("/api/user/me");
      const j = await res.json().catch(() => ({}));
      if (!active) return;
      setAuthState(res.ok && j?.isAdmin ? "ok" : "denied");
    })();
    return () => {
      active = false;
    };
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (roleFilter !== "all") params.set("role", roleFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (includeDeleted) params.set("includeDeleted", "true");
    if (search.trim()) params.set("q", search.trim());
    try {
      const res = await authFetch(`/api/admin/accounts?${params.toString()}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Failed to load");
      setUsers(j.users ?? []);
      setStats(j.stats ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [roleFilter, statusFilter, includeDeleted, search]);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const res = await authFetch("/api/admin/activity");
      const j = await res.json();
      if (res.ok) setActivity(j.logs ?? []);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authState !== "ok") return;
    if (tab === "accounts") void loadAccounts();
    if (tab === "activity") void loadActivity();
  }, [authState, tab, loadAccounts, loadActivity]);

  if (authState === "checking") {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16 text-center text-text-secondary">
        Checking access…
      </main>
    );
  }

  if (authState === "denied") {
    return (
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="mb-3 text-2xl font-bold text-text-primary">Not authorized</h1>
        <p className="mb-6 text-text-secondary">
          This area is for MELORI administrators only.
        </p>
        <Link
          href="/"
          className="inline-block rounded-md bg-melori-purple px-4 py-2 font-semibold text-white hover:opacity-90"
        >
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">User &amp; Artist Management</h1>
          <p className="text-sm text-text-secondary">Manage accounts, roles, and access.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/dashboard"
            className="rounded-md border border-brand-border px-3 py-2 text-sm text-text-secondary hover:text-melori-accent"
          >
            Admin dashboard
          </Link>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-melori-purple px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + Create account
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-brand-border">
        {(["accounts", "activity"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? "border-b-2 border-melori-purple text-melori-accent"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "accounts" && (
        <>
          {/* Stats cards */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total users" value={stats?.total} />
            <StatCard label="Artists" value={stats?.artists} />
            <StatCard label="Active" value={stats?.active} />
            <StatCard label="Suspended" value={stats?.suspended} />
          </div>

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs text-text-secondary">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void loadAccounts()}
                placeholder="username, email, or name"
                className="w-full rounded-md border border-input-border bg-brand-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-melori-purple"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-secondary">Role</label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-md border border-input-border bg-brand-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-melori-purple"
              >
                <option value="all">All</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-secondary">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-md border border-input-border bg-brand-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-melori-purple"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="deleted">Deleted</option>
              </select>
            </div>
            <label className="flex items-center gap-2 py-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="accent-melori-purple"
              />
              Show deleted
            </label>
            <button
              type="button"
              onClick={() => void loadAccounts()}
              className="rounded-md border border-brand-border px-4 py-2 text-sm text-text-primary hover:text-melori-accent"
            >
              Apply
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-md border border-melori-danger/40 bg-melori-danger/10 px-4 py-2 text-sm text-melori-danger">
              {error}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-brand-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-brand-surface text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-text-secondary">
                      Loading…
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-text-secondary">
                      No accounts found.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-t border-brand-border hover:bg-white/5">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-brand-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {u.avatar_url ? (
                              <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div>
                            <div className="font-medium text-text-primary">
                              {u.display_name || u.full_name || u.username || "—"}
                            </div>
                            {u.username && (
                              <div className="text-xs text-text-secondary">@{u.username}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{u.email ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${roleBadge(u.role)}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{u.membership_tier ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${statusBadge(u.status)}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{fmtDate(u.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setEditRow(u)}
                          className="rounded-md border border-brand-border px-3 py-1 text-xs text-text-primary hover:text-melori-accent"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "activity" && (
        <div className="overflow-x-auto rounded-lg border border-brand-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-brand-surface text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {activityLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-secondary">
                    Loading…
                  </td>
                </tr>
              ) : activity.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-secondary">
                    No activity yet.
                  </td>
                </tr>
              ) : (
                activity.map((a) => (
                  <tr key={a.id} className="border-t border-brand-border align-top">
                    <td className="px-4 py-3 text-text-secondary">
                      {new Date(a.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{a.admin_email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-melori-purple/40 bg-melori-purple/20 px-2 py-0.5 text-xs text-melori-accent">
                        {a.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {a.target_type}: <span className="font-mono text-xs">{a.target_id.slice(0, 8)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <pre className="max-w-xs overflow-x-auto whitespace-pre-wrap break-words text-xs text-text-secondary">
                        {a.details ? JSON.stringify(a.details) : ""}
                      </pre>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(info) => {
            setShowCreate(false);
            setTempPasswordInfo(info);
            void loadAccounts();
          }}
        />
      )}

      {editRow && (
        <EditModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => {
            setEditRow(null);
            void loadAccounts();
          }}
          onTempPassword={(info) => setTempPasswordInfo(info)}
        />
      )}

      {tempPasswordInfo && (
        <TempPasswordModal
          info={tempPasswordInfo}
          onClose={() => setTempPasswordInfo(null)}
        />
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <div className="text-2xl font-bold text-text-primary">{value ?? "—"}</div>
      <div className="text-xs text-text-secondary">{label}</div>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-brand-border bg-brand-background p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary">{title}</h2>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-input-border bg-brand-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-melori-purple";

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (info: { email: string; password: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("free");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await authFetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, display_name: displayName, username, role }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Failed to create");
      onCreated({ email: j.email ?? email, password: j.tempPassword });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Create account" onClose={onClose}>
      <div className="space-y-3">
        {err && <p className="text-sm text-melori-danger">{err}</p>}
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Email *</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputCls}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={busy || !email}
          onClick={() => void submit()}
          className="w-full rounded-md bg-melori-purple px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create account"}
        </button>
      </div>
    </ModalShell>
  );
}

function EditModal({
  row,
  onClose,
  onSaved,
  onTempPassword,
}: {
  row: AccountRow;
  onClose: () => void;
  onSaved: () => void;
  onTempPassword: (info: { email: string; password: string }) => void;
}) {
  const [displayName, setDisplayName] = useState(row.display_name ?? "");
  const [username, setUsername] = useState(row.username ?? "");
  const [role, setRole] = useState<Role>(row.role);
  const [membershipTier, setMembershipTier] = useState(row.membership_tier ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    setErr(null);
    try {
      const res = await authFetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Request failed");
      return j;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveFields() {
    const j = await call(`/api/admin/accounts/${row.id}`, "PATCH", {
      display_name: displayName,
      username,
      role,
      membership_tier: membershipTier,
    });
    if (j) onSaved();
  }

  async function resetPassword() {
    const j = await call(`/api/admin/accounts/${row.id}/reset-password`, "POST");
    if (j?.tempPassword) onTempPassword({ email: row.email ?? "", password: j.tempPassword });
  }

  async function toggleSuspend() {
    const suspend = row.status !== "suspended";
    const j = await call(`/api/admin/accounts/${row.id}/suspend`, "POST", {
      suspended: suspend,
      reason: suspend ? reason : undefined,
    });
    if (j) onSaved();
  }

  async function softDelete() {
    if (!window.confirm("Soft-delete this account? They will lose access.")) return;
    const j = await call(`/api/admin/accounts/${row.id}`, "DELETE", { reason });
    if (j) onSaved();
  }

  return (
    <ModalShell title={`Manage ${row.display_name || row.username || row.email || "account"}`} onClose={onClose}>
      <div className="space-y-3">
        {err && <p className="text-sm text-melori-danger">{err}</p>}
        <p className="text-xs text-text-secondary">{row.email}</p>
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-secondary">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputCls}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-secondary">Membership tier</label>
            <input value={membershipTier} onChange={(e) => setMembershipTier(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Reason (suspend / delete)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="optional" />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void saveFields()}
          className="w-full rounded-md bg-melori-purple px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Save changes
        </button>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void resetPassword()}
            className="rounded-md border border-brand-border px-3 py-2 text-xs text-text-primary hover:text-melori-accent disabled:opacity-50"
          >
            Reset password
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleSuspend()}
            className="rounded-md border border-melori-warning/40 px-3 py-2 text-xs text-melori-warning hover:bg-melori-warning/10 disabled:opacity-50"
          >
            {row.status === "suspended" ? "Reactivate" : "Suspend"}
          </button>
        </div>
        <button
          type="button"
          disabled={busy || row.status === "deleted"}
          onClick={() => void softDelete()}
          className="w-full rounded-md border border-melori-danger/40 px-3 py-2 text-xs text-melori-danger hover:bg-melori-danger/10 disabled:opacity-50"
        >
          {row.status === "deleted" ? "Already deleted" : "Soft delete account"}
        </button>
      </div>
    </ModalShell>
  );
}

function TempPasswordModal({
  info,
  onClose,
}: {
  info: { email: string; password: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <ModalShell title="Temporary password" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          Share this with <span className="text-text-primary">{info.email || "the user"}</span>. It is shown once.
        </p>
        <div className="flex items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-3 py-2">
          <code className="flex-1 break-all text-sm text-melori-accent">{info.password}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(info.password);
              setCopied(true);
            }}
            className="rounded-md bg-melori-purple px-3 py-1 text-xs font-semibold text-white"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-md border border-brand-border px-4 py-2 text-sm text-text-primary hover:text-melori-accent"
        >
          Done
        </button>
      </div>
    </ModalShell>
  );
}

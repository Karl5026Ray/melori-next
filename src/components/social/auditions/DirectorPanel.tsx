"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Circle,
  Copy,
  Download,
  Loader2,
  Play,
  Square,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { undownloadedTakes } from "@/lib/auditions";
import { auditionsApi, displayName, type AuditionPerson, type AuditionView } from "./api";
import { FileRow } from "./Materials";

function errorText(e: unknown) {
  return (e as Error)?.message ?? "Something went wrong";
}

/** Invite code + named invites. */
function DoorCard({ view, onChanged }: { view: AuditionView; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const code = view.invite_code;

  async function invite() {
    setBusy(true);
    setMsg(null);
    try {
      await auditionsApi.access(view.room.id, { action: "invite", username });
      setMsg(`Added @${username.replace(/^@/, "")}. They'll see it under Auditions.`);
      setUsername("");
      onChanged();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-melori-border bg-melori-surface p-4">
      <h2 className="text-sm font-semibold">Invite</h2>
      {code && view.room.room_format !== "callback" && (
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-lg bg-melori-void px-3 py-2 font-mono text-lg tracking-widest">{code}</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex min-h-11 items-center gap-1 rounded-xl bg-melori-elevated px-3 text-sm"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <p className="mt-2 text-xs text-melori-muted">
        {view.room.room_format === "callback"
          ? "Callbacks are invite-only. Add each actor by their Melori username."
          : "Actors enter this code under Auditions. Or add someone by username."}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="@username"
          autoCapitalize="none"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-melori-border bg-melori-void px-3 text-sm focus:border-melori-purple focus:outline-none"
        />
        <button
          type="button"
          onClick={invite}
          disabled={!username.trim() || busy}
          className="flex min-h-11 items-center gap-1 rounded-xl bg-melori-purple px-3 text-sm font-medium disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" /> Add
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-melori-muted">{msg}</p>}
    </section>
  );
}

function PersonRow({
  view,
  person,
  onChanged,
}: {
  view: AuditionView;
  person: AuditionPerson;
  onChanged: () => void;
}) {
  const [part, setPart] = useState(person.character_name ?? "");
  const [busy, setBusy] = useState(false);
  const materials = view.files.filter((f) => f.owner_id === person.user_id && f.kind !== "script");

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await auditionsApi.access(view.room.id, { user_id: person.user_id, ...body });
      onChanged();
    } catch (e) {
      alert(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const statusLabel =
    person.status === "lobby" ? "Waiting" : person.status === "invited" ? "Invited" : "In the room";

  return (
    <li className="rounded-xl bg-melori-elevated p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayName(person.profile)}</p>
          <p className="text-xs text-melori-muted">{statusLabel}</p>
        </div>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-melori-muted" />}
        {person.status !== "admitted" ? (
          <button
            type="button"
            disabled={busy || person.status === "invited"}
            onClick={() => act({ action: "admit" })}
            className="min-h-11 rounded-xl bg-melori-teal px-3 text-sm font-semibold text-black disabled:opacity-40"
          >
            Let in
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ action: "lobby" })}
            className="min-h-11 rounded-xl bg-melori-void px-3 text-sm"
          >
            To lobby
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirm(`Close the room to ${displayName(person.profile)}? They can't come back this session.`)) {
              void act({ action: "deny" });
            }
          }}
          aria-label="Remove from session"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-melori-muted hover:text-melori-danger"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={part}
          onChange={(e) => setPart(e.target.value)}
          onBlur={() => part !== (person.character_name ?? "") && act({ character_name: part })}
          placeholder="Reading for… (character)"
          maxLength={80}
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-melori-border bg-melori-void px-3 text-sm focus:border-melori-purple focus:outline-none"
        />
      </div>
      {materials.length > 0 && (
        <ul className="mt-2 space-y-1">
          {materials.map((f) => (
            <FileRow key={f.id} roomId={view.room.id} file={f} />
          ))}
        </ul>
      )}
    </li>
  );
}

function PeopleCard({ view, onChanged }: { view: AuditionView; onChanged: () => void }) {
  const order = { lobby: 0, admitted: 1, invited: 2 } as Record<string, number>;
  const people = [...view.people].sort((a, b) => (order[a.status ?? ""] ?? 9) - (order[b.status ?? ""] ?? 9));
  const waiting = people.filter((p) => p.status === "lobby").length;
  return (
    <section className="rounded-2xl border border-melori-border bg-melori-surface p-4">
      <h2 className="text-sm font-semibold">
        Actors {waiting > 0 && <span className="ml-1 rounded-full bg-melori-teal px-2 py-0.5 text-xs text-black">{waiting} waiting</span>}
      </h2>
      {people.length === 0 ? (
        <p className="mt-2 text-xs text-melori-muted">No one yet. Share your code.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {people.map((p) => (
            <PersonRow key={p.user_id} view={view} person={p} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ScriptsCard({ view, onChanged }: { view: AuditionView; onChanged: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scripts = view.files.filter((f) => f.kind === "script");

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await auditionsApi.upload(view.room.id, "script", file);
      // A freshly shared script opens for everyone straight away.
      await auditionsApi.setState(view.room.id, { script_file_id: id });
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <section className="rounded-2xl border border-melori-border bg-melori-surface p-4">
      <h2 className="text-sm font-semibold">Scripts &amp; sides</h2>
      <input ref={ref} type="file" accept="application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <ul className="mt-2 space-y-2">
        {scripts.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => auditionsApi.setState(view.room.id, { script_file_id: s.id }).then(onChanged)}
              className={`min-h-10 flex-1 truncate rounded-lg px-3 text-left text-sm ${
                view.state?.script_file_id === s.id ? "bg-melori-purple/30 text-melori-text" : "bg-melori-elevated"
              }`}
            >
              {view.state?.script_file_id === s.id ? "Showing: " : "Show: "}
              {s.file_name}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-melori-elevated text-sm disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Share a script (PDF)
      </button>
      {error && <p className="mt-2 text-xs text-melori-danger">{error}</p>}
    </section>
  );
}

function RecordCard({ view, recording, onChanged }: { view: AuditionView; recording: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const takes = view.recordings;
  const used = takes.length;
  const left = view.max_recordings - used;
  const running = recording || view.room.is_recording;
  const openTake = takes.find((t) => !t.stopped_at);

  // Running timer so a forgotten recording is obvious (every minute costs).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const startedAt = openTake ? new Date(openTake.started_at).getTime() : null;
  const elapsed = running && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await auditionsApi.record(view.room.id, running ? "stop" : "start");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function open(takeId: string, download: boolean) {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await auditionsApi.takeUrl(view.room.id, takeId, download);
      if (tab) tab.location.href = url;
      if (download) onChanged();
    } catch (e) {
      tab?.close();
      alert(errorText(e));
    }
  }

  return (
    <section className="rounded-2xl border border-melori-border bg-melori-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Recordings</h2>
        <span className="text-xs text-melori-muted">{used} of {view.max_recordings} used</span>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || (!running && left <= 0)}
        className={`mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-40 ${
          running ? "bg-melori-danger text-white" : "bg-melori-elevated"
        }`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : running ? (
          <Square className="h-4 w-4" />
        ) : (
          <Circle className="h-4 w-4 fill-melori-danger text-melori-danger" />
        )}
        {running ? `Stop recording · ${mmss}` : left > 0 ? "Record" : "No recordings left"}
      </button>
      <p className="mt-2 text-xs text-melori-muted">
        Everyone sees a REC banner while you record. Takes are deleted when you end the session, so
        download the ones you want to keep.
      </p>
      {takes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {takes.map((t, i) => (
            <li key={t.id} className="flex items-center gap-2 rounded-lg bg-melori-elevated px-3 py-2 text-sm">
              <span className="flex-1">
                Take {i + 1}
                {t.downloaded_at && <Check className="ml-1 inline h-4 w-4 text-melori-teal" aria-label="Downloaded" />}
              </span>
              {t.stopped_at ? (
                <>
                  <button type="button" onClick={() => open(t.id, false)} aria-label={`Play take ${i + 1}`} className="flex min-h-10 min-w-10 items-center justify-center rounded-md hover:bg-white/10">
                    <Play className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => open(t.id, true)} aria-label={`Download take ${i + 1}`} className="flex min-h-10 min-w-10 items-center justify-center rounded-md hover:bg-white/10">
                    <Download className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <span className="text-xs text-melori-danger">recording…</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-melori-danger">{error}</p>}
    </section>
  );
}

export function EndSessionButton({ view, onEnded }: { view: AuditionView; onEnded: () => void }) {
  const [busy, setBusy] = useState(false);
  async function end() {
    const lose = undownloadedTakes(view.recordings);
    const warning =
      lose > 0
        ? `You have ${lose} recording${lose === 1 ? "" : "s"} not downloaded. Ending the session deletes ALL recordings and uploaded files for good. End anyway?`
        : "End the session for everyone? Recordings and uploaded files are deleted.";
    if (!confirm(warning)) return;
    setBusy(true);
    try {
      await auditionsApi.end(view.room.id);
      onEnded();
    } catch (e) {
      alert(errorText(e));
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={end}
      disabled={busy}
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-melori-danger/50 text-sm font-medium text-melori-danger disabled:opacity-50"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />} End session
    </button>
  );
}

export function DirectorPanel({
  view,
  recording,
  onChanged,
}: {
  view: AuditionView;
  recording: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-3">
      <PeopleCard view={view} onChanged={onChanged} />
      {view.me.is_host && <RecordCard view={view} recording={recording} onChanged={onChanged} />}
      <ScriptsCard view={view} onChanged={onChanged} />
      {view.me.is_host && <DoorCard view={view} onChanged={onChanged} />}
    </div>
  );
}

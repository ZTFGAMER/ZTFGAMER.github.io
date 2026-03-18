#!/usr/bin/env python3
"""Export today's local chat history by session for current workspace."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import sqlite3
from collections import defaultdict


def _norm_path(p: str | Path) -> str:
    return str(Path(p).expanduser().resolve())


def _same_or_child(path: str, base: str) -> bool:
    if path == base:
        return True
    return path.startswith(base.rstrip("/") + "/")


def export_claude_rows(
    source: Path, today: dt.date, workspace_root: str
) -> list[tuple[dt.datetime, str, str, str, str]]:
    if not source.exists():
        return []

    rows: list[tuple[dt.datetime, str, str, str, str]] = []
    with source.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            project = str(data.get("project", ""))
            if project:
                try:
                    if not _same_or_child(_norm_path(project), workspace_root):
                        continue
                except Exception:
                    continue
            else:
                continue
            timestamp_ms = data.get("timestamp")
            if not isinstance(timestamp_ms, (int, float)):
                continue
            t = dt.datetime.fromtimestamp(timestamp_ms / 1000)
            if t.date() != today:
                continue
            rows.append(
                (
                    t,
                    str(data.get("sessionId", "")),
                    project,
                    "user",
                    str(data.get("display", "")),
                )
            )
    return rows


def _day_range_ms(today: dt.date) -> tuple[int, int]:
    start = dt.datetime.combine(today, dt.time.min)
    end = start + dt.timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def export_opencode_rows(
    db_path: Path, today: dt.date, workspace_root: str
) -> list[tuple[dt.datetime, str, str, str, str]]:
    if not db_path.exists():
        return []

    start_ms, end_ms = _day_range_ms(today)
    rows: list[tuple[dt.datetime, str, str, str, str]] = []

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        session_dir: dict[str, str] = {}
        session_title: dict[str, str] = {}
        session_cursor = conn.execute("SELECT id, directory, title FROM session")
        for s in session_cursor:
            sid = str(s["id"])
            directory = str(s["directory"] or "")
            title = str(s["title"] or "")
            session_dir[sid] = directory
            session_title[sid] = title

        cursor = conn.execute(
            """
            SELECT m.id AS message_id, m.session_id, m.time_created, m.data
            FROM message m
            WHERE m.time_created >= ? AND m.time_created < ?
            ORDER BY m.time_created ASC
            """,
            (start_ms, end_ms),
        )
        for rec in cursor:
            msg_data = json.loads(rec["data"])
            role = str(msg_data.get("role", ""))
            if role not in {"user", "assistant"}:
                continue

            sid = str(rec["session_id"])
            raw_dir = session_dir.get(sid, "")
            if not raw_dir:
                continue
            try:
                if not _same_or_child(_norm_path(raw_dir), workspace_root):
                    continue
            except Exception:
                continue

            parts_cursor = conn.execute(
                """
                SELECT data
                FROM part
                WHERE message_id = ?
                ORDER BY time_created ASC
                """,
                (rec["message_id"],),
            )
            text_parts: list[str] = []
            for part_rec in parts_cursor:
                part_data = json.loads(part_rec["data"])
                if part_data.get("type") == "text":
                    text = part_data.get("text")
                    if isinstance(text, str) and text.strip():
                        text_parts.append(text.strip())

            if not text_parts:
                continue

            rows.append(
                (
                    dt.datetime.fromtimestamp(int(rec["time_created"]) / 1000),
                    sid,
                    session_title.get(sid, ""),
                    role,
                    "\n\n".join(text_parts),
                )
            )
    finally:
        conn.close()

    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export today's entries from OpenCode/Codex and Claude logs"
    )
    parser.add_argument(
        "--claude-source",
        type=Path,
        default=Path.home() / ".claude" / "history.jsonl",
        help="Path to Claude history JSONL file",
    )
    parser.add_argument(
        "--opencode-db",
        type=Path,
        default=Path.home() / ".local" / "share" / "opencode" / "opencode.db",
        help="Path to OpenCode SQLite DB",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path.home() / ".claude" / "today-history.md",
        help="Path to markdown output",
    )
    parser.add_argument(
        "--workspace-root",
        type=Path,
        default=Path.cwd(),
        help="Only include sessions/messages under this workspace path",
    )
    return parser.parse_args()


def write_grouped_section(
    *,
    f,
    title: str,
    rows: list[tuple[dt.datetime, str, str, str, str]],
    trim_len: int = 500,
) -> None:
    f.write(f"## {title}\n\n")
    if not rows:
        f.write("No entries found for today in current workspace.\n\n")
        return

    grouped: dict[str, list[tuple[dt.datetime, str, str, str]]] = defaultdict(list)
    for t, session_id, session_title, role, message in rows:
        grouped[session_id].append((t, session_title, role, message))

    def session_sort_key(item: tuple[str, list[tuple[dt.datetime, str, str, str]]]) -> dt.datetime:
        _, msgs = item
        return msgs[-1][0]

    for session_id, messages in sorted(grouped.items(), key=session_sort_key):
        session_title = next((m[1] for m in messages if m[1]), "")
        session_label = session_title if session_title else "(untitled)"
        f.write(f"### `{session_id}` | {session_label}\n\n")
        for t, _, role, message in messages:
            one_line = " ".join(message.splitlines()).strip()
            if len(one_line) > trim_len:
                one_line = one_line[:trim_len] + " ..."
            f.write(f"- {t:%H:%M:%S} | `{role}` | {one_line}\n")
        f.write("\n")


def main() -> int:
    args = parse_args()
    claude_source = args.claude_source.expanduser()
    opencode_db = args.opencode_db.expanduser()
    output = args.output.expanduser()
    workspace_root = _norm_path(args.workspace_root)
    today = dt.date.today()

    codex_rows = export_opencode_rows(opencode_db, today, workspace_root)
    claude_rows = export_claude_rows(claude_source, today, workspace_root)

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as f:
        f.write(f"# Today History ({today.isoformat()})\n\n")
        f.write(f"Workspace: `{workspace_root}`\n\n")

        write_grouped_section(f=f, title="OpenCode / Codex", rows=codex_rows)
        write_grouped_section(f=f, title="Claude Prompt History", rows=claude_rows)

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

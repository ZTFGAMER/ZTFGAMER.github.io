#!/usr/bin/env python3
import argparse
import re
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SESSION_ROOT = ROOT / "agent-sessions"
TEMPLATE_ROOT = SESSION_ROOT / "_templates"


def load_template(name: str) -> str:
    path = TEMPLATE_ROOT / name
    if not path.exists():
        raise FileNotFoundError(f"Missing template: {path}")
    return path.read_text(encoding="utf-8")


def sanitize_topic(topic: str) -> str:
    text = topic.strip()
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff_-]", "", text)
    if not text:
        raise ValueError("topic is empty after sanitization")
    return text[:10]


def render(template: str, mapping: dict[str, str]) -> str:
    result = template
    for key, value in mapping.items():
        result = result.replace("{{" + key + "}}", value)
    return result


def write_if_missing(path: Path, content: str) -> None:
    if path.exists():
        return
    path.write_text(content, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a new autonomous debug session folder")
    parser.add_argument("--topic", required=True, help="Session topic, up to 10 chars recommended")
    parser.add_argument(
        "--hypothesis",
        default="设计说 X 应该发生，本轮确认游戏实际是否如此",
        help="Verification hypothesis written to report.md",
    )
    parser.add_argument("--with-bugs", action="store_true", help="Also create bugs.md")
    parser.add_argument("--with-coverage", action="store_true", help="Also create coverage.md")
    parser.add_argument("--with-balance", action="store_true", help="Also create balance.md")
    args = parser.parse_args()

    topic = sanitize_topic(args.topic)
    stamp = datetime.now().strftime("%Y%m%d%H%M")
    session_dir_name = f"{stamp}-{topic}"
    session_dir = SESSION_ROOT / session_dir_name
    screenshots_dir = session_dir / "screenshots"

    session_dir.mkdir(parents=True, exist_ok=False)
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    mapping = {
        "SESSION_TITLE": f"{stamp} · {topic}",
        "SESSION_DIR": session_dir_name,
        "HYPOTHESIS": args.hypothesis,
    }

    report = render(load_template("report.md"), mapping)
    write_if_missing(session_dir / "report.md", report)

    if args.with_bugs:
        bugs = render(load_template("bugs.md"), mapping)
        write_if_missing(session_dir / "bugs.md", bugs)

    if args.with_coverage:
        coverage = render(load_template("coverage.md"), mapping)
        write_if_missing(session_dir / "coverage.md", coverage)

    if args.with_balance:
        balance = render(load_template("balance.md"), mapping)
        write_if_missing(session_dir / "balance.md", balance)

    print(f"[DONE] created {session_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

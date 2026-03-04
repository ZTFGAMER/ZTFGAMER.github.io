#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import List


ROOT = Path(__file__).resolve().parents[1]


def run(cmd: List[str]) -> None:
    print(f"\n[RUN] ({ROOT}) {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(ROOT), check=True)


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def extract_run_rules(game_cfg: list[dict]) -> dict:
    for entry in game_cfg:
        if isinstance(entry, dict) and entry.get("name") == "run_rules":
            value = entry.get("value")
            if isinstance(value, dict):
                return value
    return {}


def check_mobile_release_log_guard() -> None:
    cfg = load_json(ROOT / "data" / "game_config.json")
    if not isinstance(cfg, list):
        raise RuntimeError("data/game_config.json should be an array")
    run_rules = extract_run_rules(cfg)
    mute_logs = run_rules.get("muteLogsInMobileRelease")
    if mute_logs is not True:
        raise RuntimeError("run_rules.muteLogsInMobileRelease must be true for mobile release")
    print("[OK] run_rules.muteLogsInMobileRelease=true")


def check_soak_hooks() -> None:
    main_ts = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    required = ["__startSoakTest", "__stopSoakTest", "__getSoakStats", "params.get('soak') === '1'"]
    missing = [token for token in required if token not in main_ts]
    if missing:
        raise RuntimeError(f"Missing soak hooks in src/main.ts: {', '.join(missing)}")
    print("[OK] soak hooks exposed in src/main.ts")


def main() -> int:
    parser = argparse.ArgumentParser(description="P1 performance preflight checks")
    parser.add_argument("--skip-build", action="store_true", help="Skip npm run build")
    parser.add_argument("--skip-test", action="store_true", help="Skip npm test")
    args = parser.parse_args()

    check_mobile_release_log_guard()
    check_soak_hooks()

    if not args.skip_build:
        run(["npm", "run", "build"])
    if not args.skip_test:
        run(["npm", "test"])

    print("\n[DONE] P1 performance preflight checks passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)

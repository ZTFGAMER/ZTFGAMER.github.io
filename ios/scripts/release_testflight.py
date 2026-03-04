#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "ios" / "packaging.config.local.json"
SKILL_DIR = Path.home() / ".claude" / "skills" / "ios-web-packager" / "scripts"
VALIDATE_SCRIPT = SKILL_DIR / "validate_config.py"
RUN_SCRIPT = SKILL_DIR / "run_packaging.py"


def run(cmd: List[str], cwd: Optional[Path] = None) -> None:
    where = str(cwd or ROOT)
    print(f"\n[RUN] ({where}) {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(cwd or ROOT), check=True)


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload: dict) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def read_build_number(project_yml: Path) -> int:
    text = project_yml.read_text(encoding="utf-8")
    m = re.search(r'(^\s*CURRENT_PROJECT_VERSION:\s*")(\d+)(")', text, flags=re.MULTILINE)
    if not m:
        raise RuntimeError(f"Cannot find CURRENT_PROJECT_VERSION in {project_yml}")
    return int(m.group(2))


def write_build_number(project_yml: Path, value: int) -> int:
    text = project_yml.read_text(encoding="utf-8")
    m = re.search(r'(^\s*CURRENT_PROJECT_VERSION:\s*")(\d+)(")', text, flags=re.MULTILINE)
    if not m:
        raise RuntimeError(f"Cannot find CURRENT_PROJECT_VERSION in {project_yml}")
    old = int(m.group(2))
    out = re.sub(
        r'(^\s*CURRENT_PROJECT_VERSION:\s*")(\d+)(")',
        rf'\g<1>{value}\g<3>',
        text,
        count=1,
        flags=re.MULTILINE,
    )
    project_yml.write_text(out, encoding="utf-8")
    return old


def parse_expected_px(size_text: str, scale_text: str) -> Tuple[int, int]:
    size = size_text.lower().replace(" ", "")
    scale = scale_text.lower().replace(" ", "")
    if "x" not in size or not scale.endswith("x"):
        raise RuntimeError(f"Bad icon size/scale: size={size_text}, scale={scale_text}")
    w, h = size.split("x", 1)
    factor = int(scale[:-1])
    return int(float(w) * factor), int(float(h) * factor)


def get_image_px(path: Path) -> Tuple[int, int]:
    proc = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    width = None
    height = None
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line.startswith("pixelWidth:"):
            width = int(line.split(":", 1)[1].strip())
        if line.startswith("pixelHeight:"):
            height = int(line.split(":", 1)[1].strip())
    if width is None or height is None:
        raise RuntimeError(f"Cannot read image size with sips: {path}")
    return width, height


def validate_app_icons(ios_dir: Path) -> None:
    icon_dir = ios_dir / "BigBazzar" / "Assets.xcassets" / "AppIcon.appiconset"
    contents = icon_dir / "Contents.json"
    if not contents.is_file():
        raise RuntimeError(f"Missing AppIcon Contents.json: {contents}")
    payload = load_json(contents)
    images = payload.get("images", [])
    if not isinstance(images, list) or not images:
        raise RuntimeError("AppIcon Contents.json has no images list")

    missing: list[str] = []
    bad_size: list[str] = []
    checked = 0
    for entry in images:
        if not isinstance(entry, dict):
            continue
        filename = str(entry.get("filename", "")).strip()
        size_text = str(entry.get("size", "")).strip()
        scale_text = str(entry.get("scale", "")).strip()
        if not filename:
            continue
        image_path = icon_dir / filename
        if not image_path.is_file():
            missing.append(filename)
            continue
        expected = parse_expected_px(size_text, scale_text)
        actual = get_image_px(image_path)
        checked += 1
        if actual != expected:
            bad_size.append(f"{filename}: expected={expected[0]}x{expected[1]} actual={actual[0]}x{actual[1]}")

    if missing or bad_size:
        lines = ["App icon validation failed."]
        if missing:
            lines.append("Missing files:")
            lines.extend([f"  - {x}" for x in missing])
        if bad_size:
            lines.append("Size mismatch:")
            lines.extend([f"  - {x}" for x in bad_size])
        raise RuntimeError("\n".join(lines))

    print(f"[OK] App icons validated ({checked} files)")


def prepare_config(config_path: Path, no_upload: bool) -> Path:
    if not no_upload:
        return config_path
    cfg = load_json(config_path)
    cfg["upload_enabled"] = False
    fd, temp_path = tempfile.mkstemp(prefix="packaging.no-upload.", suffix=".json")
    os.close(fd)
    temp = Path(temp_path)
    save_json(temp, cfg)
    return temp


def main() -> int:
    parser = argparse.ArgumentParser(description="One-command TestFlight release with icon checks and auto build increment")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Path to packaging config JSON")
    parser.add_argument("--build-number", type=int, default=None, help="Set explicit build number")
    parser.add_argument("--no-upload", action="store_true", help="Build/export only, do not upload")
    parser.add_argument("--check-only", action="store_true", help="Only run config + icon checks")
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    if not config_path.is_file():
        raise RuntimeError(f"Config not found: {config_path}")
    if not VALIDATE_SCRIPT.is_file() or not RUN_SCRIPT.is_file():
        raise RuntimeError("ios-web-packager scripts not found under ~/.claude/skills/ios-web-packager/scripts")

    cfg = load_json(config_path)
    ios_dir = Path(str(cfg.get("ios_dir", ""))).resolve()
    project_yml = Path(str(cfg.get("xcodegen_project_yml_path", ""))).resolve()
    if not ios_dir.is_dir():
        raise RuntimeError(f"ios_dir does not exist: {ios_dir}")
    if not project_yml.is_file():
        raise RuntimeError(f"xcodegen_project_yml_path does not exist: {project_yml}")

    print(f"[INFO] Using config: {config_path}")
    run(["python3", str(VALIDATE_SCRIPT), str(config_path)], cwd=ROOT)
    validate_app_icons(ios_dir)

    if args.check_only:
        print("[DONE] Checks passed (check-only)")
        return 0

    old_build = read_build_number(project_yml)
    new_build = args.build_number if args.build_number is not None else old_build + 1
    if new_build <= 0:
        raise RuntimeError(f"Invalid build number: {new_build}")
    write_build_number(project_yml, new_build)
    print(f"[INFO] Build number updated: {old_build} -> {new_build}")

    prepared = prepare_config(config_path, args.no_upload)
    try:
        run(["python3", str(RUN_SCRIPT), str(prepared)], cwd=ROOT)
    finally:
        if prepared != config_path and prepared.exists():
            prepared.unlink(missing_ok=True)

    print(f"[DONE] TestFlight flow completed. CURRENT_PROJECT_VERSION={new_build}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)

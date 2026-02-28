#!/bin/bash

set -e

IOS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${IOS_DIR}/.." && pwd)"
PROJECT_NAME="BigBazzar"
SCHEME="BigBazzar"
XCODEPROJ="${IOS_DIR}/${PROJECT_NAME}.xcodeproj"
DERIVED_DATA_DIR="${IOS_DIR}/.derivedData"

echo "[iOS] Step 1/4 生成 Web 资源"
cd "$ROOT_DIR"
npm run build:ios-web

echo "[iOS] Step 1.5/4 兼容 file:// 加载（移除 module crossorigin）"
python3 - <<'PY'
from pathlib import Path
index = Path('dist-ios/index.html')
text = index.read_text(encoding='utf-8')
text = text.replace(' crossorigin', '')
index.write_text(text, encoding='utf-8')
print('patched', index)
PY

echo "[iOS] Step 1.6/4 转换 iOS 图标资源为 PNG（规避部分 WEBP 解码失败）"
python3 - <<'PY'
from pathlib import Path
from PIL import Image
import shutil

src_dir = Path('resource/itemicon/vanessa')
dst_dir = Path('dist-ios/resource/itemicon/vanessa')
dst_dir.mkdir(parents=True, exist_ok=True)

count = 0

# 1) 直接复制 PNG（新资源默认 PNG）
for p in src_dir.glob('*.png'):
    out = dst_dir / p.name
    shutil.copy2(p, out)
    count += 1

# 2) 兼容遗留 WEBP：转换为 PNG
converted = 0
for p in src_dir.glob('*.webp'):
    out = dst_dir / (p.stem + '.png')
    # 若同名 png 已存在（优先 png），则跳过
    if out.exists():
        continue
    with Image.open(p) as im:
        im.convert('RGBA').save(out, format='PNG')
    converted += 1

print(f'copied {count} png icons, converted {converted} webp icons to PNG')
PY

echo "[iOS] Step 2/4 生成 Xcode 工程"
cd "$IOS_DIR"
xcodegen generate

ACTION="${1:-simulator}"

if [ "$ACTION" = "open" ]; then
  echo "[iOS] Step 3/4 打开 Xcode"
  open "$XCODEPROJ"
  exit 0
fi

if [ "$ACTION" = "simulator" ]; then
  echo "[iOS] Step 3/4 构建 Simulator 包"
  SIMULATOR_ID=$(xcrun simctl list devices available | grep "iPhone" | head -1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/')
  if [ -z "$SIMULATOR_ID" ]; then
    echo "未找到可用 iPhone 模拟器"
    exit 1
  fi

  xcodebuild \
    -project "$XCODEPROJ" \
    -scheme "$SCHEME" \
    -destination "id=$SIMULATOR_ID" \
    -configuration Release \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    clean build

  APP_PATH="${DERIVED_DATA_DIR}/Build/Products/Release-iphonesimulator/${PROJECT_NAME}.app"
  if [ -d "$APP_PATH" ]; then
    xcrun simctl boot "$SIMULATOR_ID" 2>/dev/null || true
    BUNDLE_ID=$(defaults read "$APP_PATH/Info.plist" CFBundleIdentifier)
    xcrun simctl uninstall "$SIMULATOR_ID" "$BUNDLE_ID" 2>/dev/null || true
    xcrun simctl install "$SIMULATOR_ID" "$APP_PATH"
    xcrun simctl launch "$SIMULATOR_ID" "$BUNDLE_ID"
  else
    echo "未找到构建产物: $APP_PATH"
    exit 1
  fi
  echo "[iOS] Step 4/4 完成：Simulator 构建并启动"
  exit 0
fi

if [ "$ACTION" = "archive" ]; then
  echo "[iOS] Step 3/4 归档 iOS 包"
  ARCHIVE_PATH="${IOS_DIR}/build/${PROJECT_NAME}.xcarchive"
  mkdir -p "${IOS_DIR}/build"

  TEAM_ARG=""
  if [ -n "$IOS_DEVELOPMENT_TEAM" ]; then
    TEAM_ARG="DEVELOPMENT_TEAM=$IOS_DEVELOPMENT_TEAM"
  fi

  xcodebuild \
    -project "$XCODEPROJ" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE_PATH" \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    CODE_SIGN_STYLE=Automatic \
    $TEAM_ARG \
    archive

  echo "[iOS] Step 4/4 完成：Archive 输出 $ARCHIVE_PATH"
  exit 0
fi

echo "未知参数: $ACTION"
echo "用法: ./ios/build.sh [simulator|archive|open]"
exit 1

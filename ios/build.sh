#!/bin/bash

set -e

IOS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${IOS_DIR}/.." && pwd)"
PROJECT_NAME="BigBazzar"
SCHEME="BigBazzar"
XCODEPROJ="${IOS_DIR}/${PROJECT_NAME}.xcodeproj"

echo "[iOS] Step 1/4 生成 Web 资源"
cd "$ROOT_DIR"
npm run build:ios-web

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
    clean build

  APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -name "${PROJECT_NAME}.app" | head -1)
  if [ -n "$APP_PATH" ]; then
    xcrun simctl boot "$SIMULATOR_ID" 2>/dev/null || true
    xcrun simctl install "$SIMULATOR_ID" "$APP_PATH"
    BUNDLE_ID=$(defaults read "$APP_PATH/Info.plist" CFBundleIdentifier)
    xcrun simctl launch "$SIMULATOR_ID" "$BUNDLE_ID"
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
    CODE_SIGN_STYLE=Automatic \
    $TEAM_ARG \
    archive

  echo "[iOS] Step 4/4 完成：Archive 输出 $ARCHIVE_PATH"
  exit 0
fi

echo "未知参数: $ACTION"
echo "用法: ./ios/build.sh [simulator|archive|open]"
exit 1

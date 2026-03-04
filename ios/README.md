# BigBazzar iOS 打包

## 方案
- Web 端：`Vite + PixiJS` 构建 `dist-ios`
- iOS 壳：`SwiftUI + WKWebView`
- 工程生成：`XcodeGen`（由 `project.yml` 生成 `.xcodeproj`）

## 一键命令

```bash
./ios/build.sh simulator
```

会自动执行：
1. `npm run build:ios-web`
2. `xcodegen generate`
3. `xcodebuild` 构建并安装到第一个可用 iPhone 模拟器

## 归档 (Archive)

```bash
IOS_DEVELOPMENT_TEAM=你的TeamID ./ios/build.sh archive
```

- 产物：`ios/build/BigBazzar.xcarchive`
- 后续在 Xcode Organizer 里导出 IPA 或上传 TestFlight。

## TestFlight 一键发布（自动递增 build 号）

```bash
npm run release:tf
```

默认行为：
1. 校验 `ios/packaging.config.local.json`
2. 校验 AppIcon 完整性（文件存在 + 像素尺寸匹配）
3. 自动将 `ios/project.yml` 的 `CURRENT_PROJECT_VERSION` +1
4. 执行 `build -> xcodegen -> archive -> export -> upload`

常用参数：

```bash
# 仅校验配置与图标，不打包
python3 ios/scripts/release_testflight.py --check-only

# 指定 build 号，不自动+1
python3 ios/scripts/release_testflight.py --build-number 12

# 打包导出但不上传 TestFlight
python3 ios/scripts/release_testflight.py --no-upload
```

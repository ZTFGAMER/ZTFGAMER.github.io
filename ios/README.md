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

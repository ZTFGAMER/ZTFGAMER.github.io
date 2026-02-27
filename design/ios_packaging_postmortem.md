# BigBazzar iOS 打包复盘与标准流程（2026-02-26）

## 目标

- 将 `Vite + PixiJS` Web 项目稳定打成 iOS 包。
- 产物可在 Simulator、真机、TestFlight 正常运行。
- 将“黑屏/资源丢失/版本冲突”等高频坑收敛为可重复流程。

## 最终结果

- Simulator：可启动、可渲染、图片恢复显示。
- 在线 debug 参数：可导出并固化为项目初始值。
- TestFlight：上传成功（Delivery UUID: `3f45d9df-2ac5-4bd2-9a23-419db46ec08f`）。

---

## 遇到的核心难点

1. **包体异常小（~220KB）+ 启动即报 `dist-ios/index.html 未找到`**
   - 本质：只打进了壳工程，没有打进 Web 静态资源。

2. **即使能进页面仍黑屏**
   - HTML 成功加载，但脚本/资源链路存在兼容问题，导致视觉上空白。

3. **图片不显示**
   - iOS WebView 下部分 WEBP 解码异常（日志含 `WEBP/AVIF` 相关错误）。
   - 协议与路径映射不一致（`file://` / `app://` / 绝对路径 `/resource/...`）。

4. **在线调参默认值与项目初始值不一致**
   - localStorage 旧缓存覆盖了最新默认值。

5. **TestFlight 上传失败（版本重复）**
   - `CFBundleVersion`（build number）未递增。

---

## 根因与修复映射

### A. 资源未进包 / 装到旧包

- 根因
  - Xcode 产物缺少 `dist-ios`。
  - 脚本从全局 DerivedData 随机找 `.app`，容易安装旧包。

- 修复
  - `ios/project.yml` 增加 postBuildScript，显式复制：
    - `dist-ios/`
    - `resource/`
  - `ios/build.sh` 固定 `-derivedDataPath ios/.derivedData`。
  - 安装前先卸载同 bundle app，避免缓存污染。

### B. 黑屏定位能力不足

- 修复
  - `ios/BigBazzar/WebView.swift` 增加 JS Bridge：
    - `window.error`
    - `unhandledrejection`
    - `console.log/warn/error`
  - 增加页面快照日志（script 列表、`#app` 子节点、是否有 canvas）。
  - 启用 `isInspectable`（iOS 16.4+）支持 Safari Inspector。

### C. 协议与资源路径兼容

- 修复
  - 使用 `app://` + `WKURLSchemeHandler` 本地资源加载。
  - 解析 URL 时纳入 `host + path`，避免 `app://resource/...` 映射错误。
  - 响应改为 `HTTPURLResponse(200)` + `Content-Type`，减少资源解析异常。

### D. 图片格式兼容（WEBP）

- 修复
  - 构建时将 `resource/itemicon/vanessa/*.webp` 转换为
    `dist-ios/resource/itemicon/vanessa/*.png`。
  - `src/core/assetPath.ts`：
    - Web 继续用 `webp`
    - iOS `app:` 协议走 `png`
  - 图标加载失败不再静默，统一 `console.warn` 打印 URL 与 item id。

### E. Debug 默认值固化

- 修复
  - 新增 `data/debug_defaults.json`（项目级默认值）。
  - `debugConfig` 启动时读取并覆盖默认值。
  - `debug.html` 新增按钮：
    - 复制配置
    - 保存为默认值（下载 JSON）
  - `app://` 启动前清理 `bigbazzar_cfg_*` 缓存，避免旧值覆盖。

### F. TestFlight 版本冲突

- 修复
  - `ios/project.yml`：`CURRENT_PROJECT_VERSION` 从 `1` 升到 `2`。

---

## 当前可复用的标准命令

```bash
# 1) 模拟器打包运行
./ios/build.sh simulator

# 2) 归档（真机/TestFlight）
IOS_DEVELOPMENT_TEAM=6P57AJV77Q ./ios/build.sh archive

# 3) 导出 TestFlight 包
xcodebuild -allowProvisioningUpdates \
  -exportArchive \
  -archivePath "ios/build/BigBazzar.xcarchive" \
  -exportPath "ios/build/export-testflight" \
  -exportOptionsPlist "ios/ExportOptions_TestFlight.plist"

# 4) 上传 TestFlight
xcrun altool --upload-app \
  -f "ios/build/export-testflight/BigBazzar.ipa" \
  --type ios \
  --api-key 6QLQ7HG556 \
  --api-issuer 22a9771c-9912-4bb8-a1bf-f6b827aed80f \
  --p8-file-path "/Users/zhengtengfei/Documents/documents/AuthKey_6QLQ7HG556.p8" \
  --output-format json --show-progress
```

---

## 一次性验收清单（每次发包前）

1. `dist-ios/index.html` 存在且可打开。
2. `.app` 内存在 `dist-ios/` 与 `resource/`。
3. 启动日志中 `hasCanvas=true`。
4. 图标请求日志存在且无 `asset-missing`。
5. UI 可见图片、可交互（商店/背包/战斗区）。
6. `CURRENT_PROJECT_VERSION` 大于上次 TF 构建。

---

## Skill 化可行性评估

**可行，且价值很高。**

建议 Skill 拆成 4 段：

1. `prepare`
   - 构建 Web、生成 Xcode 工程、清理旧安装。

2. `diagnose`
   - 自动检查 `.app` 资源完整性、输出关键日志采样。

3. `package`
   - archive + export + build number 校验（自动递增或提示）。

4. `upload`
   - API Key 上传、失败原因标准化（如 build number 冲突、bundle id 缺失）。

如果要做成 Skill，建议把“日志判读模板”和“常见报错对策表”也一起内置。

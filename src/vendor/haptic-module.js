/**
 * HapticModule — 通用、独立、零依赖的震动模块
 *
 * 三个层级:
 *   1. UIFeedbackGenerator 系统预设  — impact / notification / selection
 *   2. CoreHaptics 参数化控制        — playTransient / playContinuous
 *   3. AHAP / HAHAP 文件播放         — playFile / playPattern / playBundled
 *
 * 后端引擎:
 *   'corehaptics' — iOS Capacitor App (完整三层级)
 *   'vibration'   — Android Chrome/Firefox (降级模拟)
 *   'none'        — Desktop / iOS Safari (静默跳过)
 */
class HapticModule {

  // ═══════════════════════════════════════════════════
  //  私有状态
  // ═══════════════════════════════════════════════════

  static _backend = 'none';
  static _enabled = true;
  static _plugin = null;
  static _initialized = false;
  static _supportsHaptics = false;

  // ═══════════════════════════════════════════════════
  //  初始化 & 控制
  // ═══════════════════════════════════════════════════

  /**
   * 初始化模块，检测平台能力
   * 应在应用启动时调用一次
   * @returns {Promise<{backend: string, haptics: boolean}>}
   */
  static async init() {
    if (this._initialized) {
      return { backend: this._backend, haptics: this._supportsHaptics };
    }

    // 恢复用户偏好
    try {
      const stored = localStorage.getItem('haptic_module_enabled');
      if (stored !== null) this._enabled = stored !== 'false';
    } catch (_) { /* localStorage 不可用时忽略 */ }

    // 检测后端
    this._backend = this._detectBackend();

    // corehaptics 后端: 通过 Capacitor.Plugins 获取已注册的 Native 插件
    if (this._backend === 'corehaptics') {
      try {
        this._plugin = window.Capacitor.Plugins.CustomHaptics;
        const support = await this._plugin.checkSupport();
        this._supportsHaptics = support.haptics === true;
        if (!this._supportsHaptics) {
          console.warn('[HapticModule] Device does not support haptics (simulator?)');
        }
      } catch (e) {
        console.error('[HapticModule] Plugin init failed:', e);
        this._backend = 'none';
        this._plugin = null;
        this._supportsHaptics = false;
      }
    } else if (this._backend === 'vibration') {
      this._supportsHaptics = true;
    }

    this._initialized = true;
    return { backend: this._backend, haptics: this._supportsHaptics };
  }

  /**
   * 全局开关 (用户偏好)
   * @param {boolean} enabled
   */
  static setEnabled(enabled) {
    this._enabled = !!enabled;
    try {
      localStorage.setItem('haptic_module_enabled', String(this._enabled));
    } catch (_) { /* 忽略 */ }
  }

  /** @returns {boolean} */
  static get isEnabled() {
    return this._enabled;
  }

  /** @returns {boolean} */
  static get isSupported() {
    return this._backend !== 'none' && this._supportsHaptics;
  }

  /** @returns {'corehaptics' | 'vibration' | 'none'} */
  static get backend() {
    return this._backend;
  }

  // ═══════════════════════════════════════════════════
  //  层级 1：UIFeedbackGenerator 系统预设
  // ═══════════════════════════════════════════════════

  /**
   * 触觉冲击反馈
   * @param {'light' | 'medium' | 'heavy' | 'rigid' | 'soft'} [style='medium']
   */
  static impact(style = 'medium') {
    if (!this._enabled || this._backend === 'none') return;

    if (this._backend === 'corehaptics') {
      this._plugin.impact({ style });
      return;
    }

    // vibration 降级
    const map = { light: 10, medium: 20, heavy: 30, rigid: 15, soft: 25 };
    navigator.vibrate(map[style] || 20);
  }

  /**
   * 通知反馈
   * @param {'success' | 'warning' | 'error'} [type='success']
   */
  static notification(type = 'success') {
    if (!this._enabled || this._backend === 'none') return;

    if (this._backend === 'corehaptics') {
      this._plugin.notification({ type });
      return;
    }

    // vibration 降级
    const map = {
      success: [15, 40, 15],
      warning: [20, 30, 20, 30, 20],
      error:   [25, 50, 25, 50, 25]
    };
    navigator.vibrate(map[type] || map.success);
  }

  /**
   * 选择变化反馈 (最轻微的触觉)
   */
  static selection() {
    if (!this._enabled || this._backend === 'none') return;

    if (this._backend === 'corehaptics') {
      this._plugin.selection();
      return;
    }

    // vibration 降级
    navigator.vibrate(5);
  }

  // ═══════════════════════════════════════════════════
  //  层级 2：CoreHaptics 参数化控制
  // ═══════════════════════════════════════════════════

  /**
   * 播放单次瞬态触觉
   * @param {Object} [params]
   * @param {number} [params.intensity=0.5]  - 强度 0.0~1.0
   * @param {number} [params.sharpness=0.5]  - 锐度 0.0~1.0
   */
  static playTransient({ intensity = 0.5, sharpness = 0.5 } = {}) {
    if (!this._enabled || this._backend === 'none') return;

    if (this._backend === 'corehaptics') {
      this._plugin.playTransient({ intensity, sharpness });
      return;
    }

    // vibration 降级: 按强度缩放时长
    navigator.vibrate(Math.round(intensity * 30));
  }

  /**
   * 播放持续触觉
   * @param {Object} [params]
   * @param {number} [params.intensity=0.5]  - 强度 0.0~1.0
   * @param {number} [params.sharpness=0.5]  - 锐度 0.0~1.0
   * @param {number} [params.duration=0.3]   - 持续时间 (秒)
   */
  static playContinuous({ intensity = 0.5, sharpness = 0.5, duration = 0.3 } = {}) {
    if (!this._enabled || this._backend === 'none') return;

    if (this._backend === 'corehaptics') {
      this._plugin.playContinuous({ intensity, sharpness, duration });
      return;
    }

    // vibration 降级: 按 duration 转换为毫秒
    navigator.vibrate(Math.round(duration * 1000));
  }

  // ═══════════════════════════════════════════════════
  //  层级 3：AHAP / HAHAP 文件播放
  // ═══════════════════════════════════════════════════

  /**
   * 从 URL 加载 .ahap/.hahap 文件并播放
   * @param {string} url - 文件路径 (相对或绝对)
   * @returns {Promise<void>}
   */
  static async playFile(url) {
    if (!this._enabled || this._backend === 'none') return;

    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const ahapJson = await response.json();
      await this._dispatchAHAP(ahapJson);
    } catch (_) { /* fetch 失败时静默 */ }
  }

  /**
   * 直接传入 AHAP JSON 对象播放
   * @param {Object} ahapJson - 符合 AHAP 规范的 JSON 对象
   * @returns {Promise<void>}
   */
  static async playPattern(ahapJson) {
    if (!this._enabled || this._backend === 'none') return;
    await this._dispatchAHAP(ahapJson);
  }

  /**
   * 播放 iOS Bundle 内置的 .ahap/.hahap 文件
   * Native 直接从 Bundle.main 读取，延迟最低
   * @param {string} name - 文件名 (不含扩展名)
   * @returns {Promise<void>}
   */
  static async playBundled(name) {
    if (!this._enabled || this._backend === 'none') return;

    if (this._backend === 'corehaptics') {
      try {
        await this._plugin.playBundled({ name });
      } catch (_) { /* 静默 */ }
      return;
    }

    // vibration 降级: 无法访问 Bundle，回退为中等冲击
    navigator.vibrate(20);
  }

  // ═══════════════════════════════════════════════════
  //  通用控制
  // ═══════════════════════════════════════════════════

  /**
   * 停止当前正在播放的震动
   */
  static stop() {
    if (this._backend === 'corehaptics' && this._plugin) {
      this._plugin.stop();
    } else if (this._backend === 'vibration') {
      navigator.vibrate(0);
    }
  }

  // ═══════════════════════════════════════════════════
  //  内部方法
  // ═══════════════════════════════════════════════════

  /**
   * 检测后端引擎
   * @returns {'corehaptics' | 'vibration' | 'none'}
   */
  static _detectBackend() {
    // 优先级 1: Capacitor Native (iOS App)
    if (typeof window !== 'undefined'
        && window.Capacitor
        && typeof window.Capacitor.isNativePlatform === 'function'
        && window.Capacitor.isNativePlatform()) {
      return 'corehaptics';
    }

    // 优先级 2: Vibration API (Android Chrome / Firefox)
    if (typeof navigator !== 'undefined'
        && typeof navigator.vibrate === 'function') {
      return 'vibration';
    }

    // 优先级 3: 无震动能力
    return 'none';
  }

  /**
   * 分发 AHAP JSON 到对应后端
   * @param {Object} ahapJson
   * @returns {Promise<void>}
   */
  static async _dispatchAHAP(ahapJson) {
    if (this._backend === 'corehaptics') {
      try {
        await this._plugin.playPattern({ ahapJson: JSON.stringify(ahapJson) });
      } catch (_) { /* 静默 */ }
      return;
    }

    if (this._backend === 'vibration') {
      this._playAHAPViaVibration(ahapJson);
    }
  }

  /**
   * AHAP → Vibration API 转换
   * 解析 Pattern 中的事件，按时间轴生成 vibrate 模式数组
   * @param {Object} ahapJson
   */
  static _playAHAPViaVibration(ahapJson) {
    if (!ahapJson || !Array.isArray(ahapJson.Pattern)) return;

    const events = ahapJson.Pattern
      .filter(item => item.Event)
      .map(item => {
        const e = item.Event;
        const params = e.EventParameters || [];
        const intensity = params.find(p => p.ParameterID === 'HapticIntensity');
        return {
          time: e.Time || 0,
          duration: e.EventDuration || 0.05,
          intensity: intensity ? intensity.ParameterValue : 0.5
        };
      })
      .sort((a, b) => a.time - b.time);

    if (events.length === 0) return;

    // 构建 vibrate 模式: [振动ms, 暂停ms, 振动ms, ...]
    const pattern = [];
    let cursor = 0;

    for (const event of events) {
      const startMs = Math.round(event.time * 1000);
      const durationMs = Math.max(Math.round(event.duration * 1000 * event.intensity), 5);

      if (startMs > cursor) {
        pattern.push(startMs - cursor); // 暂停
      }
      pattern.push(durationMs); // 振动
      cursor = startMs + durationMs;
    }

    if (pattern.length > 0) {
      navigator.vibrate(pattern);
    }
  }
}

// 兼容 ES Module 和 Script 标签两种引入方式
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HapticModule;
}

export default HapticModule;

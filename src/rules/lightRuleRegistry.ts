/**
 * 亮牌规则注册表：支持运行时热插拔。
 *
 * - 默认加载内置 V1.0；
 * - 管理员应用新规则后立即替换内存中的激活规则，并持久化到 localStorage；
 * - 决策引擎每次调用都会读取当前激活规则，因此无需重启或刷新页面。
 */

import { reactive, readonly } from 'vue';
import {
  cloneDefaultLightRule,
  normalizeLightRule,
  parseLightRuleJson,
  type LightRuleConfig,
} from './lightRuleConfig';

export type LightRuleSource = 'builtin' | 'local' | 'imported';

export interface LightRuleRuntime {
  config: LightRuleConfig;
  source: LightRuleSource;
  activatedAt: string | null;
}

const STORAGE_KEY = 'gongzhu.light-rule.v1';

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function loadInitialRuntime(): LightRuleRuntime {
  if (!canUseStorage()) {
    return { config: cloneDefaultLightRule(), source: 'builtin', activatedAt: null };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { config: cloneDefaultLightRule(), source: 'builtin', activatedAt: null };
    const parsed = JSON.parse(raw) as { config?: unknown; activatedAt?: unknown };
    const config = normalizeLightRule(parsed.config ?? parsed);
    return {
      config,
      source: 'local',
      activatedAt: typeof parsed.activatedAt === 'string' ? parsed.activatedAt : null,
    };
  } catch {
    // 存储内容损坏时回退内置规则，避免应用无法启动。
    return { config: cloneDefaultLightRule(), source: 'builtin', activatedAt: null };
  }
}

const runtime = reactive<LightRuleRuntime>(loadInitialRuntime());

/** 只读运行时状态，供界面展示当前规则来源、版本和激活时间。 */
export const lightRuleRuntime = readonly(runtime);

/** 决策引擎读取当前激活规则。 */
export function getActiveLightRule(): LightRuleConfig {
  return runtime.config;
}

function persist(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ config: runtime.config, activatedAt: runtime.activatedAt }),
    );
  } catch {
    // 存储不可用时仍保持内存热更新。
  }
}

/**
 * 应用一份新规则（对象或 JSON 文本）。校验失败会抛错且不改变当前规则。
 */
export function activateLightRule(input: string | unknown): LightRuleConfig {
  const config = typeof input === 'string' ? parseLightRuleJson(input) : normalizeLightRule(input);
  runtime.config = config;
  runtime.source = 'imported';
  runtime.activatedAt = new Date().toISOString();
  persist();
  return config;
}

/** 恢复内置 V1.0 规则，并清除本地持久化。 */
export function resetLightRuleRegistry(): LightRuleConfig {
  if (canUseStorage()) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 忽略存储异常。
    }
  }
  const config = cloneDefaultLightRule();
  runtime.config = config;
  runtime.source = 'builtin';
  runtime.activatedAt = null;
  return config;
}

/** 将当前规则序列化为便于管理员编辑/导出的 JSON。 */
export function serializeLightRule(rule: unknown = runtime.config): string {
  return JSON.stringify(rule, null, 2);
}

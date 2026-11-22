/**
 * 亮牌规则 V1.0 配置模型。
 *
 * 字段与 `rules/拱猪亮牌规则_V1.0.md` 第 10 节保持一致（snake_case），
 * 便于管理员直接编辑 JSON、导入/导出与审计。
 */

export type LightFlag = 'normal' | 'gamble' | 'desperate' | 'rush';
export type LightKey = 'pig' | 'hA' | 'sheep' | 'trans';
export type LightInfoMode = 'open' | 'hidden';
export type SamplingMode = 'random' | 'threshold';

export const LIGHT_FLAGS: LightFlag[] = ['normal', 'gamble', 'desperate', 'rush'];
export const LIGHT_KEYS: LightKey[] = ['pig', 'hA', 'sheep', 'trans'];

export type LightKeyValues = Record<LightKey, number>;
export type FlagValues = Record<LightFlag, number>;

export interface LightRuleMeta {
  version: string;
  s_ref: number;
  name?: string;
  updated_at?: string;
  description?: string;
}

export interface LightRuleBranches {
  desperate_threshold: number;
  gamble_threshold: number;
  rush_threshold: number;
  sheep_veto_threshold: number;
}

export interface ModuleAConfig {
  pig: { k: number; b: number };
  hA: { k: number; b: number };
  sheep: { k: number; b: number };
  trans: { k: number; b: number };
  targets: Record<LightFlag, Partial<LightKeyValues>>;
}

export interface ModuleBConfig {
  count_factor: {
    pig: Record<string, number>;
    trans: Record<string, number>;
    sheep: Record<string, number>;
  };
  hA: { lambda1: number; lambda2: number; lambda3: number };
  points: { gamma: number; delta: number; kappa: number; theta: number };
  control: { mu1: number; mu2: number; mu3: number; eta: number; nu1: number; nu2: number };
  single_spade_pig_factor: number;
  zero_risk_trans_floor: number;
  card_factor_range: [number, number];
}

export interface ModuleCConfig {
  enabled: boolean;
  weights: Record<LightFlag, Record<LightKey, [number, number]>>;
}

export interface ModuleDConfig {
  threshold: Record<LightFlag, LightKeyValues>;
  n_max: FlagValues;
  mutex: Record<string, FlagValues>;
}

export interface SamplingConfig {
  mode: SamplingMode;
  seed_source: string;
}

export interface LightGameConfig {
  auto_light_last_one: boolean;
  light_info_mode: LightInfoMode;
  light_seconds: number;
  play_seconds: number;
}

export interface LightRuleConfig {
  meta: LightRuleMeta;
  branches: LightRuleBranches;
  module_a: ModuleAConfig;
  module_b: ModuleBConfig;
  module_c: ModuleCConfig;
  module_d: ModuleDConfig;
  sampling: SamplingConfig;
  game: LightGameConfig;
}

export const DEFAULT_LIGHT_RULE: LightRuleConfig = {
  meta: {
    version: '1.0',
    s_ref: 1000,
    name: '拱猪亮牌规则 V1.0',
    description: 'A→B→C→D 分层：相对分值、牌型修正、满贯修正（默认关闭）、综合互斥与采样。',
  },
  branches: {
    desperate_threshold: -0.6,
    gamble_threshold: -0.3,
    rush_threshold: 0.6,
    sheep_veto_threshold: -0.8,
  },
  module_a: {
    pig: { k: 3.0, b: 0.8 },
    hA: { k: 4.0, b: 1.2 },
    sheep: { k: 3.0, b: 0.2 },
    trans: { k: 2.5, b: 0.8 },
    targets: {
      desperate: { pig: 0.75, hA: 0.85, trans: 0.95 },
      gamble: { pig: 0.65, hA: 0.6, trans: 0.7 },
      rush: { trans: 0.95, sheep: 0.7 },
      normal: {},
    },
  },
  module_b: {
    count_factor: {
      pig: { '1': 0.3, '2': 0.42, '3': 0.55, '4': 1.0, '5+': 1.6 },
      trans: { '1': 0.3, '2': 0.5, '3': 0.85, '4': 1.25, '5+': 1.45 },
      sheep: { '1': 0.6, '2': 0.8, '3': 1.0, '4': 1.2, '5': 1.4, '6+': 1.55 },
    },
    hA: { lambda1: 0.9, lambda2: 1.5, lambda3: 0.3 },
    points: { gamma: 0.8, delta: 6, kappa: 0.7, theta: 0.5 },
    control: { mu1: 0.8, mu2: 1.2, mu3: 0.4, eta: 3.0, nu1: 1.0, nu2: 2.0 },
    single_spade_pig_factor: 0.45,
    zero_risk_trans_floor: 1.3,
    card_factor_range: [0.05, 2.5],
  },
  module_c: {
    enabled: false,
    weights: {
      normal: {
        pig: [0.75, 0.25],
        hA: [0.85, 0.35],
        sheep: [0.5, 0.4],
        trans: [0.8, 0.5],
      },
      gamble: {
        pig: [0.4, 0.3],
        hA: [0.5, 0.4],
        sheep: [0.3, 0.45],
        trans: [0.4, 0.55],
      },
      desperate: {
        pig: [0.15, 0.4],
        hA: [0.2, 0.45],
        sheep: [0.1, 0.45],
        trans: [0.05, 0.7],
      },
      rush: {
        pig: [0.6, 0.4],
        hA: [0.7, 0.5],
        sheep: [0.4, 0.6],
        trans: [0.5, 0.8],
      },
    },
  },
  module_d: {
    threshold: {
      normal: { pig: 0.6, hA: 0.65, sheep: 0.45, trans: 0.55 },
      gamble: { pig: 0.45, hA: 0.5, sheep: 0.4, trans: 0.45 },
      desperate: { pig: 0.25, hA: 0.25, sheep: 0.3, trans: 0.2 },
      rush: { pig: 0.7, hA: 0.75, sheep: 0.35, trans: 0.3 },
    },
    n_max: { normal: 2, gamble: 2, desperate: 3, rush: 2 },
    mutex: {
      'pig+hA': { normal: 0.5, gamble: 0.65, desperate: 0.85, rush: 0.4 },
      'pig+sheep': { normal: 0.75, gamble: 0.82, desperate: 0.9, rush: 0.8 },
      'pig+trans': { normal: 0.6, gamble: 0.7, desperate: 0.88, rush: 0.5 },
      'hA+sheep': { normal: 0.7, gamble: 0.78, desperate: 0.9, rush: 0.75 },
      'hA+trans': { normal: 0.55, gamble: 0.68, desperate: 0.88, rush: 0.45 },
      'sheep+trans': { normal: 0.85, gamble: 0.88, desperate: 0.92, rush: 0.95 },
      three_plus: { normal: 0.35, gamble: 0.5, desperate: 0.75, rush: 0.3 },
    },
  },
  sampling: {
    mode: 'random',
    seed_source: 'deal_seed + seat + deal_index + card_type',
  },
  game: {
    auto_light_last_one: true,
    light_info_mode: 'open',
    light_seconds: 30,
    play_seconds: 30,
  },
};

export function cloneDefaultLightRule(): LightRuleConfig {
  return JSON.parse(JSON.stringify(DEFAULT_LIGHT_RULE)) as LightRuleConfig;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 深合并：以默认配置为骨架，管理员可只提交需要变更的字段。 */
function mergeWithDefaults(defaults: unknown, input: unknown, path: string): unknown {
  if (input === undefined) {
    return Array.isArray(defaults) ? [...defaults] : isObject(defaults) ? { ...defaults } : defaults;
  }
  if (Array.isArray(defaults)) {
    if (!Array.isArray(input)) throw new Error(`${path} 必须是数组`);
    return [...input];
  }
  if (isObject(defaults)) {
    if (!isObject(input)) throw new Error(`${path} 必须是对象`);
    const output: Record<string, unknown> = { ...defaults };
    for (const [key, value] of Object.entries(input)) {
      output[key] = key in defaults ? mergeWithDefaults(defaults[key], value, `${path}.${key}`) : value;
    }
    return output;
  }
  return input;
}

function numberAt(value: unknown, path: string, options: { min?: number; max?: number; integer?: boolean } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} 必须是有限数字`);
  }
  if (options.integer && !Number.isInteger(value)) throw new Error(`${path} 必须是整数`);
  if (options.min !== undefined && value < options.min) throw new Error(`${path} 不能小于 ${options.min}`);
  if (options.max !== undefined && value > options.max) throw new Error(`${path} 不能大于 ${options.max}`);
  return value;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} 必须是布尔值`);
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} 必须是非空字符串`);
  return value;
}

function validateCountFactors(table: Record<string, number>, path: string): void {
  const entries = Object.entries(table);
  if (entries.length === 0) throw new Error(`${path} 不能为空`);
  for (const [key, value] of entries) {
    numberAt(value, `${path}.${key}`, { min: 0 });
  }
}

/**
 * 规范化并校验一份规则。缺省字段自动回退到内置 V1.0 默认值，
 * 因此管理员可以只提交需要覆盖的片段。
 */
export function normalizeLightRule(raw: unknown): LightRuleConfig {
  if (!isObject(raw)) throw new Error('规则必须是 JSON 对象');
  const merged = mergeWithDefaults(cloneDefaultLightRule(), raw, 'rule') as LightRuleConfig;

  stringAt(merged.meta.version, 'meta.version');
  numberAt(merged.meta.s_ref, 'meta.s_ref', { min: 1 });
  if (merged.meta.name !== undefined) stringAt(merged.meta.name, 'meta.name');
  if (merged.meta.updated_at !== undefined) stringAt(merged.meta.updated_at, 'meta.updated_at');

  numberAt(merged.branches.desperate_threshold, 'branches.desperate_threshold', { min: -1, max: 1 });
  numberAt(merged.branches.gamble_threshold, 'branches.gamble_threshold', { min: -1, max: 1 });
  numberAt(merged.branches.rush_threshold, 'branches.rush_threshold', { min: -1, max: 1 });
  numberAt(merged.branches.sheep_veto_threshold, 'branches.sheep_veto_threshold', { min: -1, max: 1 });
  if (!(merged.branches.desperate_threshold <= merged.branches.gamble_threshold)) {
    throw new Error('branches.desperate_threshold 必须不大于 gamble_threshold');
  }
  if (!(merged.branches.gamble_threshold < merged.branches.rush_threshold)) {
    throw new Error('branches.rush_threshold 必须大于 gamble_threshold，否则常规分支不存在');
  }

  for (const key of LIGHT_KEYS) {
    const params = merged.module_a[key];
    numberAt(params.k, `module_a.${key}.k`, { min: 0 });
    numberAt(params.b, `module_a.${key}.b`);
  }
  for (const flag of LIGHT_FLAGS) {
    for (const [key, value] of Object.entries(merged.module_a.targets[flag] ?? {})) {
      if (!(LIGHT_KEYS as string[]).includes(key)) throw new Error(`module_a.targets.${flag}.${key} 不是合法牌种`);
      numberAt(value, `module_a.targets.${flag}.${key}`, { min: 0, max: 1 });
    }
  }

  validateCountFactors(merged.module_b.count_factor.pig, 'module_b.count_factor.pig');
  validateCountFactors(merged.module_b.count_factor.trans, 'module_b.count_factor.trans');
  validateCountFactors(merged.module_b.count_factor.sheep, 'module_b.count_factor.sheep');
  for (const key of ['lambda1', 'lambda2', 'lambda3'] as const) {
    numberAt(merged.module_b.hA[key], `module_b.hA.${key}`, { min: 0 });
  }
  for (const key of ['gamma', 'delta', 'kappa', 'theta'] as const) {
    numberAt(merged.module_b.points[key], `module_b.points.${key}`, { min: 0 });
  }
  for (const key of ['mu1', 'mu2', 'mu3', 'eta', 'nu1', 'nu2'] as const) {
    numberAt(merged.module_b.control[key], `module_b.control.${key}`, { min: 0 });
  }
  numberAt(merged.module_b.single_spade_pig_factor, 'module_b.single_spade_pig_factor', { min: 0 });
  numberAt(merged.module_b.zero_risk_trans_floor, 'module_b.zero_risk_trans_floor', { min: 0 });
  if (!Array.isArray(merged.module_b.card_factor_range) || merged.module_b.card_factor_range.length !== 2) {
    throw new Error('module_b.card_factor_range 必须是 [下限, 上限]');
  }
  const [cardMin, cardMax] = merged.module_b.card_factor_range;
  numberAt(cardMin, 'module_b.card_factor_range[0]', { min: 0 });
  numberAt(cardMax, 'module_b.card_factor_range[1]', { min: 0 });
  if (cardMin > cardMax) throw new Error('module_b.card_factor_range 下限不能大于上限');

  booleanAt(merged.module_c.enabled, 'module_c.enabled');
  if (merged.module_c.enabled) {
    throw new Error('module_c.enabled 暂不能开启：当前尚未接入满贯概率估算器，开启后 F_slam 会恒为 1');
  }
  for (const flag of LIGHT_FLAGS) {
    for (const key of LIGHT_KEYS) {
      const weights = merged.module_c.weights[flag]?.[key];
      if (!Array.isArray(weights) || weights.length !== 2) {
        throw new Error(`module_c.weights.${flag}.${key} 必须是 [敌方权重, 己方权重]`);
      }
      numberAt(weights[0], `module_c.weights.${flag}.${key}[0]`, { min: 0 });
      numberAt(weights[1], `module_c.weights.${flag}.${key}[1]`, { min: 0 });
    }
  }

  for (const flag of LIGHT_FLAGS) {
    for (const key of LIGHT_KEYS) {
      numberAt(merged.module_d.threshold[flag][key], `module_d.threshold.${flag}.${key}`, { min: 0, max: 1 });
    }
    numberAt(merged.module_d.n_max[flag], `module_d.n_max.${flag}`, { min: 0, max: 4, integer: true });
  }
  for (const [pair, values] of Object.entries(merged.module_d.mutex)) {
    for (const flag of LIGHT_FLAGS) {
      numberAt(values[flag], `module_d.mutex.${pair}.${flag}`, { min: 0, max: 1 });
    }
  }

  if (merged.sampling.mode !== 'random' && merged.sampling.mode !== 'threshold') {
    throw new Error('sampling.mode 必须是 random 或 threshold');
  }
  stringAt(merged.sampling.seed_source, 'sampling.seed_source');

  booleanAt(merged.game.auto_light_last_one, 'game.auto_light_last_one');
  if (merged.game.light_info_mode !== 'open' && merged.game.light_info_mode !== 'hidden') {
    throw new Error('game.light_info_mode 必须是 open 或 hidden');
  }
  for (const key of ['light_seconds', 'play_seconds'] as const) {
    const seconds = numberAt(merged.game[key], `game.${key}`, { min: 0 });
    if (seconds !== 0 && (seconds < 5 || seconds > 60)) {
      throw new Error(`game.${key} 必须为 0（无读秒）或 5~60 秒`);
    }
  }

  return merged;
}

/** 解析管理员提交的 JSON 文本。 */
export function parseLightRuleJson(text: string): LightRuleConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeLightRule(parsed);
}

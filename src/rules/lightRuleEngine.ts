/**
 * 亮牌决策引擎：严格实现 `rules/拱猪亮牌规则_V1.0.md` 的模块 A→B→C→D。
 *
 * 该引擎是纯函数；规则由调用方注入（默认读取当前热插拔规则注册表），
 * 因此管理员更新规则后，下一次推荐/提交亮牌会立即使用新参数。
 */

import {
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  getRank,
  getSuit,
  type SuitIndex,
} from '../models/card';
import { ORDER, type Position } from '../models/game';
import { makeRng } from '../core/rng';
import {
  LIGHT_KEYS,
  type LightFlag,
  type LightKey,
  type LightKeyValues,
  type LightRuleConfig,
} from './lightRuleConfig';
import { getActiveLightRule } from './lightRuleRegistry';

export interface SlamProbabilityInput {
  /** 本队达成“猪满贯”（猪 + 羊 + 变压器 + 全红）的概率估算 */
  selfDragon: number;
  /** 本队达成全红的概率估算 */
  selfAllRed: number;
  /** 对方达成猪满贯的概率估算 */
  oppDragon: number;
  /** 对方达成全红的概率估算 */
  oppAllRed: number;
}

export interface LightDecisionInput {
  hand: number[];
  position: Position;
  teamSmallScore: number;
  opponentSmallScore: number;
  dealIndex: number;
  /** 发牌种子，用于可复现采样 */
  dealSeed?: number;
  /** 已公开的亮牌（open 模式）；hidden 模式应传空数组 */
  litCards?: number[];
  /** 已提交亮牌数量（hidden 模式唯一可用信息） */
  litCount?: number;
  /** 显式注入规则；缺省使用当前激活规则 */
  rule?: LightRuleConfig;
  /** 模块 C 启用时由外部估算器提供；缺省时 F_slam=1 */
  slam?: SlamProbabilityInput;
}

export interface LightDecisionDebug {
  flag: LightFlag;
  x: number;
  P_base: Partial<LightKeyValues>;
  F_card: Partial<LightKeyValues>;
  F_slam: Partial<LightKeyValues>;
  P_raw: Partial<LightKeyValues>;
  F_mutex: number;
  P_eff: Partial<LightKeyValues>;
  threshold: Partial<LightKeyValues>;
  candidates: LightKey[];
  final: LightKey[];
}

export interface LightDecision {
  cards: number[];
  keys: LightKey[];
  debug: LightDecisionDebug;
}

const KEY_TO_CARD: Record<LightKey, number> = {
  pig: PIG,
  hA: HEART_A,
  sheep: SHEEP,
  trans: TRANSFORMER,
};

const KEY_SUIT: Record<Exclude<LightKey, 'hA'>, SuitIndex> = {
  pig: 3,
  sheep: 1,
  trans: 0,
};

const KIND_INDEX: Record<LightKey, number> = { pig: 0, hA: 1, sheep: 2, trans: 3 };

const MUTEX_PAIRS: Array<[LightKey, LightKey]> = [
  ['pig', 'hA'],
  ['pig', 'sheep'],
  ['pig', 'trans'],
  ['hA', 'sheep'],
  ['hA', 'trans'],
  ['sheep', 'trans'],
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sigma(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function classifyBranch(x: number, rule: LightRuleConfig): LightFlag {
  if (x <= rule.branches.desperate_threshold) return 'desperate';
  if (x <= rule.branches.gamble_threshold) return 'gamble';
  if (x >= rule.branches.rush_threshold) return 'rush';
  return 'normal';
}

function branchStrength(x: number, flag: LightFlag, rule: LightRuleConfig): number {
  if (flag === 'desperate') {
    const span = Math.max(1e-9, 1 + rule.branches.desperate_threshold);
    return clamp((-x + rule.branches.desperate_threshold) / span, 0, 1);
  }
  if (flag === 'gamble') {
    const span = Math.max(1e-9, rule.branches.gamble_threshold - rule.branches.desperate_threshold);
    return clamp(
      (-x + rule.branches.gamble_threshold) / span,
      0,
      1,
    );
  }
  if (flag === 'rush') {
    const span = Math.max(1e-9, 1 - rule.branches.rush_threshold);
    return clamp((x - rule.branches.rush_threshold) / span, 0, 1);
  }
  return 0;
}

function moduleA(x: number, flag: LightFlag, rule: LightRuleConfig): LightKeyValues {
  const a = rule.module_a;
  const base: LightKeyValues = {
    pig: sigma(a.pig.k * x - a.pig.b),
    hA: sigma(a.hA.k * x - a.hA.b),
    sheep: sigma(-a.sheep.k * x + a.sheep.b),
    trans: sigma(a.trans.k * x - a.trans.b),
  };

  const strength = branchStrength(x, flag, rule);
  if (strength <= 0) return base;

  const targets = a.targets[flag] ?? {};
  const result: LightKeyValues = { ...base };
  for (const key of LIGHT_KEYS) {
    const target = targets[key];
    if (flag === 'rush' && (key === 'pig' || key === 'hA')) {
      // 冲锋阶段猪与红桃 A 只减不增，避免临界点自伤。
      result[key] = base[key] * (1 - strength);
      continue;
    }
    if (target === undefined) continue;
    result[key] = base[key] + strength * (target - base[key]);
  }
  for (const key of LIGHT_KEYS) result[key] = clamp(result[key], 0, 1);
  return result;
}

function cardsOfSuit(hand: number[], suit: SuitIndex): number[] {
  return hand.filter((card) => getSuit(card) === suit);
}

function topCount(cards: number[]): number {
  let count = 0;
  for (const card of cards) {
    const rank = getRank(card);
    if (rank === 12) count += 1;
    else if (rank === 11 || rank === 10) count += 0.5;
  }
  return count;
}

function lowCount(cards: number[]): number {
  return cards.filter((card) => getRank(card) <= 9).length;
}

function countFactor(table: Record<string, number>, length: number): number {
  const direct = table[String(length)];
  if (direct !== undefined) return direct;
  const plus = Object.entries(table)
    .filter(([key]) => key.endsWith('+'))
    .map(([key, value]) => [Number.parseInt(key, 10), value] as const)
    .filter(([minimum]) => Number.isFinite(minimum))
    .sort((a, b) => b[0] - a[0]);
  for (const [minimum, value] of plus) {
    if (length >= minimum) return value;
  }
  const numericKeys = Object.keys(table)
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const fallback = numericKeys.length > 0 ? table[String(numericKeys[numericKeys.length - 1])] : 1;
  return fallback ?? 1;
}

function pointWeight(card: number): number {
  const rank = getRank(card);
  if (rank === 12) return 1.0;
  if (rank === 11) return 0.85;
  if (rank === 10) return 0.65;
  if (rank === 9) return 0.45;
  if (rank === 8) return 0.3;
  return 0.15;
}

function pointsFactor(cards: number[], rule: LightRuleConfig): number {
  if (cards.length === 0) return 1;
  const weights = cards.map(pointWeight);
  const top = Math.max(...weights);
  const average = weights.reduce((sum, value) => sum + value, 0) / weights.length;
  const p = rule.module_b.points;
  const raw = 1 + p.gamma * Math.tanh(p.delta * (p.kappa * top + (1 - p.kappa) * average - p.theta));
  return clamp(raw, 0.2, 1.8);
}

function controlFactor(cards: number[], rule: LightRuleConfig): number {
  const c = rule.module_b.control;
  const gate = sigma(c.mu1 * (cards.length - 5) + c.mu2 * (topCount(cards) - 1) + c.mu3 * lowCount(cards));
  return sigma(c.eta * (gate - 0.5));
}

function heartAStructure(hand: number[]): { hearts: number[]; banned: boolean } {
  const hearts = cardsOfSuit(hand, 2);
  const hasK = hearts.some((card) => getRank(card) === 11);
  const hasQ = hearts.some((card) => getRank(card) === 10);
  // “红桃仅 A（或 A + ≤2 小牌），且无 K、Q”：常规/冲锋分支禁亮。
  const banned = hearts.includes(HEART_A) && hearts.length <= 3 && !hasK && !hasQ;
  return { hearts, banned };
}

/** 零风险变压器：红桃门/猪门持 A 或 K，或任一门的顶尖牌且该门长度 ≤2。 */
export function isZeroRiskTransformer(hand: number[]): boolean {
  const suits: SuitIndex[] = [0, 1, 2, 3];
  for (const suit of suits) {
    const cards = cardsOfSuit(hand, suit);
    const hasTop = cards.some((card) => {
      const rank = getRank(card);
      return rank === 12 || rank === 11;
    });
    if (!hasTop) continue;
    // 红桃门 / 猪门持 A 或 K：无论长度都是风险张。
    if (suit === 2 || suit === 3) return false;
    // 任一门的顶尖牌且该门长度 ≤2：也是风险张。
    if (cards.length <= 2) return false;
  }
  return true;
}

function moduleB(
  kind: LightKey,
  hand: number[],
  rule: LightRuleConfig,
): number {
  const b = rule.module_b;
  const [minFactor, maxFactor] = b.card_factor_range;

  if (kind === 'hA') {
    const { hearts, banned } = heartAStructure(hand);
    const h = b.hA;
    const feasibility = sigma(
      h.lambda1 * (hearts.length - 4) + h.lambda2 * (topCount(hearts) - 1) - h.lambda3 * lowCount(hearts),
    );
    const fHA = banned ? Math.min(feasibility, 0.1) : feasibility;
    const control = Math.max(
      controlFactor(hearts, rule),
      sigma(b.control.nu1 * (2 - hearts.length) + b.control.nu2 * (topCount(hearts) - 1.5)),
    );
    return clamp(fHA * pointsFactor(hearts, rule) * control, minFactor, maxFactor);
  }

  const suit = KEY_SUIT[kind];
  const cards = cardsOfSuit(hand, suit);
  let cnt = countFactor(b.count_factor[kind], cards.length);

  if (kind === 'pig') {
    if (cards.length === 1) cnt = Math.max(cnt, b.single_spade_pig_factor);
    if (cards.length === 3) cnt = clamp(cnt, 0.55, 0.6);
  }

  if (kind === 'trans') {
    const zeroRisk = isZeroRiskTransformer(hand);
    if (zeroRisk) cnt = Math.max(cnt, b.zero_risk_trans_floor);
    else if (cards.length === 3) cnt = Math.min(cnt, 0.9);
  }

  const factor = clamp(cnt * pointsFactor(cards, rule) * controlFactor(cards, rule), minFactor, maxFactor);
  if (kind === 'trans' && isZeroRiskTransformer(hand)) {
    return Math.max(factor, b.zero_risk_trans_floor);
  }
  return factor;
}

function moduleC(
  kind: LightKey,
  flag: LightFlag,
  rule: LightRuleConfig,
  slam?: SlamProbabilityInput,
): number {
  if (!rule.module_c.enabled || !slam) return 1;
  const [oppWeight, selfWeight] = rule.module_c.weights[flag][kind];
  const oppRisk =
    kind === 'pig' || kind === 'sheep'
      ? slam.oppDragon
      : Math.max(slam.oppAllRed, slam.oppDragon);
  const selfChance =
    kind === 'pig' || kind === 'sheep'
      ? slam.selfDragon
      : Math.max(slam.selfAllRed, slam.selfDragon);
  const raw = (1 - oppWeight * clamp(oppRisk, 0, 1)) * (1 + selfWeight * clamp(selfChance, 0, 1));
  const ranges: Record<LightKey, [number, number]> = {
    pig: [0.2, 1.6],
    hA: [0.15, 1.7],
    sheep: [0.3, 1.8],
    trans: [0.2, 2.0],
  };
  const [min, max] = ranges[kind];
  return clamp(raw, min, max);
}

function mutexFactor(set: LightKey[], flag: LightFlag, rule: LightRuleConfig): number {
  if (set.length <= 1) return 1;
  const mutex = rule.module_d.mutex;
  let factor = 1;
  for (let i = 0; i < set.length; i++) {
    for (let j = i + 1; j < set.length; j++) {
      const pair = MUTEX_PAIRS.find(
        ([a, b]) =>
          (a === set[i] && b === set[j]) || (a === set[j] && b === set[i]),
      );
      if (!pair) continue;
      const value = mutex[`${pair[0]}+${pair[1]}`]?.[flag] ?? 1;
      factor = Math.min(factor, value);
    }
  }
  if (set.length >= 3) factor = Math.min(factor, mutex.three_plus?.[flag] ?? 1);
  return factor;
}

function deriveRandom(
  seed: number,
  position: Position,
  dealIndex: number,
  kind: LightKey,
): number {
  let hash = seed >>> 0;
  hash = Math.imul(hash ^ (ORDER.indexOf(position) + 1), 0x9e3779b1) >>> 0;
  hash = Math.imul(hash ^ (dealIndex + 1), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (KIND_INDEX[kind] + 1), 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return makeRng(hash >>> 0)();
}

/**
 * 计算一次亮牌决策。
 * 返回的 cards 已经过滤“非本人持有/全局已亮/硬禁止”，可直接提交。
 */
export function decideLights(input: LightDecisionInput): LightDecision {
  const rule = input.rule ?? getActiveLightRule();
  const x = clamp(
    (input.teamSmallScore - input.opponentSmallScore) / rule.meta.s_ref,
    -1,
    1,
  );
  const flag = classifyBranch(x, rule);
  const pBase = moduleA(x, flag, rule);

  // A 模块硬否决：对方领先 800 分以上时羊概率归零，任何因子不得复活。
  if (x <= rule.branches.sheep_veto_threshold) pBase.sheep = 0;

  const alreadyLit = new Set(input.litCards ?? []);
  const heldKeys = LIGHT_KEYS.filter(
    (key) => input.hand.includes(KEY_TO_CARD[key]) && !alreadyLit.has(KEY_TO_CARD[key]),
  );

  const hearts = heartAStructure(input.hand);
  const structuralBanHA = hearts.banned && (flag === 'normal' || flag === 'rush');
  // §6.2/§6.7：猪门恰好 3 张时，常规分支硬性不推荐亮猪。
  // 绝境/搏杀分支仍保留规则文档允许的赌博性亮猪。
  const structuralBanPig = flag === 'normal' && cardsOfSuit(input.hand, 3).length === 3;

  const fCard: Partial<LightKeyValues> = {};
  const fSlam: Partial<LightKeyValues> = {};
  const pRaw: Partial<LightKeyValues> = {};
  for (const key of heldKeys) {
    let cardFactor = moduleB(key, input.hand, rule);
    // 5.4 下游约束：防止后续牌型因子反向抵消模块 A 的分支意图。
    if (flag === 'desperate' && (key === 'trans' || key === 'hA')) {
      cardFactor = Math.max(cardFactor, 1);
    }
    if (flag === 'rush' && (key === 'pig' || key === 'hA')) {
      cardFactor = Math.min(cardFactor, 1);
    }
    fCard[key] = cardFactor;
    fSlam[key] = moduleC(key, flag, rule, input.slam);
    pRaw[key] = clamp((pBase[key] ?? 0) * (fCard[key] ?? 1) * (fSlam[key] ?? 1), 0, 1);
  }

  const candidates = heldKeys
    .filter((key) => {
      if (structuralBanHA && key === 'hA') return false;
      if (structuralBanPig && key === 'pig') return false;
      if (pBase[key] <= 0) return false;
      return true;
    })
    .sort((a, b) => {
      const diff = (pRaw[b] ?? 0) - (pRaw[a] ?? 0);
      return diff !== 0 ? diff : KIND_INDEX[a] - KIND_INDEX[b];
    });

  const set: LightKey[] = [];
  const nMax = rule.module_d.n_max[flag];
  for (const key of candidates) {
    if (set.length >= nMax) break;
    if (flag === 'rush' && (key === 'pig' || key === 'hA')) {
      const hasOther = set.some((item) => item === 'pig' || item === 'hA');
      if (hasOther) continue;
    }
    const nextFactor = mutexFactor([...set, key], flag, rule);
    if ((pRaw[key] ?? 0) * nextFactor >= rule.module_d.threshold[flag][key]) {
      set.push(key);
    }
  }

  const fMutex = mutexFactor(set, flag, rule);
  const pEff: Partial<LightKeyValues> = {};
  for (const key of set) pEff[key] = clamp((pRaw[key] ?? 0) * fMutex, 0, 1);

  const final: LightKey[] = [];
  for (const key of set) {
    if (final.length >= nMax) break;
    if (rule.sampling.mode === 'threshold') {
      if ((pEff[key] ?? 0) >= rule.module_d.threshold[flag][key]) final.push(key);
      continue;
    }
    const random = deriveRandom(input.dealSeed ?? 0, input.position, input.dealIndex, key);
    if (random <= (pEff[key] ?? 0)) final.push(key);
  }

  return {
    cards: final.map((key) => KEY_TO_CARD[key]),
    keys: final,
    debug: {
      flag,
      x: round(x),
      P_base: mapValues(pBase, round),
      F_card: mapValues(fCard, round),
      F_slam: mapValues(fSlam, round),
      P_raw: mapValues(pRaw, round),
      F_mutex: round(fMutex),
      P_eff: mapValues(pEff, round),
      threshold: mapValues(rule.module_d.threshold[flag], round),
      candidates,
      final,
    },
  };
}

function mapValues(
  values: Partial<LightKeyValues>,
  transform: (value: number) => number,
): Partial<LightKeyValues> {
  const output: Partial<LightKeyValues> = {};
  for (const key of LIGHT_KEYS) {
    const value = values[key];
    if (value !== undefined) output[key] = transform(value);
  }
  return output;
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  getCard,
} from '../models/card';
import {
  DEFAULT_LIGHT_RULE,
  cloneDefaultLightRule,
  normalizeLightRule,
  parseLightRuleJson,
  type LightRuleConfig,
} from '../rules/lightRuleConfig';
import { decideLights } from '../rules/lightRuleEngine';
import {
  activateLightRule,
  getActiveLightRule,
  resetLightRuleRegistry,
} from '../rules/lightRuleRegistry';

function thresholdRule(mutator?: (rule: LightRuleConfig) => void): LightRuleConfig {
  const rule = cloneDefaultLightRule();
  rule.sampling.mode = 'threshold';
  mutator?.(rule);
  return rule;
}

function decide(hand: number[], options: {
  team?: number;
  opponent?: number;
  rule?: LightRuleConfig;
  seed?: number;
  litCards?: number[];
  position?: 'S' | 'E' | 'N' | 'W';
} = {}) {
  return decideLights({
    hand,
    position: options.position ?? 'S',
    teamSmallScore: options.team ?? 0,
    opponentSmallScore: options.opponent ?? 0,
    dealIndex: 1,
    dealSeed: options.seed ?? 123,
    litCards: options.litCards ?? [],
    rule: options.rule ?? thresholdRule(),
  });
}

describe('亮牌规则 V1.0：模块 A 分支与硬否决', () => {
  it('按相对分差分类，阈值处连续', () => {
    expect(decide([], { team: -600, opponent: 0 }).debug.flag).toBe('desperate');
    expect(decide([], { team: -599, opponent: 0 }).debug.flag).toBe('gamble');
    expect(decide([], { team: -300, opponent: 0 }).debug.flag).toBe('gamble');
    expect(decide([], { team: 0, opponent: 0 }).debug.flag).toBe('normal');
    expect(decide([], { team: 600, opponent: 0 }).debug.flag).toBe('rush');
    expect(decide([], { team: 1000, opponent: 0 }).debug.flag).toBe('rush');
  });

  it('双方同分时相对分差为 0，不触发冲锋或殉爆', () => {
    const result = decide([], { team: 900, opponent: 900 });
    expect(result.debug.x).toBe(0);
    expect(result.debug.flag).toBe('normal');
  });

  it('落后 800 分以上时羊概率归零，任何因子都不能复活', () => {
    const result = decide([SHEEP], { team: -800, opponent: 0 });
    expect(result.debug.flag).toBe('desperate');
    expect(result.debug.P_base.sheep).toBe(0);
    expect(result.debug.candidates).not.toContain('sheep');
  });

  it('冲锋到顶时猪与红桃 A 概率只减不增', () => {
    const result = decide([], { team: 1000, opponent: 0 });
    expect(result.debug.P_base.pig ?? 1).toBeLessThan(0.001);
    expect(result.debug.P_base.hA ?? 1).toBeLessThan(0.001);
  });

  it('绝境分支向目标概率插值', () => {
    const result = decide([], { team: -599, opponent: 0 });
    expect(result.debug.flag).toBe('gamble');
    expect(result.debug.P_base.pig ?? 0).toBeGreaterThan(0.6);
    expect(result.debug.P_base.hA ?? 0).toBeGreaterThan(0.55);
  });
});

describe('亮牌规则 V1.0：模块 B 牌型修正', () => {
  it('单张黑桃亮猪不再被结构性禁亮', () => {
    const result = decide([PIG], { rule: thresholdRule((rule) => {
      rule.module_d.threshold.normal.pig = 0;
      rule.module_d.n_max.normal = 2;
    }) });
    expect(result.debug.candidates).toContain('pig');
    expect(result.debug.P_raw.pig ?? 0).toBeGreaterThan(0);
  });

  it('猪门恰好 3 张时常规分支硬性不推荐亮猪，绝境分支仍可赌博性亮猪', () => {
    const hand = [PIG, getCard(3, 0), getCard(3, 1)];
    const normal = decide(hand, { rule: thresholdRule((rule) => {
      rule.module_d.threshold.normal.pig = 0;
      rule.module_d.n_max.normal = 2;
    }) });
    expect(normal.debug.candidates).not.toContain('pig');
    expect(normal.keys).not.toContain('pig');

    const desperate = decide(hand, { team: -700, opponent: 0 });
    expect(desperate.debug.flag).toBe('desperate');
    expect(desperate.debug.candidates).toContain('pig');
  });

  it('红桃仅 A（或 A+≤2 小牌）时常规分支禁亮红桃 A', () => {
    const hand = [HEART_A, getCard(2, 0), getCard(2, 1)];
    const normal = decide(hand, { rule: thresholdRule((rule) => {
      rule.module_d.threshold.normal.hA = 0;
      rule.module_d.n_max.normal = 2;
    }) });
    expect(normal.debug.candidates).not.toContain('hA');

    const desperate = decide(hand, { team: -700, opponent: 0 });
    expect(desperate.debug.flag).toBe('desperate');
    expect(desperate.debug.candidates).toContain('hA');
  });

  it('零风险变压器获得 1.30 的牌型因子下限', () => {
    const zeroRisk = [TRANSFORMER, getCard(0, 1), getCard(0, 2)];
    const risky = [...zeroRisk, HEART_A];

    const zero = decide(zeroRisk, { rule: thresholdRule((rule) => {
      rule.module_d.threshold.normal.trans = 0;
    }) });
    const risk = decide(risky, { rule: thresholdRule((rule) => {
      rule.module_d.threshold.normal.trans = 0;
    }) });

    expect(zero.debug.F_card.trans ?? 0).toBeGreaterThanOrEqual(1.3);
    expect(risk.debug.F_card.trans ?? 0).toBeLessThan(1.3);
  });
});

describe('亮牌规则 V1.0：短套结构奖励（低负分风险搏杀）', () => {
  // 以下牌型都满足“无大红桃（J 及以上）、无猪圈（♠A/K）”，并留出单缺花色。
  const lowHearts = [getCard(2, 0), getCard(2, 1), getCard(2, 2), getCard(2, 3)];
  const lowSpades = [getCard(3, 0), getCard(3, 1), getCard(3, 2), getCard(3, 3)];
  const lowDiamonds = [getCard(1, 0), getCard(1, 1), getCard(1, 2), getCard(1, 3)];
  const lowClubs = [getCard(0, 0), getCard(0, 1), getCard(0, 2), getCard(0, 3)];

  const trans2 = [TRANSFORMER, getCard(0, 0), ...lowSpades, ...lowDiamonds, ...lowHearts.slice(0, 3)];
  const trans3 = [TRANSFORMER, getCard(0, 0), getCard(0, 1), ...lowSpades, ...lowDiamonds, ...lowHearts.slice(0, 2)];
  const sheep3 = [SHEEP, getCard(1, 0), getCard(1, 1), ...lowSpades, ...lowClubs.slice(0, 3), ...lowHearts.slice(0, 3)];
  const pig4 = [PIG, getCard(3, 0), getCard(3, 1), getCard(3, 2), ...lowDiamonds, ...lowHearts, getCard(0, 0)];
  const hA4 = [HEART_A, getCard(2, 0), getCard(2, 1), getCard(2, 2), ...lowDiamonds, ...lowSpades, getCard(0, 0)];

  it('2 张草花含 ♣10 时给出 1.80 下限并在常规分支推荐亮变压器', () => {
    const result = decide(trans2);
    expect(result.debug.flag).toBe('normal');
    expect(result.debug.F_card.trans ?? 0).toBeGreaterThanOrEqual(1.8);
    expect(result.keys).toContain('trans');
  });

  it('3 张草花含 ♣10 + ♣2/♣3 时给出 1.80 下限并推荐亮变压器', () => {
    const result = decide(trans3);
    expect(result.debug.F_card.trans ?? 0).toBeGreaterThanOrEqual(1.8);
    expect(result.keys).toContain('trans');
  });

  it('恰好 3 张方片含 ♦J 时给出 1.00 下限并推荐亮羊', () => {
    const result = decide(sheep3);
    expect(result.debug.F_card.sheep ?? 0).toBeGreaterThanOrEqual(1.0);
    expect(result.keys).toContain('sheep');
  });

  it('4 张黑桃含 ♠Q 且另有单缺花色时给出 2.20 下限并推荐亮猪', () => {
    const result = decide(pig4);
    expect(result.debug.F_card.pig ?? 0).toBeGreaterThanOrEqual(2.2);
    expect(result.keys).toContain('pig');
  });

  it('4 张红桃含 ♥A 且另有单缺花色时给出 3.00 下限并推荐亮红桃 A', () => {
    const result = decide(hA4);
    expect(result.debug.F_card.hA ?? 0).toBeGreaterThanOrEqual(3.0);
    expect(result.keys).toContain('hA');
  });

  it('存在大红桃或猪圈时不触发结构奖励', () => {
    const transBigHeart = decide([
      TRANSFORMER, getCard(0, 0), getCard(2, 9),
      ...lowSpades, ...lowDiamonds, ...lowHearts.slice(0, 2),
    ]);
    expect(transBigHeart.debug.F_card.trans ?? 0).toBeLessThan(1.8);

    const pigPen = decide([
      PIG, getCard(3, 12), getCard(3, 1), getCard(3, 2),
      ...lowDiamonds, ...lowHearts, getCard(0, 0),
    ]);
    expect(pigPen.debug.F_card.pig ?? 0).toBeLessThan(2.2);
  });

  it('张数或低牌不满足时不触发结构奖励', () => {
    const transNoLow = decide([
      TRANSFORMER, getCard(0, 5), getCard(0, 6),
      ...lowSpades, ...lowDiamonds, ...lowHearts.slice(0, 2),
    ]);
    expect(transNoLow.debug.F_card.trans ?? 0).toBeLessThan(1.8);

    const sheep4 = decide([
      SHEEP, getCard(1, 0), getCard(1, 1), getCard(1, 2),
      ...lowSpades, ...lowClubs.slice(0, 3), ...lowHearts.slice(0, 2),
    ]);
    expect(sheep4.debug.F_card.sheep ?? 0).toBeLessThan(1.0);
  });

  it('没有其他单缺花色时不触发 4 张猪/红桃 A 奖励', () => {
    const pigNoShort = decide([
      PIG, getCard(3, 0), getCard(3, 1), getCard(3, 2),
      ...lowDiamonds, ...lowHearts.slice(0, 3), ...lowClubs.slice(0, 2),
    ]);
    expect(pigNoShort.debug.F_card.pig ?? 0).toBeLessThan(2.2);

    const hANoShort = decide([
      HEART_A, getCard(2, 0), getCard(2, 1), getCard(2, 2),
      ...lowDiamonds, ...lowSpades.slice(0, 3), ...lowClubs.slice(0, 2),
    ]);
    expect(hANoShort.debug.F_card.hA ?? 0).toBeLessThan(3.0);
  });

  it('shape_bonus.enabled 关闭后不再应用结构奖励', () => {
    const result = decide(trans2, { rule: thresholdRule((rule) => {
      rule.module_b.shape_bonus.enabled = false;
    }) });
    expect(result.debug.F_card.trans ?? 0).toBeLessThan(1.8);
  });
});

describe('亮牌规则 V1.0：模块 A 的下游约束（5.4）', () => {
  it('殉爆分支对变压器与红桃 A 的牌型因子设 1.0 下限', () => {
    const hand = [HEART_A, TRANSFORMER, getCard(0, 1), getCard(2, 1)];
    const result = decide(hand, { team: -700, opponent: 0 });

    expect(result.debug.flag).toBe('desperate');
    expect(result.debug.F_card.hA ?? 0).toBeGreaterThanOrEqual(1);
    expect(result.debug.F_card.trans ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('冲锋分支对猪与红桃 A 的牌型因子设 1.0 上限', () => {
    const hand = [
      PIG,
      HEART_A,
      getCard(3, 12),
      getCard(3, 11),
      getCard(3, 9),
      getCard(2, 11),
      getCard(2, 10),
      getCard(2, 9),
      getCard(2, 8),
    ];
    const result = decide(hand, { team: 1000, opponent: 0 });

    expect(result.debug.flag).toBe('rush');
    expect(result.debug.F_card.pig ?? 0).toBeLessThanOrEqual(1);
    expect(result.debug.F_card.hA ?? 0).toBeLessThanOrEqual(1);
  });
});

describe('亮牌规则 V1.0：模块 D 互斥、上限与采样', () => {
  it('常规分支最多亮 2 张，并对最终集合统一应用互斥因子', () => {
    const result = decide([PIG, HEART_A, SHEEP, TRANSFORMER], {
      rule: thresholdRule((rule) => {
        for (const key of ['pig', 'hA', 'sheep', 'trans'] as const) {
          rule.module_d.threshold.normal[key] = 0;
        }
      }),
    });
    expect(result.keys).toHaveLength(2);
    expect(result.debug.F_mutex).toBeLessThanOrEqual(0.85);
  });

  it('threshold 模式达到阈值即亮，结果确定', () => {
    const rule = thresholdRule((rule) => {
      rule.module_d.threshold.normal.pig = 0;
      rule.module_d.n_max.normal = 1;
    });
    expect(decide([PIG], { rule }).keys).toEqual(['pig']);
    expect(decide([PIG], { rule }).keys).toEqual(['pig']);
  });

  it('random 模式由发牌种子派生，可复现且不读取他人信息', () => {
    const rule = thresholdRule((rule) => {
      rule.sampling.mode = 'random';
      rule.module_d.threshold.normal.sheep = 0;
      rule.module_d.n_max.normal = 1;
    });
    const hand = [SHEEP];
    const first = decide(hand, { rule, seed: 42 });
    const second = decide(hand, { rule, seed: 42 });
    expect(first.keys).toEqual(second.keys);
  });

  it('全局已亮的牌不会再次被推荐', () => {
    const result = decide([PIG, SHEEP], {
      litCards: [PIG],
      rule: thresholdRule((rule) => {
        rule.module_d.threshold.normal.pig = 0;
        rule.module_d.threshold.normal.sheep = 0;
      }),
    });
    expect(result.keys).not.toContain('pig');
  });
});

describe('亮牌规则热插拔', () => {
  beforeEach(() => resetLightRuleRegistry());
  afterEach(() => resetLightRuleRegistry());

  it('应用新规则后无需重启，决策立即读取新参数', () => {
    const hand = [PIG];
    const initialRule = thresholdRule((rule) => {
      rule.module_d.threshold.normal.pig = 0;
    });
    expect(decide(hand, { rule: initialRule }).keys).toEqual(['pig']);

    const custom = cloneDefaultLightRule();
    custom.meta.version = 'hot-2.0';
    custom.sampling.mode = 'threshold';
    custom.module_d.n_max.normal = 0;
    activateLightRule(custom);

    expect(getActiveLightRule().meta.version).toBe('hot-2.0');
    expect(decideLights({
      hand,
      position: 'S',
      teamSmallScore: 0,
      opponentSmallScore: 0,
      dealIndex: 1,
    }).keys).toEqual([]);
  });

  it('支持只提交局部字段，其余自动沿用内置默认值', () => {
    const config = normalizeLightRule({ meta: { version: '2.1' }, sampling: { mode: 'threshold' } });
    expect(config.meta.version).toBe('2.1');
    expect(config.meta.s_ref).toBe(DEFAULT_LIGHT_RULE.meta.s_ref);
    expect(config.module_d.n_max.normal).toBe(DEFAULT_LIGHT_RULE.module_d.n_max.normal);
  });

  it('非法规则被拒绝，且不会破坏当前激活规则', () => {
    expect(() => parseLightRuleJson('{bad json')).toThrow(/JSON 解析失败/);
    expect(() => activateLightRule({ module_d: { n_max: { normal: -1 } } })).toThrow();
    expect(getActiveLightRule().meta.version).toBe(DEFAULT_LIGHT_RULE.meta.version);
  });

  it('模块 C 在未接入满贯概率估算器前禁止启用', () => {
    expect(() => normalizeLightRule({ module_c: { enabled: true } })).toThrow(/module_c\.enabled/);
  });

  it('恢复默认后重新使用内置 V1.0', () => {
    const custom = cloneDefaultLightRule();
    custom.meta.version = 'temporary';
    activateLightRule(custom);
    expect(getActiveLightRule().meta.version).toBe('temporary');

    resetLightRuleRegistry();
    expect(getActiveLightRule().meta.version).toBe(DEFAULT_LIGHT_RULE.meta.version);
  });
});

describe('亮牌规则 V1.0：配置校验', () => {
  it('拒绝会让常规分支消失的阈值组合', () => {
    expect(() => normalizeLightRule({ branches: { rush_threshold: -0.4 } })).toThrow(/rush_threshold/);
  });

  it('读秒只允许 0（无读秒）或 5~60 秒', () => {
    expect(() => normalizeLightRule({ game: { light_seconds: 4 } })).toThrow(/5~60/);
    expect(normalizeLightRule({ game: { light_seconds: 0 } }).game.light_seconds).toBe(0);
    expect(normalizeLightRule({ game: { play_seconds: 60 } }).game.play_seconds).toBe(60);
  });
});

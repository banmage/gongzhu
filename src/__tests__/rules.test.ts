import { describe, expect, it } from 'vitest';
import {
  CLUB_2,
  PIG,
  getCard,
  type SuitIndex,
} from '../models/card';
import type { CardPlay, SuitStatus } from '../models/game';
import {
  determineTrickWinner,
  evaluateDealLimit,
  evaluatePigHeads,
  getLegalCards,
  pickTimeoutCard,
} from '../core/rules';

const NOT_LED: Record<SuitIndex, SuitStatus> = {
  0: 'NOT_LED',
  1: 'NOT_LED',
  2: 'NOT_LED',
  3: 'NOT_LED',
};

const SPADE_A = getCard(3, 12);
const SPADE_2 = getCard(3, 0);
const HEART_2 = getCard(2, 0);

function legal(hand: number[], overrides: Partial<Parameters<typeof getLegalCards>[0]> = {}) {
  return getLegalCards({
    hand,
    leadSuit: null,
    isFirstLedSuit: false,
    litCards: [],
    suitStatus: NOT_LED,
    ...overrides,
  });
}

describe('合法出牌：跟牌与首轮限制', () => {
  it('有领出花色必须跟同花色', () => {
    const hand = [SPADE_A, SPADE_2, HEART_2];
    expect(legal(hand, { leadSuit: 3 }).sort()).toEqual([SPADE_A, SPADE_2].sort());
  });

  it('缺门可以任意垫牌', () => {
    const hand = [HEART_2, CLUB_2];
    expect(legal(hand, { leadSuit: 3 }).sort()).toEqual([HEART_2, CLUB_2].sort());
  });

  it('首次领出花色的一墩：有同花色非亮牌时，受限制亮牌不能跟', () => {
    const hand = [PIG, SPADE_A, HEART_2];
    const result = legal(hand, {
      leadSuit: 3,
      isFirstLedSuit: true,
      litCards: [PIG],
    });
    expect(result).toEqual([SPADE_A]);
  });

  it('该花色只剩受限制亮牌时必须出', () => {
    const hand = [PIG, HEART_2];
    const result = legal(hand, {
      leadSuit: 3,
      isFirstLedSuit: true,
      litCards: [PIG],
    });
    expect(result).toEqual([PIG]);
  });

  it('该花色首轮限制已解除后，亮牌可以正常跟出', () => {
    const hand = [PIG, SPADE_A];
    const result = legal(hand, {
      leadSuit: 3,
      isFirstLedSuit: false,
      litCards: [PIG],
      suitStatus: { ...NOT_LED, 3: 'LED' },
    });
    expect(result.sort()).toEqual([PIG, SPADE_A].sort());
  });

  it('领出时不能主动领出受首轮限制的亮牌', () => {
    const hand = [PIG, HEART_2];
    const result = legal(hand, { leadSuit: null, litCards: [PIG] });
    expect(result).toEqual([HEART_2]);
  });

  it('手中只剩受限制亮牌时，兜底允许领出', () => {
    const hand = [PIG];
    const result = legal(hand, { leadSuit: null, litCards: [PIG] });
    expect(result).toEqual([PIG]);
  });

  it('某花色此前仅被垫牌、未被领出，不消耗首轮限制', () => {
    const hand = [PIG, SPADE_A];
    // 黑桃尚未作为领出花色；但本墩领出花色是红桃，玩家缺门，可以任意垫牌
    const result = legal(hand, {
      leadSuit: 2,
      isFirstLedSuit: true,
      litCards: [PIG],
    });
    expect(result.sort()).toEqual([PIG, SPADE_A].sort());
  });

  it('首引花色无限制：领出时可按手中任意非受限牌领出', () => {
    const hand = [CLUB_2, PIG, HEART_2];
    expect(legal(hand, { leadSuit: null }).sort()).toEqual([CLUB_2, PIG, HEART_2].sort());
  });
});

describe('赢墩与超时出牌', () => {
  it('同花色点数最大者赢墩，不同花色不比较大小', () => {
    const plays: CardPlay[] = [
      { position: 'S', card: getCard(2, 3) }, // ♥5
      { position: 'E', card: getCard(2, 11) }, // ♥K
      { position: 'N', card: SPADE_A }, // 垫牌
      { position: 'W', card: getCard(2, 0) }, // ♥2
    ];
    expect(determineTrickWinner(plays)).toBe('E');
  });

  it('超时自动出牌优先非计分牌，再按点数最小', () => {
    const hand = [getCard(2, 0), getCard(3, 0), getCard(3, 12)]; // ♥2, ♠2, ♠A
    expect(pickTimeoutCard(hand)).toBe(getCard(3, 0));
  });
});

describe('画猪头判定（6.2 / 6.4 / 6.5）', () => {
  it('仅 A ≤ -1000：A 画1头，B 胜', () => {
    const result = evaluatePigHeads(-1000, 0)!;
    expect(result.newPigHeads).toEqual({ A: 1, B: 0 });
    expect(result.winner).toBe('B');
    expect(result.loser).toBe('A');
    expect(result.result).toBe('B_WIN');
  });

  it('仅 A ≥ +1000：B 画2头，A 胜', () => {
    const result = evaluatePigHeads(1000, 0)!;
    expect(result.newPigHeads).toEqual({ A: 0, B: 2 });
    expect(result.winner).toBe('A');
  });

  it('仅 B ≤ -1000：B 画1头，A 胜', () => {
    const result = evaluatePigHeads(0, -1200)!;
    expect(result.newPigHeads).toEqual({ A: 0, B: 1 });
    expect(result.winner).toBe('A');
  });

  it('仅 B ≥ +1000：A 画2头，B 胜', () => {
    const result = evaluatePigHeads(0, 1500)!;
    expect(result.newPigHeads).toEqual({ A: 2, B: 0 });
    expect(result.winner).toBe('B');
  });

  it('A ≤ -1000 且 B ≥ +1000：A 画3头，B 胜', () => {
    const result = evaluatePigHeads(-1000, 1000)!;
    expect(result.newPigHeads).toEqual({ A: 3, B: 0 });
    expect(result.winner).toBe('B');
  });

  it('A ≥ +1000 且 B ≤ -1000：B 画3头，A 胜', () => {
    const result = evaluatePigHeads(1000, -1000)!;
    expect(result.newPigHeads).toEqual({ A: 0, B: 3 });
    expect(result.winner).toBe('A');
  });

  it('双方均 ≥ +1000：各画2头，按小分裁决（小分低者负）', () => {
    const result = evaluatePigHeads(1000, 1500)!;
    expect(result.newPigHeads).toEqual({ A: 2, B: 2 });
    expect(result.loser).toBe('A');
    expect(result.winner).toBe('B');
  });

  it('双方均 ≤ -1000：各画1头，按小分裁决（小分低者负）', () => {
    const result = evaluatePigHeads(-1500, -1000)!;
    expect(result.newPigHeads).toEqual({ A: 1, B: 1 });
    expect(result.loser).toBe('A');
    expect(result.winner).toBe('B');
  });

  it('双方小分相同且新增猪头相同：判和', () => {
    const result = evaluatePigHeads(1000, 1000)!;
    expect(result.result).toBe('DRAW');
    expect(result.winner).toBe('NONE');
  });

  it('未达到阈值不画头', () => {
    expect(evaluatePigHeads(999, -999)).toBeNull();
  });

  it('6.5 兜底：小分更低方画1头；相同各画1头判和', () => {
    expect(evaluateDealLimit(100, -100)).toMatchObject({
      newPigHeads: { A: 0, B: 1 },
      winner: 'A',
      endReason: 'DEAL_LIMIT',
    });
    expect(evaluateDealLimit(100, 100)).toMatchObject({
      newPigHeads: { A: 1, B: 1 },
      winner: 'NONE',
      result: 'DRAW',
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  CLUB_2,
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  getCard,
  type SuitIndex,
} from '../models/card';
import type { CardPlay, Position, SuitStatus } from '../models/game';
import {
  allScoringCardsCollected,
  determineTrickWinner,
  evaluateDealConclusion,
  evaluateDealLimit,
  evaluatePigHeads,
  getLegalCards,
  hasOnlyHarmlessRemaining,
  isAllRedStillPossible,
  keyCardsCollected,
  leaderHoldsAllTopCards,
  pickTimeoutCard,
  transformerUnaffectedByRemainingHearts,
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

describe('提前结束本副判定', () => {
  function hands(partial: Partial<Record<Position, number[]>> = {}): Record<Position, number[]> {
    return { S: [], E: [], N: [], W: [], ...partial };
  }

  function collected(
    partial: Partial<Record<Position, number[]>> = {},
  ): Record<Position, number[]> {
    return { S: [], E: [], N: [], W: [], ...partial };
  }

  /** 红桃 ♥5~♥A（10 张有分红桃） */
  const pointHearts = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((rank) => getCard(2, rank));
  /** 无分红桃 ♥4/♥3/♥2 */
  const harmlessHearts = [0, 1, 2].map((rank) => getCard(2, rank));

  it('全部红桃与猪/羊/变压器收齐后，判定所有计分牌已有归属', () => {
    const allHearts = Array.from({ length: 13 }, (_, rank) => getCard(2, rank));
    expect(
      allScoringCardsCollected(collected({ S: [PIG, ...allHearts], E: [SHEEP, TRANSFORMER] })),
    ).toBe(true);
    expect(
      allScoringCardsCollected(collected({ S: [PIG, ...allHearts.slice(0, 12)], E: [SHEEP, TRANSFORMER] })),
    ).toBe(false);
  });

  it('剩余牌只允许 ♥4/♥3/♥2 和其他无分牌', () => {
    expect(
      hasOnlyHarmlessRemaining(
        hands({ S: [...harmlessHearts, getCard(0, 0), getCard(1, 1), getCard(3, 2)] }),
      ),
    ).toBe(true);
    expect(hasOnlyHarmlessRemaining(hands({ S: [getCard(2, 3)] }))).toBe(false); // ♥5
    expect(hasOnlyHarmlessRemaining(hands({ S: [PIG] }))).toBe(false);
    expect(hasOnlyHarmlessRemaining(hands({ S: [TRANSFORMER] }))).toBe(false);
  });

  it('已有两家收过红桃时，任何人的全红都不可能', () => {
    expect(isAllRedStillPossible(collected({ S: [pointHearts[0]] }))).toBe(true);
    expect(
      isAllRedStillPossible(collected({ S: [pointHearts[0]], E: [pointHearts[1]] })),
    ).toBe(false);
  });

  it('变压器独拿者若还没收过其他计分牌，剩余红桃会改变其结算', () => {
    const remaining = [getCard(2, 0)]; // ♥2
    expect(
      transformerUnaffectedByRemainingHearts(
        collected({ S: [TRANSFORMER, SHEEP] }),
        remaining,
      ),
    ).toBe(true);
    expect(
      transformerUnaffectedByRemainingHearts(collected({ S: [TRANSFORMER] }), remaining),
    ).toBe(false);
    expect(
      transformerUnaffectedByRemainingHearts(collected({ S: [TRANSFORMER] }), []),
    ).toBe(true);
  });

  it('领出者同花色全部大于其他家剩余牌时，才视为全部最大牌', () => {
    const SPADE_A = getCard(3, 12);
    const SPADE_K = getCard(3, 11);
    const SPADE_Q = getCard(3, 10);
    const SPADE_J = getCard(3, 9);
    const SPADE_2 = getCard(3, 0);
    const SPADE_3 = getCard(3, 1);

    expect(
      leaderHoldsAllTopCards(
        hands({ S: [SPADE_A, SPADE_K], E: [SPADE_Q], N: [SPADE_J], W: [SPADE_2] }),
        'S',
      ),
    ).toBe(true);
    expect(
      leaderHoldsAllTopCards(
        hands({ S: [SPADE_A, SPADE_2], E: [SPADE_3], N: [SPADE_Q], W: [SPADE_J] }),
        'S',
      ),
    ).toBe(false);
    expect(leaderHoldsAllTopCards(hands({ S: [SPADE_2], E: [SPADE_A] }), 'S')).toBe(false);
    expect(leaderHoldsAllTopCards(hands({ S: [], E: [SPADE_A] }), 'S')).toBe(false);
  });

  it('优先按“全部最大牌”结束，并亮开剩余手牌', () => {
    const result = evaluateDealConclusion(
      hands({ S: [getCard(3, 12)], E: [getCard(3, 11)] }),
      collected({ S: [PIG, SHEEP, TRANSFORMER, HEART_A] }),
      'S',
    );
    expect(result).toEqual({ reason: 'TOP_CARDS', reveal: true });
  });

  it('全部计分牌已有归属时提前结束', () => {
    const allHearts = Array.from({ length: 13 }, (_, rank) => getCard(2, rank));
    const result = evaluateDealConclusion(
      hands({ S: [getCard(0, 0)], E: [getCard(3, 0)], N: [getCard(3, 12)] }),
      collected({ S: [PIG, ...allHearts], E: [SHEEP, TRANSFORMER] }),
      'E',
    );
    expect(result).toEqual({ reason: 'ALL_SCORING_COLLECTED', reveal: false });
  });

  it('剩余无分牌且不影响全红/变压器时提前结束', () => {
    const half = pointHearts.slice(0, 5);
    const rest = pointHearts.slice(5);
    const result = evaluateDealConclusion(
      hands({ S: [harmlessHearts[0]], E: [harmlessHearts[1]], N: [harmlessHearts[2]] }),
      collected({
        S: [PIG, ...half],
        E: [SHEEP, TRANSFORMER, ...rest],
      }),
      'S',
    );
    expect(result).toEqual({ reason: 'HARMLESS_REMAINDER', reveal: false });
  });

  it('全红仍可能时，不因剩余无分牌提前结束', () => {
    const result = evaluateDealConclusion(
      hands({ S: [harmlessHearts[0]], E: [harmlessHearts[1]], N: [harmlessHearts[2]] }),
      collected({ S: [PIG, SHEEP, TRANSFORMER, ...pointHearts] }),
      'S',
    );
    expect(result).toBeNull();
  });

  it('单独变压器持有者可能获得剩余红桃时，不提前结束（避免 +50 变 0）', () => {
    const half = pointHearts.slice(0, 5);
    const rest = pointHearts.slice(5);
    const result = evaluateDealConclusion(
      hands({ S: [harmlessHearts[0]], E: [harmlessHearts[1]], N: [harmlessHearts[2]] }),
      collected({
        S: [PIG, ...half],
        E: [SHEEP, ...rest],
        N: [TRANSFORMER],
      }),
      'S',
    );
    expect(result).toBeNull();
  });
});

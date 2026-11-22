import { describe, expect, it } from 'vitest';
import {
  PIG,
  SHEEP,
  TRANSFORMER,
  getCard,
  type SuitIndex,
} from '../models/card';
import {
  type CardPlay,
  type DealState,
  type Position,
  type SuitStatus,
  type Trick,
} from '../models/game';
import { choosePlay } from '../core/ai';
import {
  buildPlayObservation,
  type PlayObservation,
} from '../core/aiObservation';
import { buildPublicKnowledge } from '../core/aiKnowledge';
import {
  analyzeRemainingCards,
  estimateCollectionProbabilities,
  estimateThreats,
  estimateTrickWinnerProbabilities,
} from '../core/aiThreat';
import {
  endgameRetentionScore,
  scoreCandidate,
} from '../core/aiPolicy';

const NOT_LED: Record<SuitIndex, SuitStatus> = {
  0: 'NOT_LED',
  1: 'NOT_LED',
  2: 'NOT_LED',
  3: 'NOT_LED',
};

function observation(overrides: Partial<PlayObservation> = {}): PlayObservation {
  const base: PlayObservation = {
    self: 'S',
    partner: 'N',
    team: 'A',
    opponentTeam: 'B',
    ownHand: [],
    ownOriginalHand: [],
    handSizes: { S: 13, E: 13, N: 13, W: 13 },
    currentTrick: {
      leader: 'S',
      plays: [],
      leadSuit: null,
      isFirstLed: false,
      isLastToPlay: false,
    },
    trickHistory: [],
    collected: { S: [], E: [], N: [], W: [] },
    litCards: [],
    litBy: {},
    autoLitCards: [],
    firstLedSuitStatus: { ...NOT_LED },
    legalCards: [],
    round: {
      number: 1,
      isExtra: false,
      smallScores: { A: 0, B: 0 },
      dealsPlayed: 1,
      dealLimit: 20,
      lastPigCollector: null,
    },
    match: {
      format: 5,
      totalPigHeads: { A: 0, B: 0 },
      rounds: [],
    },
    deal: {
      index: 1,
      leader: 'S',
      openingDeal: false,
      seed: 12345,
    },
    samplingSeed: 987654321,
  };
  return {
    ...base,
    ...overrides,
    currentTrick: { ...base.currentTrick, ...(overrides.currentTrick ?? {}) },
    collected: { ...base.collected, ...(overrides.collected ?? {}) },
    round: { ...base.round, ...(overrides.round ?? {}) },
    match: { ...base.match, ...(overrides.match ?? {}) },
    deal: { ...base.deal, ...(overrides.deal ?? {}) },
  };
}

function play(position: Position, card: number): CardPlay {
  return { position, card };
}

function threatFor(obs: PlayObservation) {
  const knowledge = buildPublicKnowledge(obs);
  return { knowledge, threat: estimateThreats(obs, knowledge) };
}

function emptyTrick(leader: Position): Trick {
  return {
    leader,
    plays: [],
    winner: null,
    points: 0,
    firstLedSuit: null,
    isFirstLed: false,
  };
}

/** 构造同一公开局面、但隐藏手牌不同的两副牌。 */
function dealWithHiddenHands(
  ownHand: number[],
  hidden: Record<Exclude<Position, 'S'>, number[]>,
): DealState {
  const hands: Record<Position, number[]> = {
    S: [...ownHand],
    E: [...hidden.E],
    N: [...hidden.N],
    W: [...hidden.W],
  };
  return {
    index: 1,
    seed: 20261122,
    hands,
    originalHands: {
      S: [...ownHand],
      E: [...hidden.E],
      N: [...hidden.N],
      W: [...hidden.W],
    },
    leader: 'S',
    openingDeal: false,
    litCards: [],
    litBy: {},
    autoLitCards: [],
    submissions: { S: [], E: [], N: [], W: [] },
    submitted: { S: true, E: true, N: true, W: true },
    allKeyCardsLit: false,
    firstLedSuitStatus: { ...NOT_LED },
    tricks: [],
    currentTrick: emptyTrick('S'),
    nextPlayer: 'S',
    collected: { S: [], E: [], N: [], W: [] },
    pigCollector: null,
    phase: 'playing',
    score: null,
    lastAction: null,
  };
}

describe('出牌概率层：硬事实与结构约束', () => {
  it('其他家已收红桃时，该家全红概率立即归零', () => {
    const obs = observation({
      collected: { S: [], E: [getCard(2, 12), getCard(2, 11)], N: [], W: [] },
      ownHand: [getCard(2, 0)],
    });
    const { threat } = threatFor(obs);
    expect(threat.seat.E.pAllRed).toBeGreaterThan(0);
    expect(threat.seat.N.pAllRed).toBe(0);
    expect(threat.seat.W.pAllRed).toBe(0);
  });

  it('收齐 13 张红桃时全红为 1，且满贯不超过全红', () => {
    const hearts = Array.from({ length: 13 }, (_, rank) => getCard(2, rank));
    const obs = observation({
      collected: {
        S: [],
        E: [PIG, SHEEP, TRANSFORMER, ...hearts],
        N: [],
        W: [],
      },
    });
    const { threat } = threatFor(obs);
    expect(threat.seat.E.pAllRed).toBe(1);
    expect(threat.seat.E.pGrandSlam).toBeLessThanOrEqual(threat.seat.E.pAllRed);
    expect(threat.seat.E.pGrandSlam).toBeCloseTo(1, 5);
  });

  it('猪已收时归属概率变为 0/1', () => {
    const obs = observation({
      collected: { S: [], E: [PIG], N: [], W: [] },
    });
    const { threat } = threatFor(obs);
    expect(threat.seat.E.pPig).toBeCloseTo(1, 5);
    expect(threat.seat.S.pPig).toBe(0);
  });

  it('当前墩从北家领出时，后续玩家顺序按循环顺序推导，南家仍可能赢墩', () => {
    const spadeTwo = getCard(3, 0);
    const spadeThree = getCard(3, 1);
    const spadeAce = getCard(3, 12);
    const obs = observation({
      ownHand: [spadeAce],
      handSizes: { S: 1, E: 13, N: 13, W: 13 },
      currentTrick: {
        leader: 'N',
        plays: [play('N', spadeTwo), play('W', spadeThree)],
        leadSuit: 3,
        isFirstLed: false,
        isLastToPlay: false,
      },
    });

    const { knowledge } = threatFor(obs);
    const pWin = estimateTrickWinnerProbabilities(obs.currentTrick.plays, knowledge);

    // 西家已出牌，后面还应轮到南家、东家；不能因为 ORDER 截断而漏掉南家。
    expect(pWin.S).toBeGreaterThan(0);
    expect(pWin.W).toBeLessThan(1);
  });

  it('估计自己的赢墩概率时，不把自己的大牌重复抵扣对手的大牌', () => {
    const spadeAce = getCard(3, 12);
    const spadeKing = getCard(3, 11);
    const spadeJack = getCard(3, 9);
    const obs = observation({
      ownHand: [spadeAce, spadeKing, spadeJack],
      handSizes: { S: 3, E: 13, N: 13, W: 13 },
    });

    const { knowledge } = threatFor(obs);
    const probabilities = estimateCollectionProbabilities(spadeJack, knowledge);

    // 外面只剩 ♠Q 比 ♠J 大，胜率不应接近 1。
    expect(probabilities.S).toBeLessThan(0.9);
    expect(probabilities.S).toBeGreaterThan(0.5);
  });

  it('搭档收变且小计为负时，触发变压器保护模式', () => {
    const obs = observation({
      collected: {
        S: [],
        E: [],
        N: [TRANSFORMER, getCard(2, 11), getCard(2, 10)],
        W: [],
      },
      ownHand: [getCard(2, 0)],
    });
    const { threat } = threatFor(obs);
    expect(threat.seat.N.pTransformerNegative).toBeGreaterThan(0.4);
    expect(threat.modes).toContain('protect-transformer');
  });
});

describe('出牌概率层：团队配合与破坏', () => {
  it('搭档收变且本墩红桃为负时，自己用大红桃吃入保护搭档', () => {
    const heartTen = getCard(2, 8);
    const heartKing = getCard(2, 11);
    const heartThree = getCard(2, 1);
    const heartAce = getCard(2, 12);
    const heartTwo = getCard(2, 0);

    const obs = observation({
      collected: {
        S: [],
        E: [],
        N: [TRANSFORMER, getCard(2, 9), getCard(2, 10)],
        W: [],
      },
      ownHand: [heartAce, heartTwo],
      currentTrick: {
        leader: 'E',
        plays: [play('E', heartTen), play('N', heartKing), play('W', heartThree)],
        leadSuit: 2,
        isFirstLed: false,
        isLastToPlay: true,
      },
      legalCards: [heartAce, heartTwo],
      handSizes: { S: 2, E: 13, N: 13, W: 13 },
    });

    const { knowledge, threat } = threatFor(obs);
    expect(threat.modes).toContain('protect-transformer');
    expect(scoreCandidate(heartAce, obs, knowledge, threat)).toBeGreaterThan(
      scoreCandidate(heartTwo, obs, knowledge, threat),
    );
    expect(choosePlay(obs)).toBe(heartAce);
  });

  it('敌方任意一家接近满贯时，愿意用大红桃破红', () => {
    const heartTen = getCard(2, 8);
    const heartTwo = getCard(2, 0);
    const heartThree = getCard(2, 1);
    const heartAce = getCard(2, 12);
    const heartFour = getCard(2, 2);

    const obs = observation({
      ownHand: [heartAce, heartFour],
      currentTrick: {
        leader: 'E',
        plays: [play('E', heartTen), play('N', heartTwo), play('W', heartThree)],
        leadSuit: 2,
        isFirstLed: false,
        isLastToPlay: true,
      },
      legalCards: [heartAce, heartFour],
      handSizes: { S: 2, E: 1, N: 13, W: 13 },
    });

    const { knowledge, threat } = threatFor(obs);
    // 概率层已从公开信息给出估计；这里直接抬高敌方满贯威胁，
    // 验证“破满贯”模式下评分确实愿意用大红桃吃入。
    threat.seat.E.pAllRed = 0.6;
    threat.seat.E.pGrandSlam = 0.6;
    threat.opp.pAllRedAny = 0.6;
    threat.opp.pGrandSlamAny = 0.6;
    threat.modes = ['break-opp-slam', 'break-opp-allred'];

    expect(scoreCandidate(heartAce, obs, knowledge, threat)).toBeGreaterThan(
      scoreCandidate(heartFour, obs, knowledge, threat),
    );
  });

  it('搭档接近全红/满贯时，优先把大红桃喂给搭档而不是抢墩', () => {
    const partnerHearts = Array.from({ length: 8 }, (_, rank) => getCard(2, rank));
    const heartQueen = getCard(2, 10);
    const heartTen = getCard(2, 8);

    const obs = observation({
      collected: {
        S: [],
        E: [],
        N: [PIG, SHEEP, TRANSFORMER, ...partnerHearts],
        W: [],
      },
      ownHand: [heartQueen, heartTen],
      currentTrick: {
        leader: 'E',
        plays: [play('E', getCard(2, 11)), play('N', getCard(2, 12)), play('W', getCard(2, 9))],
        leadSuit: 2,
        isFirstLed: false,
        isLastToPlay: true,
      },
      legalCards: [heartQueen, heartTen],
      handSizes: { S: 2, E: 13, N: 1, W: 13 },
    });

    const { knowledge, threat } = threatFor(obs);
    expect(threat.modes).toContain('partner-allred');
    expect(threat.modes).toContain('partner-slam');
    expect(scoreCandidate(heartQueen, obs, knowledge, threat)).toBeGreaterThan(
      scoreCandidate(heartTen, obs, knowledge, threat),
    );
    expect(choosePlay(obs)).toBe(heartQueen);
  });

  it('敌方三张关键牌全收且红桃过半时，即使概率不高也按满贯/全红破坏处理', () => {
    const collectedHearts = Array.from({ length: 8 }, (_, rank) => getCard(2, rank));
    const heartTen = getCard(2, 8);
    const heartAce = getCard(2, 12);

    const obs = observation({
      collected: {
        S: [],
        E: [PIG, SHEEP, TRANSFORMER, ...collectedHearts],
        N: [],
        W: [],
      },
      ownHand: [heartAce, heartTen],
      currentTrick: {
        leader: 'E',
        plays: [play('E', getCard(2, 11)), play('N', getCard(2, 10)), play('W', getCard(2, 9))],
        leadSuit: 2,
        isFirstLed: false,
        isLastToPlay: true,
      },
      legalCards: [heartAce, heartTen],
      handSizes: { S: 2, E: 5, N: 13, W: 13 },
    });

    const { knowledge, threat } = threatFor(obs);
    expect(threat.opp.maxGrandSlamProgress).toBe(1);
    expect(threat.opp.maxAllRedProgress).toBeCloseTo(8 / 13, 5);
    expect(threat.modes).toContain('break-opp-slam');
    expect(threat.modes).toContain('break-opp-allred');
    expect(scoreCandidate(heartAce, obs, knowledge, threat)).toBeGreaterThan(
      scoreCandidate(heartTen, obs, knowledge, threat),
    );
    expect(choosePlay(obs)).toBe(heartAce);
  });
});

describe('出牌概率层：残局留牌原则', () => {
  const bigHearts = [getCard(2, 12), getCard(2, 11), getCard(2, 10), getCard(2, 9)];

  it('只剩羊和变压器时，尽量保留大牌，先出小牌', () => {
    const diamondAce = getCard(1, 12);
    const clubTwo = getCard(0, 0);
    const obs = observation({
      collected: {
        S: [],
        E: [PIG, ...bigHearts],
        N: [],
        W: [],
      },
      ownHand: [diamondAce, clubTwo],
      legalCards: [diamondAce, clubTwo],
      handSizes: { S: 2, E: 0, N: 13, W: 13 },
      litCards: [SHEEP, TRANSFORMER],
      litBy: { [SHEEP]: 'W', [TRANSFORMER]: 'N' },
    });

    const { knowledge, threat } = threatFor(obs);
    expect(threat.remaining.highValueEndgame).toBe(true);
    expect(endgameRetentionScore(diamondAce, knowledge, threat, 0, true)).toBeLessThan(
      endgameRetentionScore(clubTwo, knowledge, threat, 0, true),
    );
    expect(choosePlay(obs)).toBe(clubTwo);
  });

  it('只剩亮猪和负向变压器时，尽量留小牌，优先脱手大牌', () => {
    const spadeAce = getCard(3, 12);
    const heartTwo = getCard(2, 0);
    const obs = observation({
      collected: {
        S: [],
        E: [...bigHearts],
        N: [],
        W: [],
      },
      ownHand: [spadeAce, heartTwo],
      legalCards: [spadeAce, heartTwo],
      handSizes: { S: 2, E: 0, N: 13, W: 13 },
      litCards: [PIG, TRANSFORMER],
      litBy: { [PIG]: 'W', [TRANSFORMER]: 'N' },
    });

    const { knowledge, threat } = threatFor(obs);
    expect(threat.remaining.highRiskEndgame).toBe(true);
    expect(endgameRetentionScore(spadeAce, knowledge, threat, 0, false)).toBeGreaterThan(
      endgameRetentionScore(heartTwo, knowledge, threat, 0, false),
    );
    expect(choosePlay(obs)).toBe(spadeAce);
  });

  it('残局分析能区分正分目标与负值风险', () => {
    const obs = observation({
      collected: {
        S: [],
        E: [PIG, ...bigHearts],
        N: [],
        W: [],
      },
      litCards: [SHEEP],
      litBy: { [SHEEP]: 'W' },
    });
    const { knowledge } = threatFor(obs);
    const remaining = analyzeRemainingCards(knowledge);
    expect(remaining.sheepRemaining).toBe(true);
    expect(remaining.pigRemaining).toBe(false);
    expect(remaining.positiveTargetsValue).toBeGreaterThan(0);
    expect(remaining.negativeRiskValue).toBe(0);
  });
});

describe('全红概率随收牌进度动态上升', () => {
  it('已收一圈红桃且手中只剩 ♥A 时，全红概率显著上升并切换到全红模式', () => {
    const collectedHearts = [0, 1, 2, 3, 4, 7].map((rank) => getCard(2, rank));
    const obs = observation({
      ownHand: [getCard(2, 12), getCard(0, 0), getCard(1, 0), getCard(3, 0)],
      collected: { S: collectedHearts, E: [], N: [], W: [] },
      handSizes: { S: 4, E: 9, N: 9, W: 9 },
    });

    const { threat } = threatFor(obs);
    // 初始 ♥A + ♥9 时全红概率很低；收下一圈红桃后只剩 ♥A，
    // 边际乘积仍接近 0，但进度 + 高红桃控制应把概率抬到全红模式阈值以上。
    expect(threat.seat.S.pAllRed).toBeGreaterThan(0.3);
    expect(threat.modes).toContain('own-allred');
    expect(threat.modes).not.toContain('heart-a-disposal');
  });

  it('已收红桃但手中没有高红桃控制时，不因收牌进度虚报全红', () => {
    const collectedHearts = [0, 1, 2, 3, 4, 5].map((rank) => getCard(2, rank));
    const obs = observation({
      ownHand: [getCard(2, 6), getCard(0, 0), getCard(1, 0), getCard(3, 0)],
      collected: { S: collectedHearts, E: [], N: [], W: [] },
      handSizes: { S: 4, E: 9, N: 9, W: 9 },
    });

    const { threat } = threatFor(obs);
    expect(threat.seat.S.pAllRed).toBeLessThan(0.2);
    expect(threat.modes).not.toContain('own-allred');
  });

  it('其他家已收红桃时，即使自己已收一圈且只剩 ♥A，全红仍为 0', () => {
    const collectedHearts = [0, 1, 2, 3, 4, 7].map((rank) => getCard(2, rank));
    const obs = observation({
      ownHand: [getCard(2, 12), getCard(0, 0), getCard(1, 0), getCard(3, 0)],
      collected: {
        S: collectedHearts,
        E: [getCard(2, 5)],
        N: [],
        W: [],
      },
      handSizes: { S: 4, E: 8, N: 9, W: 9 },
    });

    const { threat } = threatFor(obs);
    expect(threat.seat.S.pAllRed).toBe(0);
    expect(threat.modes).not.toContain('own-allred');
  });
});

describe('♥A 处置与满贯概率基础', () => {
  it('其他家已收红桃时，即使关键牌齐全也不再虚报满贯', () => {
    const eightHearts = Array.from({ length: 8 }, (_, rank) => getCard(2, rank));
    const obs = observation({
      collected: {
        S: [],
        E: [PIG, SHEEP, TRANSFORMER, ...eightHearts],
        N: [getCard(2, 8)],
        W: [],
      },
      ownHand: [getCard(2, 0)],
    });

    const { threat } = threatFor(obs);
    expect(threat.seat.E.pAllRed).toBe(0);
    expect(threat.seat.E.pGrandSlam).toBe(0);
    expect(threat.opp.maxGrandSlamProgress).toBe(0);
    expect(threat.modes).not.toContain('break-opp-slam');
  });

  it('♥A + 少量小牌时，前期主动领出 ♥A 而不是一直留在手里', () => {
    const heartAce = getCard(2, 12);
    const heartTwo = getCard(2, 0);
    const heartFive = getCard(2, 3);
    const clubTwo = getCard(0, 0);
    const obs = observation({
      ownHand: [heartAce, heartTwo, heartFive, clubTwo],
      legalCards: [heartAce, heartTwo, heartFive, clubTwo],
      handSizes: { S: 4, E: 13, N: 13, W: 13 },
    });

    const { threat } = threatFor(obs);
    expect(threat.modes).toContain('heart-a-disposal');
    expect(choosePlay(obs)).toBe(heartAce);
  });

  it('非红桃墩且同伴赢墩时，优先把 ♥A 垫给同伴', () => {
    const heartAce = getCard(2, 12);
    const clubTwo = getCard(0, 0);
    const obs = observation({
      ownHand: [heartAce, clubTwo],
      legalCards: [heartAce, clubTwo],
      handSizes: { S: 2, E: 13, N: 13, W: 13 },
      currentTrick: {
        leader: 'E',
        plays: [play('E', getCard(3, 0)), play('N', getCard(3, 12)), play('W', getCard(3, 1))],
        leadSuit: 3,
        isFirstLed: false,
        isLastToPlay: true,
      },
    });

    const { threat } = threatFor(obs);
    expect(threat.modes).toContain('heart-a-disposal');
    expect(choosePlay(obs)).toBe(heartAce);
  });

  it('同伴已有负向变压器时，不把 ♥A 垫给同伴', () => {
    const heartAce = getCard(2, 12);
    const clubTwo = getCard(0, 0);
    const obs = observation({
      ownHand: [heartAce, clubTwo],
      legalCards: [heartAce, clubTwo],
      handSizes: { S: 2, E: 13, N: 13, W: 13 },
      collected: {
        S: [],
        E: [],
        N: [TRANSFORMER, getCard(2, 11), getCard(2, 10)],
        W: [],
      },
      currentTrick: {
        leader: 'E',
        plays: [play('E', getCard(3, 0)), play('N', getCard(3, 12)), play('W', getCard(3, 1))],
        leadSuit: 3,
        isFirstLed: false,
        isLastToPlay: true,
      },
    });

    const { threat } = threatFor(obs);
    expect(threat.modes).toContain('protect-transformer');
    expect(choosePlay(obs)).toBe(clubTwo);
  });
});

describe('全红保护与破红：红桃去向', () => {
  const partnerHearts = [0, 1, 2, 3].map((rank) => getCard(2, rank));
  const enemyHearts = [0, 1, 2, 3, 4, 5, 6, 7].map((rank) => getCard(2, rank));
  const heartAce = getCard(2, 12);
  const heartSix = getCard(2, 4);
  const clubTwo = getCard(0, 0);

  /** 东家领黑桃，南家缺门；返回当前墩，赢家由参数指定。 */
  function voidTrick(winner: 'E' | 'N' | 'W'): PlayObservation['currentTrick'] {
    const plays =
      winner === 'N'
        ? [play('E', getCard(3, 0)), play('N', getCard(3, 12)), play('W', getCard(3, 1))]
        : winner === 'W'
          ? [play('E', getCard(3, 0)), play('N', getCard(3, 1)), play('W', getCard(3, 12))]
          : [play('E', getCard(3, 12)), play('N', getCard(3, 1)), play('W', getCard(3, 2))];
    return {
      leader: 'E',
      plays,
      leadSuit: 3,
      isFirstLed: false,
      isLastToPlay: true,
    };
  }

  it('同伴已收红桃且全红未被破时，不把红桃垫给非同伴', () => {
    for (const heart of [heartAce, heartSix]) {
      const obs = observation({
        ownHand: [heart, clubTwo],
        legalCards: [heart, clubTwo],
        handSizes: { S: 2, E: 12, N: 12, W: 12 },
        collected: { S: [], E: [], N: partnerHearts, W: [] },
        currentTrick: voidTrick('W'),
      });

      const { knowledge, threat } = threatFor(obs);
      expect(choosePlay(obs)).toBe(clubTwo);
      expect(scoreCandidate(heart, obs, knowledge, threat)).toBeLessThan(
        scoreCandidate(clubTwo, obs, knowledge, threat),
      );
    }
  });

  it('同伴全红未被破且当前赢家是同伴时，继续把红桃喂给同伴', () => {
    const obs = observation({
      ownHand: [heartAce, clubTwo],
      legalCards: [heartAce, clubTwo],
      handSizes: { S: 2, E: 12, N: 12, W: 12 },
      collected: { S: [], E: [], N: partnerHearts, W: [] },
      currentTrick: voidTrick('N'),
    });

    expect(choosePlay(obs)).toBe(heartAce);
  });

  it('同伴全红未被破时，不主动领出 ♥A', () => {
    const obs = observation({
      ownHand: [heartAce, clubTwo],
      legalCards: [heartAce, clubTwo],
      handSizes: { S: 2, E: 12, N: 12, W: 12 },
      collected: { S: [], E: [], N: partnerHearts, W: [] },
    });

    expect(choosePlay(obs)).toBe(clubTwo);
  });

  it('其他家已收红桃、同伴全红已被破时，恢复普通垫牌，不再过度保护', () => {
    const obs = observation({
      ownHand: [heartAce, clubTwo],
      legalCards: [heartAce, clubTwo],
      handSizes: { S: 2, E: 12, N: 12, W: 12 },
      collected: {
        S: [],
        E: [getCard(2, 5)],
        N: partnerHearts,
        W: [],
      },
      currentTrick: voidTrick('W'),
    });

    const { threat } = threatFor(obs);
    expect(threat.seat.N.pAllRed).toBe(0);
    expect(choosePlay(obs)).toBe(heartAce);
  });

  it('敌方全红压力高时，把红桃垫给非目标敌方以破红', () => {
    const obs = observation({
      ownHand: [heartAce, clubTwo],
      legalCards: [heartAce, clubTwo],
      handSizes: { S: 2, E: 5, N: 12, W: 12 },
      collected: { S: [], E: enemyHearts, N: [], W: [] },
      currentTrick: voidTrick('W'),
    });

    const { threat } = threatFor(obs);
    expect(threat.modes).toContain('break-opp-allred');
    expect(choosePlay(obs)).toBe(heartAce);
  });

  it('敌方全红压力高且当前赢家就是目标时，不把红桃喂给目标', () => {
    const obs = observation({
      ownHand: [heartAce, clubTwo],
      legalCards: [heartAce, clubTwo],
      handSizes: { S: 2, E: 5, N: 12, W: 12 },
      collected: { S: [], E: enemyHearts, N: [], W: [] },
      currentTrick: voidTrick('E'),
    });

    const { knowledge, threat } = threatFor(obs);
    expect(threat.modes).toContain('break-opp-allred');
    expect(scoreCandidate(heartAce, obs, knowledge, threat)).toBeLessThan(
      scoreCandidate(clubTwo, obs, knowledge, threat),
    );
    expect(choosePlay(obs)).toBe(clubTwo);
  });
});

describe('满贯概率：关键牌硬事实与难度', () => {
  const hearts12 = Array.from({ length: 12 }, (_, rank) => getCard(2, rank));

  const blockedCases = [
    ['羊', SHEEP],
    ['猪', PIG],
    ['变压器', TRANSFORMER],
  ] as const;

  for (const [name, blockedCard] of blockedCases) {
    it(`其他家收到${name}时，本家满贯概率为 0`, () => {
      const ownKeys = [PIG, SHEEP, TRANSFORMER].filter((card) => card !== blockedCard);
      const obs = observation({
        ownHand: [getCard(2, 12)],
        handSizes: { S: 1, E: 0, N: 0, W: 0 },
        collected: {
          S: [...ownKeys, ...hearts12],
          E: [blockedCard],
          N: [],
          W: [],
        },
      });

      const { threat } = threatFor(obs);
      // 自己已经 12 张红桃 + 两张关键牌，全红概率很高；
      // 但羊/猪/变压器之一已被其他家收走，满贯必须为 0。
      expect(threat.seat.S.pAllRed).toBeGreaterThan(0.5);
      expect(threat.seat.S.pGrandSlam).toBe(0);
      expect(threat.own.maxGrandSlamProgress).toBe(0);
      expect(threat.modes).not.toContain('own-slam');
    });
  }

  it('持羊且方片短小时，满贯概率低于方片长且有大牌', () => {
    const collected = { S: [PIG, TRANSFORMER, ...hearts12], E: [], N: [], W: [] };
    const shortLow = observation({
      ownHand: [getCard(2, 12), SHEEP],
      handSizes: { S: 2, E: 9, N: 9, W: 9 },
      collected,
    });
    const longHigh = observation({
      ownHand: [
        getCard(2, 12),
        SHEEP,
        getCard(1, 12),
        getCard(1, 11),
        getCard(1, 10),
      ],
      handSizes: { S: 5, E: 9, N: 9, W: 9 },
      collected,
    });

    const shortThreat = threatFor(shortLow).threat;
    const longThreat = threatFor(longHigh).threat;
    // 方片短且没有 Q/K/A 时，♦J 很容易被别人的大牌抢走；
    // 方片长且自己持有 Q/K/A 时，羊更稳，满贯概率应更高。
    expect(shortThreat.seat.S.pGrandSlam).toBeLessThan(longThreat.seat.S.pGrandSlam);
    expect(shortThreat.seat.S.pGrandSlam).toBeLessThan(0.85);
    expect(longThreat.seat.S.pGrandSlam).toBeGreaterThan(0.9);
  });

  it('持猪且黑桃短时，早期落猪仍可视为能收下，满贯概率高于后期', () => {
    const collected = { S: [SHEEP, TRANSFORMER, ...hearts12], E: [], N: [], W: [] };
    const base = {
      ownHand: [getCard(2, 12), PIG],
      handSizes: { S: 2, E: 9, N: 9, W: 9 },
      collected,
    };

    const early = threatFor(observation(base)).threat;
    const late = threatFor(
      observation({
        ...base,
        trickHistory: Array.from({ length: 10 }, () => emptyTrick('S')),
      }),
    ).threat;

    // 早期落猪通常无人抢，黑桃短不构成障碍；越到后期越可能被针对。
    expect(early.seat.S.pGrandSlam).toBeGreaterThan(late.seat.S.pGrandSlam);
    expect(early.seat.S.pGrandSlam).toBeGreaterThan(0.9);
  });
});

describe('出牌观察：信息边界', () => {
  it('观察对象不包含其他座位的手牌或原始手牌', () => {
    const deal = {
      index: 1,
      seed: 42,
      hands: {
        S: [getCard(2, 0)],
        E: [getCard(2, 1)],
        N: [getCard(2, 2)],
        W: [getCard(2, 3)],
      },
      originalHands: {
        S: [getCard(2, 0)],
        E: [getCard(2, 1)],
        N: [getCard(2, 2)],
        W: [getCard(2, 3)],
      },
      leader: 'S' as Position,
      openingDeal: false,
      litCards: [],
      litBy: {},
      autoLitCards: [],
      submissions: { S: [], E: [], N: [], W: [] },
      submitted: { S: true, E: true, N: true, W: true },
      allKeyCardsLit: false,
      firstLedSuitStatus: { ...NOT_LED },
      tricks: [],
      currentTrick: {
        leader: 'S' as Position,
        plays: [],
        winner: null,
        points: 0,
        firstLedSuit: null,
        isFirstLed: false,
      },
      nextPlayer: 'S' as Position,
      collected: { S: [], E: [], N: [], W: [] },
      pigCollector: null,
      phase: 'playing' as const,
      score: null,
      lastAction: null,
    };
    const obs = buildPlayObservation({
      deal,
      self: 'S',
      round: {
        number: 1,
        isExtra: false,
        smallScores: { A: 0, B: 0 },
        dealsPlayed: 1,
        lastPigCollector: null,
      },
      match: { format: 5, totalPigHeads: { A: 0, B: 0 }, rounds: [] },
      config: { dealLimit: 20 },
      legalCards: [getCard(2, 0)],
    });

    expect(Object.keys(obs)).not.toContain('hands');
    expect(Object.keys(obs)).not.toContain('originalHands');
    expect(obs.ownHand).toEqual([getCard(2, 0)]);
    expect(obs.handSizes.E).toBe(13);
  });

  it('隐藏手牌不同但公开观察相同时，AI 出牌完全相同', () => {
    const allCards = Array.from({ length: 52 }, (_, card) => card);
    const ownHand = allCards.slice(0, 13);
    const rest = allCards.slice(13);
    const hiddenA = {
      E: rest.slice(0, 13),
      N: rest.slice(13, 26),
      W: rest.slice(26),
    };
    const shifted = [...rest.slice(7), ...rest.slice(0, 7)];
    const hiddenB = {
      E: shifted.slice(0, 13),
      N: shifted.slice(13, 26),
      W: shifted.slice(26),
    };

    const round = {
      number: 1,
      isExtra: false,
      smallScores: { A: 0, B: 0 },
      dealsPlayed: 1,
      lastPigCollector: null,
    };
    const match = { format: 5 as const, totalPigHeads: { A: 0, B: 0 }, rounds: [] };
    const config = { dealLimit: 20 };
    const obsA = buildPlayObservation({
      deal: dealWithHiddenHands(ownHand, hiddenA),
      self: 'S',
      round,
      match,
      config,
      legalCards: [...ownHand],
    });
    const obsB = buildPlayObservation({
      deal: dealWithHiddenHands(ownHand, hiddenB),
      self: 'S',
      round,
      match,
      config,
      legalCards: [...ownHand],
    });

    expect(obsA).toEqual(obsB);
    expect(choosePlay(obsA)).toBe(choosePlay(obsB));
  });

  it('固定公开观察与固定种子下，出牌确定', () => {
    const obs = observation({
      ownHand: [getCard(1, 12), getCard(0, 0)],
      legalCards: [getCard(1, 12), getCard(0, 0)],
      handSizes: { S: 2, E: 13, N: 13, W: 13 },
    });
    expect(choosePlay(obs)).toBe(choosePlay(obs));
  });
});

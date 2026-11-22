import type { SuitIndex } from '../models/card';
import { getSuit } from '../models/card';
import {
  ALL_POSITIONS,
  getPartner,
  otherTeam,
  teamOf,
  type CardPlay,
  type DealState,
  type GameConfig,
  type MatchFormat,
  type MatchState,
  type Position,
  type RoundRecord,
  type RoundState,
  type SuitStatus,
  type Team,
  type Trick,
} from '../models/game';

/**
 * 出牌 AI 的公开观察对象。
 *
 * 这里刻意不包含其他三家的手牌或原始手牌。store 构造时只复制白名单字段，
 * 隐藏牌局状态不会通过该类型泄漏给 AI。
 */
export interface PlayObservation {
  self: Position;
  partner: Position;
  team: Team;
  opponentTeam: Team;

  /** 自己的当前手牌与原始手牌（原始手牌仅用于自己的亮猪判断） */
  ownHand: number[];
  ownOriginalHand: number[];

  /** 每家剩余手牌数（公开：13 - 已出牌数） */
  handSizes: Record<Position, number>;

  currentTrick: {
    leader: Position;
    plays: CardPlay[];
    leadSuit: SuitIndex | null;
    isFirstLed: boolean;
    isLastToPlay: boolean;
  };

  /** 已结算的历史墩 */
  trickHistory: Trick[];

  /** 每家已收牌（所有打出的牌本来就是公开的） */
  collected: Record<Position, number[]>;

  litCards: number[];
  litBy: Record<number, Position>;
  autoLitCards: number[];

  firstLedSuitStatus: Record<SuitIndex, SuitStatus>;
  legalCards: number[];

  round: {
    number: number;
    isExtra: boolean;
    smallScores: Record<Team, number>;
    dealsPlayed: number;
    dealLimit: number;
    lastPigCollector: Position | null;
  };

  match: {
    format: MatchFormat;
    totalPigHeads: Record<Team, number>;
    rounds: RoundSummary[];
  };

  deal: {
    index: number;
    leader: Position;
    openingDeal: boolean;
    seed: number;
  };

  /** 采样/随机种子；固定观察 + 固定种子 → 固定出牌 */
  samplingSeed: number;
}

export interface RoundSummary {
  roundNumber: number;
  isExtra: boolean;
  smallScores: Record<Team, number>;
  newPigHeads: Record<Team, number>;
  winner: RoundRecord['winner'];
  loser: RoundRecord['loser'];
  result: RoundRecord['result'];
  endReason: RoundRecord['endReason'];
}

export interface BuildPlayObservationInput {
  deal: DealState;
  self: Position;
  round: Pick<
    RoundState,
    'number' | 'isExtra' | 'smallScores' | 'dealsPlayed' | 'lastPigCollector'
  >;
  match: Pick<MatchState, 'format' | 'totalPigHeads' | 'rounds'>;
  config: Pick<GameConfig, 'dealLimit'>;
  legalCards: number[];
}

function copyPlays(plays: CardPlay[]): CardPlay[] {
  return plays.map((play) => ({ ...play }));
}

function copyTrick(trick: Trick): Trick {
  return {
    leader: trick.leader,
    plays: copyPlays(trick.plays),
    winner: trick.winner,
    points: trick.points,
    firstLedSuit: trick.firstLedSuit,
    isFirstLed: trick.isFirstLed,
  };
}

/** 轻量确定性哈希，只用于采样种子和稳定的出牌 tie-break。 */
export function hashSeed(...parts: number[]): number {
  let hash = 2166136261 >>> 0;
  for (const part of parts) {
    let value = part >>> 0;
    for (let i = 0; i < 4; i++) {
      hash ^= value & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
      value >>>= 8;
    }
  }
  return hash >>> 0;
}

function playedCount(deal: DealState): Record<Position, number> {
  const counts: Record<Position, number> = { S: 0, E: 0, N: 0, W: 0 };
  for (const trick of deal.tricks) {
    for (const play of trick.plays) counts[play.position] += 1;
  }
  for (const play of deal.currentTrick.plays) counts[play.position] += 1;
  return counts;
}

/**
 * 从完整 DealState 裁剪出公开观察。
 *
 * 注意：这里逐个字段复制，绝不 spread 整个 DealState，避免把 hands/originalHands
 * 意外带给 AI。其他座位的“剩余张数”由公开出牌数推导，而不是读取其手牌长度。
 */
export function buildPlayObservation(input: BuildPlayObservationInput): PlayObservation {
  const { deal, self, round, match, config, legalCards } = input;
  const played = playedCount(deal);
  const handSizes = {} as Record<Position, number>;
  for (const pos of ALL_POSITIONS) {
    handSizes[pos] = Math.max(0, 13 - played[pos]);
  }
  // 自己手牌是公开观察的一部分，直接以实际手牌长度为准。
  handSizes[self] = deal.hands[self].length;

  const leadSuit =
    deal.currentTrick.plays.length > 0 ? getSuit(deal.currentTrick.plays[0].card) : null;

  return {
    self,
    partner: getPartner(self),
    team: teamOf(self),
    opponentTeam: otherTeam(teamOf(self)),
    ownHand: [...deal.hands[self]],
    ownOriginalHand: [...deal.originalHands[self]],
    handSizes,
    currentTrick: {
      leader: deal.currentTrick.leader,
      plays: copyPlays(deal.currentTrick.plays),
      leadSuit,
      isFirstLed: deal.currentTrick.isFirstLed,
      isLastToPlay: deal.currentTrick.plays.length === 3,
    },
    trickHistory: deal.tricks.map(copyTrick),
    collected: {
      S: [...deal.collected.S],
      E: [...deal.collected.E],
      N: [...deal.collected.N],
      W: [...deal.collected.W],
    },
    litCards: [...deal.litCards],
    litBy: { ...deal.litBy },
    autoLitCards: [...deal.autoLitCards],
    firstLedSuitStatus: { ...deal.firstLedSuitStatus },
    legalCards: [...legalCards],
    round: {
      number: round.number,
      isExtra: round.isExtra,
      smallScores: { ...round.smallScores },
      dealsPlayed: round.dealsPlayed,
      dealLimit: config.dealLimit,
      lastPigCollector: round.lastPigCollector,
    },
    match: {
      format: match.format,
      totalPigHeads: { ...match.totalPigHeads },
      rounds: match.rounds.map((record) => ({
        roundNumber: record.roundNumber,
        isExtra: record.isExtra,
        smallScores: { ...record.smallScores },
        newPigHeads: { ...record.newPigHeads },
        winner: record.winner,
        loser: record.loser,
        result: record.result,
        endReason: record.endReason,
      })),
    },
    deal: {
      index: deal.index,
      leader: deal.leader,
      openingDeal: deal.openingDeal,
      seed: deal.seed,
    },
    samplingSeed: hashSeed(deal.seed, deal.index, deal.tricks.length, self.charCodeAt(0)),
  };
}

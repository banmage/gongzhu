import {
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  baseHeartValue,
  getSuit,
  type SuitIndex,
} from '../models/card';
import {
  ALL_POSITIONS,
  getPartner,
  otherTeam,
  teamOf,
  type CardPlay,
  type Position,
  type Team,
} from '../models/game';
import type { PlayObservation } from './aiObservation';

export const ALL_CARDS: number[] = Array.from({ length: 52 }, (_, card) => card);

export type SuitVoidMap = Record<Position, Record<SuitIndex, boolean>>;

export interface ConfirmedSeatState {
  pig: boolean;
  sheep: boolean;
  transformer: boolean;
  heartA: boolean;
  hearts: number;
  keyCards: number;
  heartsBase: number;
  /** 已收牌的粗略小计（变压器之前） */
  subtotal: number;
}

export interface KeyCardState {
  card: number;
  /** 已经进入某家收牌区 */
  collectedBy: Position | null;
  /** 正在当前墩中，尚未结算 */
  inCurrentTrick: boolean;
  /** 公开已知持有者（自己或已亮且未打出） */
  knownHolder: Position | null;
  /** 尚未打出（包括当前墩中尚未结算的牌） */
  remaining: boolean;
}

export interface PublicKnowledge {
  self: Position;
  partner: Position;
  ownTeam: Team;
  opponentTeam: Team;

  played: Set<number>;
  playedBy: Record<Position, number[]>;
  collected: Record<Position, number[]>;
  ownHand: number[];
  unseen: number[];

  handSizes: Record<Position, number>;
  voids: SuitVoidMap;

  knownHolders: Map<number, Position>;

  currentTrick: PlayObservation['currentTrick'];
  currentWinner: Position | null;
  currentBestCard: number | null;
  currentLeadSuit: SuitIndex | null;
  tricksPlayed: number;
  tricksRemaining: number;

  suitRemaining: Record<SuitIndex, number[]>;
  heartRemaining: number[];

  keyCards: {
    pig: KeyCardState;
    sheep: KeyCardState;
    transformer: KeyCardState;
    heartA: KeyCardState;
  };

  confirmed: Record<Position, ConfirmedSeatState>;
  litCards: number[];
  litBy: Record<number, Position>;
  autoLitCards: number[];

  smallScores: Record<Team, number>;
  totalPigHeads: Record<Team, number>;
  dealLimit: number;
  dealsPlayed: number;
  matchFormat: 5 | 8;
}

function emptySuitMap(): Record<SuitIndex, boolean> {
  return { 0: false, 1: false, 2: false, 3: false };
}

function emptyVoids(): SuitVoidMap {
  return {
    S: emptySuitMap(),
    E: emptySuitMap(),
    N: emptySuitMap(),
    W: emptySuitMap(),
  };
}

function addPlayed(
  knowledge: PublicKnowledge,
  play: CardPlay,
  leadSuit: SuitIndex | null,
): void {
  knowledge.played.add(play.card);
  knowledge.playedBy[play.position].push(play.card);
  if (leadSuit !== null && getSuit(play.card) !== leadSuit) {
    knowledge.voids[play.position][leadSuit] = true;
  }
}

function bestCurrentPlay(plays: CardPlay[]): CardPlay | null {
  if (plays.length === 0) return null;
  const leadSuit = getSuit(plays[0].card);
  let best = plays[0];
  for (const play of plays.slice(1)) {
    if (getSuit(play.card) !== leadSuit) continue;
    if (play.card % 13 > best.card % 13) best = play;
  }
  return best;
}

function buildConfirmed(collected: Record<Position, number[]>, litCards: number[]): Record<Position, ConfirmedSeatState> {
  const lit = new Set(litCards);
  const result = {} as Record<Position, ConfirmedSeatState>;
  for (const pos of ALL_POSITIONS) {
    const cards = collected[pos];
    const hearts = cards.filter((card) => getSuit(card) === 2);
    const heartsBase = hearts.reduce((sum, card) => sum + baseHeartValue(card), 0);
    const pig = cards.includes(PIG);
    const sheep = cards.includes(SHEEP);
    const transformer = cards.includes(TRANSFORMER);
    const heartA = cards.includes(HEART_A);

    let heartsTotal = heartsBase;
    if (lit.has(HEART_A) && hearts.length > 0) heartsTotal = heartsBase * 2;
    if (hearts.length === 13) {
      heartsTotal = -(lit.has(HEART_A) ? heartsBase * 2 : heartsBase);
    }

    let subtotal = heartsTotal;
    if (pig) subtotal += lit.has(PIG) ? -200 : -100;
    if (sheep) subtotal += lit.has(SHEEP) ? 200 : 100;

    result[pos] = {
      pig,
      sheep,
      transformer,
      heartA,
      hearts: hearts.length,
      keyCards: (pig ? 1 : 0) + (sheep ? 1 : 0) + (transformer ? 1 : 0),
      heartsBase,
      subtotal,
    };
  }
  return result;
}

function buildKeyCardState(
  card: number,
  collected: Record<Position, number[]>,
  currentTrick: CardPlay[],
  ownHand: number[],
  self: Position,
  litCards: number[],
  litBy: Record<number, Position>,
): KeyCardState {
  const collectedBy = ALL_POSITIONS.find((pos) => collected[pos].includes(card)) ?? null;
  const inCurrentTrick = currentTrick.some((play) => play.card === card);
  let knownHolder: Position | null = null;
  if (ownHand.includes(card)) knownHolder = self;
  else if (litCards.includes(card) && litBy[card]) knownHolder = litBy[card];

  return {
    card,
    collectedBy,
    inCurrentTrick,
    knownHolder,
    remaining: collectedBy === null,
  };
}

/**
 * 从公开观察构造公共知识：缺门、未见牌、关键牌归属、已收关键牌。
 */
export function buildPublicKnowledge(obs: PlayObservation): PublicKnowledge {
  const knowledge: PublicKnowledge = {
    self: obs.self,
    partner: obs.partner,
    ownTeam: obs.team,
    opponentTeam: otherTeam(obs.team),
    played: new Set<number>(),
    playedBy: { S: [], E: [], N: [], W: [] },
    collected: {
      S: [...obs.collected.S],
      E: [...obs.collected.E],
      N: [...obs.collected.N],
      W: [...obs.collected.W],
    },
    ownHand: [...obs.ownHand],
    unseen: [],
    handSizes: { ...obs.handSizes },
    voids: emptyVoids(),
    knownHolders: new Map<number, Position>(),
    currentTrick: obs.currentTrick,
    currentWinner: null,
    currentBestCard: null,
    currentLeadSuit: obs.currentTrick.leadSuit,
    tricksPlayed: obs.trickHistory.length,
    tricksRemaining: 13 - obs.trickHistory.length,
    suitRemaining: { 0: [], 1: [], 2: [], 3: [] },
    heartRemaining: [],
    keyCards: {
      pig: buildKeyCardState(PIG, obs.collected, obs.currentTrick.plays, obs.ownHand, obs.self, obs.litCards, obs.litBy),
      sheep: buildKeyCardState(SHEEP, obs.collected, obs.currentTrick.plays, obs.ownHand, obs.self, obs.litCards, obs.litBy),
      transformer: buildKeyCardState(
        TRANSFORMER,
        obs.collected,
        obs.currentTrick.plays,
        obs.ownHand,
        obs.self,
        obs.litCards,
        obs.litBy,
      ),
      heartA: buildKeyCardState(HEART_A, obs.collected, obs.currentTrick.plays, obs.ownHand, obs.self, obs.litCards, obs.litBy),
    },
    confirmed: buildConfirmed(obs.collected, obs.litCards),
    litCards: [...obs.litCards],
    litBy: { ...obs.litBy },
    autoLitCards: [...obs.autoLitCards],
    smallScores: { ...obs.round.smallScores },
    totalPigHeads: { ...obs.match.totalPigHeads },
    dealLimit: obs.round.dealLimit,
    dealsPlayed: obs.round.dealsPlayed,
    matchFormat: obs.match.format,
  };

  for (const trick of obs.trickHistory) {
    const leadSuit = trick.plays.length > 0 ? getSuit(trick.plays[0].card) : null;
    for (const play of trick.plays) addPlayed(knowledge, play, leadSuit);
  }
  const currentLeadSuit =
    obs.currentTrick.plays.length > 0 ? getSuit(obs.currentTrick.plays[0].card) : null;
  for (const play of obs.currentTrick.plays) addPlayed(knowledge, play, currentLeadSuit);

  const ownSet = new Set(obs.ownHand);
  knowledge.unseen = ALL_CARDS.filter((card) => !ownSet.has(card) && !knowledge.played.has(card));

  for (const card of obs.ownHand) knowledge.knownHolders.set(card, obs.self);
  for (const card of obs.litCards) {
    const holder = obs.litBy[card];
    if (holder && !knowledge.played.has(card)) knowledge.knownHolders.set(card, holder);
  }

  for (const card of knowledge.unseen) {
    const suit = getSuit(card);
    knowledge.suitRemaining[suit].push(card);
  }
  // 红桃“仍在场上”的口径：尚未进入任何人的收牌区，包括自己手牌、未见牌和当前墩。
  knowledge.heartRemaining = ALL_CARDS.filter(
    (card) =>
      getSuit(card) === 2 &&
      !ALL_POSITIONS.some((pos) => knowledge.collected[pos].includes(card)),
  );

  const best = bestCurrentPlay(obs.currentTrick.plays);
  if (best) {
    knowledge.currentWinner = best.position;
    knowledge.currentBestCard = best.card;
  }

  // 手牌为 0 的玩家在所有花色上都已经没有牌。
  for (const pos of ALL_POSITIONS) {
    if (knowledge.handSizes[pos] <= 0) {
      for (const suit of [0, 1, 2, 3] as SuitIndex[]) knowledge.voids[pos][suit] = true;
    }
  }

  return knowledge;
}

export function isCollected(knowledge: PublicKnowledge, card: number): boolean {
  return ALL_POSITIONS.some((pos) => knowledge.collected[pos].includes(card));
}

export function collectedBy(knowledge: PublicKnowledge, card: number): Position | null {
  return ALL_POSITIONS.find((pos) => knowledge.collected[pos].includes(card)) ?? null;
}

export function isSettled(knowledge: PublicKnowledge, card: number): boolean {
  return knowledge.played.has(card) && !knowledge.currentTrick.plays.some((play) => play.card === card);
}

export function canHoldSuit(knowledge: PublicKnowledge, pos: Position, suit: SuitIndex): boolean {
  return !knowledge.voids[pos][suit];
}

export function partnerOf(knowledge: PublicKnowledge, pos: Position): Position {
  return getPartner(pos);
}

export function teamOfSeat(knowledge: PublicKnowledge, pos: Position): Team {
  return teamOf(pos);
}

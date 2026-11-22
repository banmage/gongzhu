import {
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  cardBasePoints,
  getRank,
  getSuit,
  isScoringCard,
} from '../models/card';
import type { CardPlay, Position, SuitStatus } from '../models/game';
import { ALL_POSITIONS, getPartner, otherTeam, teamOf } from '../models/game';
import type { LightRuleConfig } from '../rules/lightRuleConfig';
import { decideLights } from '../rules/lightRuleEngine';
import { buildPlayObservation, hashSeed, type PlayObservation } from './aiObservation';
import { buildPublicKnowledge } from './aiKnowledge';
import { estimateThreats } from './aiThreat';
import { choosePolicyPlay } from './aiPolicy';

/* ------------------------------------------------------------------ *
 * 亮牌 AI
 * ------------------------------------------------------------------ */

export interface LightAiInput {
  hand: number[];
  position: Position;
  /** 本队本局小分 */
  teamSmallScore: number;
  /** 对方本局小分 */
  opponentSmallScore: number;
  /** 本局第几副（1 起） */
  dealIndex: number;
  /** 当前已提交亮牌数量（不含自动亮） */
  litCount: number;
  /** 发牌种子：用于规则 V1.0 的可复现采样 */
  seed?: number;
  /** 已公开亮牌（open 模式） */
  litCards?: number[];
  /** 显式指定规则；缺省使用当前热插拔激活规则 */
  rule?: LightRuleConfig;
}

/**
 * 按《拱猪亮牌规则 V1.0》计算推荐亮牌。
 *
 * 只读取自己的手牌与公开信息；规则来自当前激活的亮牌规则，
 * 管理员热更新后，下一次调用立即生效。
 */
export function chooseLights(input: LightAiInput): number[] {
  return decideLights({
    hand: input.hand,
    position: input.position,
    teamSmallScore: input.teamSmallScore,
    opponentSmallScore: input.opponentSmallScore,
    dealIndex: input.dealIndex,
    dealSeed: input.seed ?? 0,
    litCards: input.litCards ?? [],
    litCount: input.litCount,
    rule: input.rule,
  }).cards;
}

/* ------------------------------------------------------------------ *
 * 出牌 AI
 * ------------------------------------------------------------------ */

/**
 * 旧版出牌输入，保留用于测试、模拟器和外部调用。
 * 新代码应优先构造完整 PlayObservation，以便概率层使用历史墩、收牌区和亮牌归属。
 */
export interface PlayAiInput {
  hand: number[];
  position: Position;
  currentTrick: CardPlay[];
  legalCards: number[];
  litCards: number[];
  /** 是否是本墩最后一个出牌者 */
  isLastToPlay: boolean;
  /** 可选：发牌种子，用于稳定 tie-break */
  seed?: number;
}

export interface PlayAiOptions {
  /** fast：概率启发式（默认）；standard/strong 预留给后续 PIMC 采样 */
  strength?: 'fast' | 'standard' | 'strong';
  seed?: number;
}

function isPlayObservation(input: PlayAiInput | PlayObservation): input is PlayObservation {
  return 'ownHand' in input && 'samplingSeed' in input;
}

function emptySuitStatus(): Record<number, SuitStatus> {
  return { 0: 'NOT_LED', 1: 'NOT_LED', 2: 'NOT_LED', 3: 'NOT_LED' };
}

/**
 * 把旧版输入包装成最小观察。历史墩、收牌区等公开信息缺失时，
 * 概率层只能使用当前墩与自己的手牌，但仍保证合法性和基本团队策略。
 */
export function observationFromLegacy(input: PlayAiInput): PlayObservation {
  const partner = getPartner(input.position);
  const leadSuit =
    input.currentTrick.length > 0 ? getSuit(input.currentTrick[0].card) : null;
  const playedBy: Record<Position, number> = { S: 0, E: 0, N: 0, W: 0 };
  for (const play of input.currentTrick) playedBy[play.position] += 1;
  const handSizes: Record<Position, number> = { S: 0, E: 0, N: 0, W: 0 };
  for (const pos of ALL_POSITIONS) {
    handSizes[pos] = Math.max(0, 13 - playedBy[pos]);
  }
  handSizes[input.position] = input.hand.length;

  const seed = input.seed ?? 0;
  return {
    self: input.position,
    partner,
    team: teamOf(input.position),
    opponentTeam: otherTeam(teamOf(input.position)),
    ownHand: [...input.hand],
    ownOriginalHand: [...input.hand],
    handSizes,
    currentTrick: {
      leader: input.currentTrick[0]?.position ?? input.position,
      plays: input.currentTrick.map((play) => ({ ...play })),
      leadSuit,
      isFirstLed: false,
      isLastToPlay: input.isLastToPlay,
    },
    trickHistory: [],
    collected: { S: [], E: [], N: [], W: [] },
    litCards: [...input.litCards],
    litBy: {},
    autoLitCards: [],
    firstLedSuitStatus: emptySuitStatus() as PlayObservation['firstLedSuitStatus'],
    legalCards: [...input.legalCards],
    round: {
      number: 1,
      isExtra: false,
      smallScores: { A: 0, B: 0 },
      dealsPlayed: 0,
      dealLimit: 20,
      lastPigCollector: null,
    },
    match: {
      format: 5,
      totalPigHeads: { A: 0, B: 0 },
      rounds: [],
    },
    deal: {
      index: 0,
      leader: input.currentTrick[0]?.position ?? input.position,
      openingDeal: false,
      seed,
    },
    samplingSeed: hashSeed(seed, input.currentTrick.length, input.position.charCodeAt(0)),
  };
}

/**
 * 出牌决策入口。
 *
 * 当前实现使用“四方动态概率 + 团队启发式”：
 * 1. 从公开观察推导缺门、未见牌、关键牌归属；
 * 2. 估计四家全红/满贯/猪/羊/变压器陷阱概率；
 * 3. 按概率模式（配合/保护/破坏/残局留牌）给每张合法牌评分。
 *
 * 只使用公开信息，不读取其他三家的真实手牌。
 */
export function choosePlay(
  input: PlayAiInput | PlayObservation,
  _options: PlayAiOptions = {},
): number {
  const observation = isPlayObservation(input) ? input : observationFromLegacy(input);
  if (observation.legalCards.length === 0) throw new Error('没有合法出牌');
  if (observation.legalCards.length === 1) return observation.legalCards[0];

  const knowledge = buildPublicKnowledge(observation);
  const threat = estimateThreats(observation, knowledge);
  return choosePolicyPlay(observation, knowledge, threat);
}

/**
 * 保留一个轻量基础启发式，供调试/回退使用。
 * 正式决策请使用 choosePlay()。
 */
export function heuristicPlay(input: PlayAiInput): number {
  const { hand, position, currentTrick, legalCards, isLastToPlay } = input;
  if (legalCards.length === 0) throw new Error('没有合法出牌');
  if (legalCards.length === 1) return legalCards[0];

  const partner = getPartner(position);
  const best = bestPlaySoFar(currentTrick);
  const partnerWinning = best !== null && best.position === partner;
  const leadSuit = currentTrick.length > 0 ? getSuit(currentTrick[0].card) : null;

  let bestCard = legalCards[0];
  let bestScore = -Infinity;

  for (const card of legalCards) {
    let score = 0;
    const cardSuit = getSuit(card);
    const cardPoints = cardBasePoints(card);
    const scoring = isScoringCard(card);

    if (currentTrick.length === 0) {
      score = -getRank(card) * 0.8;
      if (scoring) score -= 12;
      if (card === PIG) score -= 80;
      if (card === TRANSFORMER) score -= 25;
      if (card === SHEEP) score -= 10;
      if (cardSuit === 2) score -= 30;
      const suitLength = hand.filter((c) => getSuit(c) === cardSuit).length;
      if (suitLength >= 4) score += 6;
      if (cardSuit === 3 && hand.includes(PIG)) score -= 4;
    } else {
      const winsNow =
        leadSuit !== null &&
        cardSuit === leadSuit &&
        (best === null || getRank(card) > getRank(best.card));
      const pointsNow = trickPoints(currentTrick, card);

      if (winsNow) {
        score += pointsNow;
        score += 8;
        if (partnerWinning) score -= 30;
        if (cardPoints < 0) score -= 20;
        if (pointsNow > 0) score += 6;
        if (isLastToPlay) score += 2;
      } else {
        score += cardPoints < 0 ? -cardPoints * 0.55 : -cardPoints * 0.95;
        score += -getRank(card) * 0.35;
        if (partnerWinning && cardPoints > 0) score += 12;
        if (!partnerWinning && cardPoints > 0) score -= 8;
        if (isLastToPlay && cardPoints < 0) score += 4;
      }

      const hasLeadSuit = leadSuit !== null && hand.some((c) => getSuit(c) === leadSuit);
      if (!hasLeadSuit && scoring) score -= 3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  return bestCard;
}

function bestPlaySoFar(plays: CardPlay[]): CardPlay | null {
  if (plays.length === 0) return null;
  const leadSuit = getSuit(plays[0].card);
  let best = plays[0];
  for (const play of plays.slice(1)) {
    if (getSuit(play.card) !== leadSuit) continue;
    if (getRank(play.card) > getRank(best.card)) best = play;
  }
  return best;
}

function trickPoints(plays: CardPlay[], extraCard?: number): number {
  let sum = plays.reduce((acc, play) => acc + cardBasePoints(play.card), 0);
  if (extraCard !== undefined) sum += cardBasePoints(extraCard);
  return sum;
}

import {
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  baseHeartValue,
  getRank,
  getSuit,
  type SuitIndex,
} from '../models/card';
import {
  ALL_POSITIONS,
  ORDER,
  teamOf,
  type CardPlay,
  type Position,
  type Team,
} from '../models/game';
import type { PlayObservation } from './aiObservation';
import {
  type ConfirmedSeatState,
  type PublicKnowledge,
  collectedBy,
  isCollected,
} from './aiKnowledge';

export type ThreatMode =
  | 'normal'
  | 'own-allred'
  | 'partner-allred'
  | 'break-opp-allred'
  | 'own-slam'
  | 'partner-slam'
  | 'break-opp-slam'
  | 'heart-a-disposal'
  | 'protect-transformer'
  | 'exploit-transformer'
  | 'pig-evade'
  | 'pig-maintain'
  | 'sheep-contest'
  | 'danger-zone'
  | 'finish'
  | 'high-value-endgame'
  | 'high-risk-endgame';

export interface SeatThreat {
  seat: Position;
  team: Team;

  pAllRed: number;
  pGrandSlam: number;
  pPig: number;
  pSheep: number;
  pTransformer: number;
  pTransformerNegative: number;
  pTransformerTrap: number;
  pHeartA: number;
  pEffectivePig: number;

  confidence: number;
  confirmed: ConfirmedSeatState;
  /** 当前已收牌 + 期望未来收牌的粗略小计（变压器之前） */
  subtotalEstimate: number;
}

export interface TeamThreat {
  pAllRedAny: number;
  pGrandSlamAny: number;
  /** 不考虑未来概率、只看已收牌进度时，最接近满贯的一家（0..1）。 */
  maxGrandSlamProgress: number;
  /** 已收红桃进度；其他家已收红桃时为 0（全红已不可能）。 */
  maxAllRedProgress: number;
  pPositive1000: number;
  pNegative1000: number;
  pPigAny: number;
  pSheepAny: number;
  pTransformerTrapAny: number;
}

export interface RemainingAnalysis {
  sheepRemaining: boolean;
  pigRemaining: boolean;
  transformerRemaining: boolean;
  heartARemaining: boolean;

  sheepLit: boolean;
  pigLit: boolean;
  transformerLit: boolean;

  bigHeartsRemaining: number[];
  bigHeartsValue: number;

  /** 仍在场上的正分目标价值（羊 + 正向变压器） */
  positiveTargetsValue: number;
  /** 仍在场上的高风险负值（猪 + 负向变压器 + 大红桃） */
  negativeRiskValue: number;

  highValueEndgame: boolean;
  highRiskEndgame: boolean;
}

export interface ThreatModel {
  seat: Record<Position, SeatThreat>;
  own: TeamThreat;
  opp: TeamThreat;
  modes: ThreatMode[];
  remaining: RemainingAnalysis;
}

const MODE_PRIORITY: ThreatMode[] = [
  'own-slam',
  'partner-slam',
  'break-opp-slam',
  'own-allred',
  'partner-allred',
  'break-opp-allred',
  'heart-a-disposal',
  'protect-transformer',
  'exploit-transformer',
  'pig-evade',
  'pig-maintain',
  'high-risk-endgame',
  'high-value-endgame',
  'sheep-contest',
  'danger-zone',
  'finish',
  'normal',
];

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function totalUnseenCapacity(knowledge: PublicKnowledge): number {
  return ALL_POSITIONS.reduce(
    (sum, pos) => sum + (pos === knowledge.self ? 0 : knowledge.handSizes[pos]),
    0,
  );
}

function hypergeometricAtLeastOne(total: number, successes: number, draws: number): number {
  if (successes <= 0 || draws <= 0) return 0;
  if (successes >= total) return 1;
  if (total - successes < draws) return 1;
  let none = 1;
  for (let i = 0; i < draws; i++) {
    none *= (total - successes - i) / (total - i);
  }
  return clamp(1 - none);
}

/**
 * 估计某张牌目前最可能由谁持有。只使用公开信息：
 * - 自己的手牌精确；
 * - 已亮且未打出的牌 100% 属于亮牌者；
 * - 其他牌按容量与缺门约束分配。
 */
export function estimateHolderProbabilities(
  card: number,
  knowledge: PublicKnowledge,
): Record<Position, number> {
  const result: Record<Position, number> = { S: 0, E: 0, N: 0, W: 0 };
  const collected = collectedBy(knowledge, card);
  if (collected) {
    result[collected] = 1;
    return result;
  }
  if (knowledge.ownHand.includes(card)) {
    result[knowledge.self] = 1;
    return result;
  }
  const known = knowledge.knownHolders.get(card);
  if (known) {
    result[known] = 1;
    return result;
  }

  const suit = getSuit(card);
  const candidates = ALL_POSITIONS.filter(
    (pos) => pos !== knowledge.self && knowledge.handSizes[pos] > 0 && !knowledge.voids[pos][suit],
  );
  const fallback = candidates.length > 0
    ? candidates
    : ALL_POSITIONS.filter((pos) => pos !== knowledge.self && knowledge.handSizes[pos] > 0);
  const totalCapacity = fallback.reduce((sum, pos) => sum + knowledge.handSizes[pos], 0);
  if (totalCapacity <= 0) return result;
  for (const pos of fallback) {
    result[pos] = knowledge.handSizes[pos] / totalCapacity;
  }
  return result;
}

function unseenHigherCount(card: number, knowledge: PublicKnowledge): number {
  const suit = getSuit(card);
  const rank = getRank(card);
  return knowledge.unseen.filter((c) => getSuit(c) === suit && getRank(c) > rank).length;
}

function knownHigherCountFor(pos: Position, card: number, knowledge: PublicKnowledge): number {
  if (pos === knowledge.self) {
    return knowledge.ownHand.filter(
      (c) => getSuit(c) === getSuit(card) && getRank(c) > getRank(card),
    ).length;
  }
  let known = 0;
  for (const [heldCard, holder] of knowledge.knownHolders) {
    if (
      holder === pos &&
      getSuit(heldCard) === getSuit(card) &&
      getRank(heldCard) > getRank(card)
    ) {
      known += 1;
    }
  }
  return known;
}

/** 某家打出一张牌后赢下该墩的粗略概率。 */
function winWithCard(pos: Position, card: number, knowledge: PublicKnowledge): number {
  // unseen 已经排除了自己的手牌，因此这里不能再用自己的大牌去抵扣对手的大牌，
  // 否则会高估自己的赢墩概率。
  const higher = unseenHigherCount(card, knowledge);
  let probability = 1 / (1 + 0.42 * higher);
  if (pos === knowledge.self) probability *= 1.08;

  if (card === PIG) probability *= 0.45;
  else if (card === TRANSFORMER) probability *= 0.55;
  else if (card === SHEEP) probability *= 0.9;
  else if (getSuit(card) === 2) probability *= getRank(card) >= 9 ? 0.92 : 0.78;

  return clamp(probability, 0.03, 0.97);
}

function captureWeight(pos: Position, card: number, knowledge: PublicKnowledge): number {
  const suit = getSuit(card);
  if (knowledge.voids[pos][suit]) return 0;
  const known = knownHigherCountFor(pos, card, knowledge);
  if (pos === knowledge.self) return known > 0 ? 1 + known * 0.25 : 0;
  const total = knowledge.unseen.length;
  if (total <= 0) return 0;
  const higher = unseenHigherCount(card, knowledge);
  const expected = (knowledge.handSizes[pos] * higher) / total;
  return expected + known * 0.8;
}

/**
 * 估计某家对“剩余红桃”的控制力（0..1）。
 *
 * 全红不是 13 张红桃边际收牌概率的简单乘积：当一家已经收下一圈红桃、
 * 手里只剩 ♥A 时，剩余红桃会高度相关地继续流向这一家，边际乘积会严重低估。
 * 这里用“剩余高红桃（A/K/Q/J/10）的持有份额”作为控制力，供全红概率做下限修正。
 */
function heartControlStrength(
  pos: Position,
  knowledge: PublicKnowledge,
  pendingHearts: number[],
): number {
  if (pos === knowledge.self) {
    const ownHearts = knowledge.ownHand.filter((card) => getSuit(card) === 2);
    if (ownHearts.length === 0) return 0.05;
    const topRank = ownHearts.reduce((best, card) => Math.max(best, getRank(card)), 0);
    const highCount = ownHearts.filter((card) => getRank(card) >= 9).length;
    let control: number;
    if (topRank >= 12) control = 0.95;
    else if (topRank >= 11) control = 0.75;
    else if (topRank >= 9) control = 0.55;
    else control = 0.25;
    control += Math.min(0.1, Math.max(0, highCount - 1) * 0.05);
    return clamp(control);
  }

  // 对对手只能根据公开信息估计：剩余高红桃越可能在其手中，控制力越强。
  let weighted = 0;
  let maxWeight = 0;
  for (const heart of pendingHearts) {
    const rank = getRank(heart);
    if (rank < 9) continue;
    const weight = rank - 8; // 10→2 ... A→4
    maxWeight += weight;
    weighted += estimateHolderProbabilities(heart, knowledge)[pos] * weight;
  }
  if (maxWeight <= 0) return 0.05;
  const share = weighted / maxWeight;
  return clamp(0.05 + 0.95 * share * share);
}

function knownHolderOf(card: number, knowledge: PublicKnowledge): Position | null {
  return knowledge.knownHolders.get(card) ?? null;
}

/** 某家方片长度与高方片（Q/K/A）数量的公开估计；自己精确，对手按容量估计。 */
function diamondProfile(
  pos: Position,
  knowledge: PublicKnowledge,
): { count: number; high: number } | null {
  if (pos === knowledge.self) {
    const diamonds = knowledge.ownHand.filter((card) => getSuit(card) === 1);
    return {
      count: diamonds.length,
      high: diamonds.filter((card) => getRank(card) >= 10).length,
    };
  }
  if (knowledge.voids[pos][1]) return { count: 0, high: 0 };
  const total = totalUnseenCapacity(knowledge);
  if (total <= 0) return null;
  const unseenDiamonds = knowledge.unseen.filter((card) => getSuit(card) === 1);
  const expectedCount = (knowledge.handSizes[pos] * unseenDiamonds.length) / total;
  const high = unseenDiamonds.filter((card) => getRank(card) >= 10).length;
  const expectedHigh = (knowledge.handSizes[pos] * high) / total;
  return { count: expectedCount, high: expectedHigh };
}

/**
 * 持羊（♦J）时，方片越短、越高牌越少，羊越容易被别人的 Q/K/A 抢走。
 * 满贯需要自己收下羊，因此这种情况下满贯概率应下调。
 */
function sheepSlamFactor(pos: Position, knowledge: PublicKnowledge): number {
  if (knowledge.confirmed[pos].sheep) return 1;
  if (knownHolderOf(SHEEP, knowledge) !== pos) return 1;
  const profile = diamondProfile(pos, knowledge);
  if (!profile) return 1;
  if (profile.count <= 2.5 && profile.high < 0.5) return 0.55;
  if (profile.count <= 3.5 && profile.high < 1) return 0.75;
  if (profile.count <= 2.5 && profile.high < 1.5) return 0.8;
  return 1;
}

/**
 * 持猪（♠Q）时，早期落猪通常无人抢；即使黑桃短，也不构成满贯障碍。
 * 这里只上调“自己收下猪”的概率，不改变猪在其他策略中的基础估计。
 */
function pigSlamProbability(pos: Position, pPig: number, knowledge: PublicKnowledge): number {
  if (knowledge.confirmed[pos].pig) return 1;
  if (knownHolderOf(PIG, knowledge) !== pos) return pPig;
  const early = clamp(1 - knowledge.tricksPlayed / 13, 0, 1);
  const secure = 0.6 + 0.35 * early;
  return clamp(Math.max(pPig, secure), 0, 1);
}

/** 其他家已经收到红桃或任意关键牌时，本家不可能再收满贯。 */
function otherSeatBlocksGrandSlam(
  pos: Position,
  confirmed: Record<Position, ConfirmedSeatState>,
): boolean {
  return ALL_POSITIONS.some(
    (other) =>
      other !== pos &&
      (confirmed[other].hearts > 0 ||
        confirmed[other].pig ||
        confirmed[other].sheep ||
        confirmed[other].transformer),
  );
}

/** 估计某张尚未结算的牌最终进入每家收牌区的概率。 */
export function estimateCollectionProbabilities(
  card: number,
  knowledge: PublicKnowledge,
): Record<Position, number> {
  const result: Record<Position, number> = { S: 0, E: 0, N: 0, W: 0 };
  const collected = collectedBy(knowledge, card);
  if (collected) {
    result[collected] = 1;
    return result;
  }
  if (knowledge.currentTrick.plays.some((play) => play.card === card)) {
    return estimateTrickWinnerProbabilities(knowledge.currentTrick.plays, knowledge);
  }

  const holders = estimateHolderProbabilities(card, knowledge);
  for (const pos of ALL_POSITIONS) {
    const holderProb = holders[pos];
    if (holderProb <= 0) continue;
    const winProb = winWithCard(pos, card, knowledge);
    result[pos] += holderProb * winProb;

    const remainder = holderProb * (1 - winProb);
    if (remainder <= 0) continue;
    const weights: Record<Position, number> = { S: 0, E: 0, N: 0, W: 0 };
    let totalWeight = 0;
    for (const other of ALL_POSITIONS) {
      if (other === pos) continue;
      const weight = captureWeight(other, card, knowledge);
      weights[other] = weight;
      totalWeight += weight;
    }
    if (totalWeight > 0) {
      for (const other of ALL_POSITIONS) {
        if (weights[other] > 0) result[other] += (remainder * weights[other]) / totalWeight;
      }
    } else {
      result[pos] += remainder;
    }
  }

  let sum = 0;
  for (const pos of ALL_POSITIONS) sum += result[pos];
  if (sum > 0) {
    for (const pos of ALL_POSITIONS) result[pos] /= sum;
  }
  return result;
}

/** 当前墩（或加入一张候选牌后的墩）各家赢墩概率。 */
export function estimateTrickWinnerProbabilities(
  plays: CardPlay[],
  knowledge: PublicKnowledge,
): Record<Position, number> {
  const result: Record<Position, number> = { S: 0, E: 0, N: 0, W: 0 };
  if (plays.length === 0) return result;
  if (plays.length >= 4) {
    const leadSuit = getSuit(plays[0].card);
    let best = plays[0];
    for (const play of plays.slice(1)) {
      if (getSuit(play.card) !== leadSuit) continue;
      if (getRank(play.card) > getRank(best.card)) best = play;
    }
    result[best.position] = 1;
    return result;
  }

  const leadSuit = getSuit(plays[0].card);
  let best = plays[0];
  for (const play of plays.slice(1)) {
    if (getSuit(play.card) !== leadSuit) continue;
    if (getRank(play.card) > getRank(best.card)) best = play;
  }

  // 出牌顺序是循环的（S→E→N→W→S），不能简单截取 ORDER 的尾部。
  // 例如北家领出、西家已跟牌后，下一家应是南家，而不是“没有后续玩家”。
  const leader = plays[0].position;
  const last = plays[plays.length - 1].position;
  const remaining: Position[] = [];
  let cursor = ORDER.indexOf(last);
  for (let i = 0; i < 3; i++) {
    cursor = (cursor + 1) % ORDER.length;
    const pos = ORDER[cursor];
    if (pos === leader) break;
    remaining.push(pos);
  }
  let dist: Record<Position, number> = { S: 0, E: 0, N: 0, W: 0 };
  dist[best.position] = 1;

  for (const pos of remaining) {
    let beat = 0;
    if (!knowledge.voids[pos][leadSuit]) {
      if (pos === knowledge.self) {
        beat = knowledge.ownHand.some(
          (card) => getSuit(card) === leadSuit && getRank(card) > getRank(best.card),
        )
          ? 0.92
          : 0;
      } else {
        const total = knowledge.unseen.length;
        const higher = knowledge.unseen.filter(
          (card) => getSuit(card) === leadSuit && getRank(card) > getRank(best.card),
        ).length;
        const known = knownHigherCountFor(pos, best.card, knowledge);
        const base = higher > 0
          ? hypergeometricAtLeastOne(total, higher, knowledge.handSizes[pos])
          : 0;
        beat = clamp(base + known * 0.35, 0, 0.95) * 0.78;
      }
    }

    const next: Record<Position, number> = { S: 0, E: 0, N: 0, W: 0 };
    for (const winner of ALL_POSITIONS) {
      const probability = dist[winner];
      if (probability <= 0) continue;
      next[winner] += probability * (1 - beat);
      next[pos] += probability * beat;
    }
    dist = next;
  }

  let sum = 0;
  for (const pos of ALL_POSITIONS) sum += dist[pos];
  if (sum > 0) {
    for (const pos of ALL_POSITIONS) result[pos] = dist[pos] / sum;
  }
  return result;
}

function effectiveHeartValue(card: number, knowledge: PublicKnowledge): number {
  const base = baseHeartValue(card);
  return knowledge.litCards.includes(HEART_A) ? base * 2 : base;
}

function pendingHeartCards(knowledge: PublicKnowledge): number[] {
  return [...knowledge.heartRemaining];
}

function seatSubtotalEstimate(
  pos: Position,
  knowledge: PublicKnowledge,
  pAllRed: number,
  pPig: number,
  pSheep: number,
  pendingHearts: number[],
  heartProbs: Map<number, Record<Position, number>>,
): number {
  const confirmed = knowledge.confirmed[pos];
  let subtotal = confirmed.subtotal;

  if (!isCollected(knowledge, PIG) && pPig > 0) {
    subtotal += pPig * (knowledge.litCards.includes(PIG) ? -200 : -100);
  }
  if (!isCollected(knowledge, SHEEP) && pSheep > 0) {
    subtotal += pSheep * (knowledge.litCards.includes(SHEEP) ? 200 : 100);
  }

  let futureHearts = 0;
  for (const heart of pendingHearts) {
    const probs = heartProbs.get(heart);
    if (!probs) continue;
    futureHearts += probs[pos] * effectiveHeartValue(heart, knowledge);
  }
  // 全红会反转红桃分：全红概率越高，红桃越可能变成正分。
  if (pAllRed > 0.3) futureHearts += pAllRed * 220;
  subtotal += futureHearts;
  return subtotal;
}

function buildSeatThreat(
  pos: Position,
  knowledge: PublicKnowledge,
  keyProbs: Map<number, Record<Position, number>>,
  pendingHearts: number[],
  heartProbs: Map<number, Record<Position, number>>,
): SeatThreat {
  const confirmed = knowledge.confirmed[pos];
  const otherCollectedHearts = ALL_POSITIONS.some(
    (other) => other !== pos && knowledge.confirmed[other].hearts > 0,
  );

  let pAllRed = 0;
  if (confirmed.hearts === 13) pAllRed = 1;
  else if (otherCollectedHearts) pAllRed = 0;
  else if (pendingHearts.length === 0) pAllRed = 0;
  else {
    let product = 1;
    for (const heart of pendingHearts) {
      const probs = heartProbs.get(heart);
      product *= probs ? probs[pos] : 0;
    }

    // 已收红桃越多、剩余高红桃控制越强，全红概率越高。
    // 边际乘积在“收下一圈红桃、手中仅剩 ♥A”时会低估到接近 0，
    // 这里用进度 × 控制力给出一个下限，同时仍保留硬事实（其他家已收红桃为 0）。
    const progress = confirmed.hearts / 13;
    const control = heartControlStrength(pos, knowledge, pendingHearts);
    if (progress >= 0.3 && control >= 0.45 && knowledge.handSizes[pos] > 0) {
      const controlFloor = progress * (0.15 + 0.85 * control);
      product = Math.max(product, controlFloor);
    }
    pAllRed = clamp(product, 0, 0.995);
  }

  const pPig = keyProbs.get(PIG)?.[pos] ?? 0;
  const pSheep = keyProbs.get(SHEEP)?.[pos] ?? 0;
  const pTransformer = keyProbs.get(TRANSFORMER)?.[pos] ?? 0;
  const pHeartA = keyProbs.get(HEART_A)?.[pos] ?? 0;

  let keyProgress = confirmed.keyCards;
  if (!confirmed.pig) keyProgress += pigSlamProbability(pos, pPig, knowledge);
  if (!confirmed.sheep) keyProgress += pSheep * sheepSlamFactor(pos, knowledge);
  if (!confirmed.transformer) keyProgress += pTransformer;
  const completion = clamp(keyProgress / 3, 0, 1);
  // 满贯必须以“收齐 13 张红桃”为前提：全红概率为 0 时，满贯概率也必然为 0。
  // 其他家已经收到红桃、羊、变压器或猪时，本家也不可能再集齐全部关键牌。
  const pGrandSlam = otherSeatBlocksGrandSlam(pos, knowledge.confirmed)
    ? 0
    : pAllRed * Math.pow(completion, 1.5);

  const subtotalEstimate = seatSubtotalEstimate(
    pos,
    knowledge,
    pAllRed,
    pPig,
    pSheep,
    pendingHearts,
    heartProbs,
  );

  let pTransformerNegative = 0;
  if (pTransformer > 0) {
    if (confirmed.transformer) {
      pTransformerNegative = subtotalEstimate < 0 ? pTransformer : subtotalEstimate === 0 ? 0.5 : 0;
    } else {
      const negativeLikelihood = clamp(0.5 - subtotalEstimate / 240, 0.02, 0.98);
      pTransformerNegative = pTransformer * negativeLikelihood * (1 - pAllRed * 0.65);
    }
  }

  let bigHeartProb = 0;
  for (const heart of pendingHearts) {
    if (getRank(heart) >= 9) {
      bigHeartProb += heartProbs.get(heart)?.[pos] ?? 0;
    }
  }
  const trapComponents = (confirmed.pig ? 1 : pPig) + Math.min(1, bigHeartProb);
  const pTransformerTrap =
    pTransformer * clamp(trapComponents, 0, 1) * (1 - pAllRed * 0.7);

  const pEffectivePig = pPig * (1 - 0.75 * pGrandSlam);
  const confidence = clamp(0.35 + 0.65 * (1 - knowledge.unseen.length / 52), 0, 1);

  return {
    seat: pos,
    team: teamOf(pos),
    pAllRed,
    pGrandSlam,
    pPig,
    pSheep,
    pTransformer,
    pTransformerNegative,
    pTransformerTrap,
    pHeartA,
    pEffectivePig,
    confidence,
    confirmed,
    subtotalEstimate,
  };
}

function aggregateTeam(
  seats: Position[],
  seatThreat: Record<Position, SeatThreat>,
  knowledge: PublicKnowledge,
  team: Team,
): TeamThreat {
  const sum = (key: keyof SeatThreat) =>
    seats.reduce((total, pos) => total + (seatThreat[pos][key] as number), 0);

  const current = knowledge.smallScores[team];
  const pGrandSlamAny = clamp(sum('pGrandSlam'));
  const pAllRedAny = clamp(sum('pAllRed'));
  // 满贯必须建立在全红之上，且关键牌不能被其他家收走。
  // 只要其他家已经收到红桃/羊/变压器/猪，这一家就不可能再收满贯。
  const otherSeatHasHearts = (pos: Position) =>
    ALL_POSITIONS.some(
      (other) => other !== pos && seatThreat[other].confirmed.hearts > 0,
    );
  const maxGrandSlamProgress = seats.reduce(
    (best, pos) =>
      otherSeatBlocksGrandSlam(pos, knowledge.confirmed)
        ? best
        : Math.max(best, seatThreat[pos].confirmed.keyCards / 3),
    0,
  );
  const maxAllRedProgress = seats.reduce((best, pos) => {
    return otherSeatHasHearts(pos)
      ? best
      : Math.max(best, seatThreat[pos].confirmed.hearts / 13);
  }, 0);
  const expectedSwing =
    120 +
    pGrandSlamAny * 180 +
    pAllRedAny * 90 -
    sum('pPig') * 55 -
    sum('pTransformerTrap') * 45;

  const pPositive1000 =
    current >= 1000 ? 1 : sigmoid((current + expectedSwing - 1000) / 260);
  const pNegative1000 =
    current <= -1000 ? 1 : sigmoid((-1000 - (current - expectedSwing)) / 260);

  return {
    pAllRedAny,
    pGrandSlamAny,
    maxGrandSlamProgress,
    maxAllRedProgress,
    pPositive1000,
    pNegative1000,
    pPigAny: clamp(sum('pPig')),
    pSheepAny: clamp(sum('pSheep')),
    pTransformerTrapAny: clamp(sum('pTransformerTrap')),
  };
}

export function analyzeRemainingCards(knowledge: PublicKnowledge): RemainingAnalysis {
  const sheepRemaining = !isCollected(knowledge, SHEEP);
  const pigRemaining = !isCollected(knowledge, PIG);
  const transformerRemaining = !isCollected(knowledge, TRANSFORMER);
  const heartARemaining = !isCollected(knowledge, HEART_A);

  const pendingHearts = pendingHeartCards(knowledge);
  const bigHeartsRemaining = pendingHearts.filter((card) => getRank(card) >= 9);
  const bigHeartsValue = bigHeartsRemaining.reduce(
    (sum, card) => sum + Math.abs(effectiveHeartValue(card, knowledge)),
    0,
  );

  const sheepLit = knowledge.litCards.includes(SHEEP);
  const pigLit = knowledge.litCards.includes(PIG);
  const transformerLit = knowledge.litCards.includes(TRANSFORMER);

  // 变压器会把收牌者的小计翻倍：剩余猪/红桃使小计为负时，变压器更可能是负收益。
  const heartAScale = knowledge.litCards.includes(HEART_A) ? 2 : 1;
  const remainingHeartSum = pendingHearts.reduce(
    (sum, card) => sum + baseHeartValue(card) * heartAScale,
    0,
  );
  const expectedSubtotal =
    (pigRemaining ? -(pigLit ? 200 : 100) : 0) +
    (sheepRemaining ? (sheepLit ? 200 : 100) : 0) +
    remainingHeartSum;
  const transformerLikelyPositive = expectedSubtotal > 0;
  const positiveTargetsValue =
    (sheepRemaining ? (sheepLit ? 200 : 100) : 0) +
    (transformerRemaining && transformerLikelyPositive ? (transformerLit ? 100 : 50) : 0);
  const negativeRiskValue =
    (pigRemaining ? (pigLit ? 200 : 100) : 0) +
    (transformerRemaining && !transformerLikelyPositive ? (transformerLit ? 100 : 50) : 0) +
    bigHeartsValue;

  const highValueEndgame =
    positiveTargetsValue >= 100 &&
    negativeRiskValue <= positiveTargetsValue * 0.8 &&
    bigHeartsValue <= 20;
  const highRiskEndgame =
    negativeRiskValue >= 100 &&
    positiveTargetsValue <= negativeRiskValue * 0.8;

  return {
    sheepRemaining,
    pigRemaining,
    transformerRemaining,
    heartARemaining,
    sheepLit,
    pigLit,
    transformerLit,
    bigHeartsRemaining,
    bigHeartsValue,
    positiveTargetsValue,
    negativeRiskValue,
    highValueEndgame,
    highRiskEndgame,
  };
}

function detectModes(
  seatThreat: Record<Position, SeatThreat>,
  own: TeamThreat,
  opp: TeamThreat,
  remaining: RemainingAnalysis,
  knowledge: PublicKnowledge,
): ThreatMode[] {
  const modes = new Set<ThreatMode>();
  const ownSeats = ALL_POSITIONS.filter((pos) => teamOf(pos) === knowledge.ownTeam);
  const oppSeats = ALL_POSITIONS.filter((pos) => teamOf(pos) === knowledge.opponentTeam);

  const otherSeatHasHearts = (pos: Position) =>
    ALL_POSITIONS.some(
      (other) => other !== pos && seatThreat[other].confirmed.hearts > 0,
    );
  /**
   * 概率不高但“进度”已经很危险：敌方三张关键牌全收且红桃过半。
   * 满贯必须建立在全红之上，且其他家不能已经收走任何关键牌；
   * 因此其他家已有红桃/羊/变压器/猪时，不再按进度报警。
   */
  const nearSlam = (pos: Position) =>
    seatThreat[pos].pGrandSlam > 0.25 ||
    (!otherSeatBlocksGrandSlam(pos, knowledge.confirmed) &&
      seatThreat[pos].confirmed.keyCards >= 3 &&
      seatThreat[pos].confirmed.hearts >= 6);
  /** 已收 8 张以上红桃且其他家一张未收，剩余红桃随时可能凑成全红。 */
  const nearAllRed = (pos: Position) =>
    seatThreat[pos].pAllRed > 0.4 ||
    (seatThreat[pos].confirmed.hearts >= 8 && !otherSeatHasHearts(pos));

  if (ownSeats.some(nearSlam)) {
    if (nearSlam(knowledge.self)) modes.add('own-slam');
    if (nearSlam(knowledge.partner)) modes.add('partner-slam');
  }
  if (oppSeats.some(nearSlam)) modes.add('break-opp-slam');

  if (nearAllRed(knowledge.self)) modes.add('own-allred');
  if (nearAllRed(knowledge.partner)) modes.add('partner-allred');
  if (oppSeats.some(nearAllRed)) modes.add('break-opp-allred');

  // ♥A + 少量小：自己收全红的概率很低，♥A 继续留在手里只会成为负担。
  // 除非能垫给同伴/非全红目标的敌方，否则应尽早用 ♥A 落墩，顺便剥夺敌方拿齐红桃的机会。
  const ownHearts = knowledge.ownHand.filter((card) => getSuit(card) === 2);
  const ownBigHearts = ownHearts.filter((card) => getRank(card) >= 9);
  const selfThreat = seatThreat[knowledge.self];
  if (
    ownHearts.includes(HEART_A) &&
    ownHearts.length <= 5 &&
    ownBigHearts.length <= 1 &&
    selfThreat.pAllRed < 0.2 &&
    !nearSlam(knowledge.self) &&
    !nearAllRed(knowledge.self)
  ) {
    modes.add('heart-a-disposal');
  }

  const partnerThreat = seatThreat[knowledge.partner];
  if (
    partnerThreat.pTransformerNegative > 0.4 &&
    partnerThreat.pAllRed < 0.5 &&
    partnerThreat.pGrandSlam < 0.35
  ) {
    modes.add('protect-transformer');
  }
  if (oppSeats.some((pos) => seatThreat[pos].pTransformerNegative > 0.4)) {
    modes.add('exploit-transformer');
  }

  if (own.pPigAny > 0.5) modes.add('pig-evade');
  if (opp.pPigAny > 0.6) modes.add('pig-maintain');
  if (remaining.sheepRemaining && own.pSheepAny < 0.4) modes.add('sheep-contest');
  if (own.pNegative1000 > 0.3) modes.add('danger-zone');
  if (own.pPositive1000 > 0.5) modes.add('finish');
  if (remaining.highRiskEndgame) modes.add('high-risk-endgame');
  if (remaining.highValueEndgame) modes.add('high-value-endgame');

  if (modes.size === 0) modes.add('normal');
  return MODE_PRIORITY.filter((mode) => modes.has(mode));
}

/** 估计四方动态概率与当前策略模式。 */
export function estimateThreats(obs: PlayObservation, knowledge: PublicKnowledge): ThreatModel {
  const keyCards = [PIG, SHEEP, TRANSFORMER, HEART_A];
  const keyProbs = new Map<number, Record<Position, number>>();
  for (const card of keyCards) {
    keyProbs.set(card, estimateCollectionProbabilities(card, knowledge));
  }

  const pendingHearts = pendingHeartCards(knowledge);
  const heartProbs = new Map<number, Record<Position, number>>();
  for (const heart of pendingHearts) {
    heartProbs.set(heart, estimateCollectionProbabilities(heart, knowledge));
  }

  const seat = {} as Record<Position, SeatThreat>;
  for (const pos of ALL_POSITIONS) {
    seat[pos] = buildSeatThreat(pos, knowledge, keyProbs, pendingHearts, heartProbs);
  }

  const ownSeats = ALL_POSITIONS.filter((pos) => teamOf(pos) === obs.team);
  const oppSeats = ALL_POSITIONS.filter((pos) => teamOf(pos) === obs.opponentTeam);
  const own = aggregateTeam(ownSeats, seat, knowledge, obs.team);
  const opp = aggregateTeam(oppSeats, seat, knowledge, obs.opponentTeam);
  const remaining = analyzeRemainingCards(knowledge);
  const modes = detectModes(seat, own, opp, remaining, knowledge);

  return { seat, own, opp, modes, remaining };
}

export function hasMode(threat: ThreatModel, mode: ThreatMode): boolean {
  return threat.modes.includes(mode);
}

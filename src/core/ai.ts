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
import type { CardPlay, Position } from '../models/game';
import { getPartner } from '../models/game';

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
}

/**
 * 基础亮牌策略：
 * - 羊：持有即倾向亮；
 * - 变压器：梅花较长或已有羊时亮；
 * - ♥A：红桃很少（可甩掉）或很多（做全红）时亮；
 * - 猪：黑桃很多（可控）或很少（可断门甩猪）时亮。
 * 只读取自己的手牌与公开分数，不读取他人手牌。
 */
export function chooseLights(input: LightAiInput): number[] {
  const { hand } = input;
  const spades = hand.filter((card) => getSuit(card) === 3).length;
  const diamonds = hand.filter((card) => getSuit(card) === 1).length;
  const clubs = hand.filter((card) => getSuit(card) === 0).length;
  const hearts = hand.filter((card) => getSuit(card) === 2).length;

  const needPoints = input.teamSmallScore < -400 || input.opponentSmallScore > 600;
  const result: number[] = [];

  if (hand.includes(SHEEP)) {
    // 羊是正分资源，基础策略倾向亮；方块太短时保守一点
    if (diamonds >= 2 || needPoints) result.push(SHEEP);
  }

  if (hand.includes(TRANSFORMER)) {
    // 变压器会放大收牌者分数：自己有正分潜力时亮
    if (clubs >= 3 || hand.includes(SHEEP) || needPoints) result.push(TRANSFORMER);
  }

  if (hand.includes(HEART_A)) {
    // 红桃很少：容易把 ♥A 甩出去；红桃很多：可能冲全红
    if (hearts <= 2 || hearts >= 10) result.push(HEART_A);
  }

  if (hand.includes(PIG)) {
    // 黑桃很多可控猪，黑桃很少可断门甩猪
    if (spades >= 5 || spades <= 1) result.push(PIG);
  }

  // 局势落后时略微提高亮牌积极性（羊/变已在上面处理）
  return result;
}

/* ------------------------------------------------------------------ *
 * 出牌 AI
 * ------------------------------------------------------------------ */

export interface PlayAiInput {
  hand: number[];
  position: Position;
  currentTrick: CardPlay[];
  legalCards: number[];
  litCards: number[];
  /** 是否是本墩最后一个出牌者 */
  isLastToPlay: boolean;
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

/**
 * 基础出牌策略：合法出牌、基本跟牌/垫牌、基础计分规避。
 * - 领出：优先低点数非计分牌，避免主动送猪/红桃；
 * - 跟牌：若当前赢家是搭档，尽量不盖压；
 * - 能赢且本墩为正分时争墩；本墩为负分时尽量垫负分牌。
 */
export function choosePlay(input: PlayAiInput): number {
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
      /* 领出 */
      score = -getRank(card) * 0.8;
      if (scoring) score -= 12;
      if (card === PIG) score -= 80;
      if (card === TRANSFORMER) score -= 25;
      if (card === SHEEP) score -= 10;
      if (cardSuit === 2) score -= 30; // 主动领红桃负分
      const suitLength = hand.filter((c) => getSuit(c) === cardSuit).length;
      if (suitLength >= 4) score += 6; // 长套可先出小牌
      if (cardSuit === 3 && hand.includes(PIG)) score -= 4; // 有猪时谨慎动黑桃
    } else {
      /* 跟牌 */
      const winsNow =
        leadSuit !== null &&
        cardSuit === leadSuit &&
        (best === null || getRank(card) > getRank(best.card));
      const pointsNow = trickPoints(currentTrick, card);

      if (winsNow) {
        score += pointsNow;
        score += 8; // 赢墩获得下一墩领出权
        if (partnerWinning) score -= 30; // 不抢搭档的墩
        if (cardPoints < 0) score -= 20; // 用负分牌赢墩不划算
        if (pointsNow > 0) score += 6;
        if (isLastToPlay) score += 2;
      } else {
        // 垫牌：负分牌甩出去是好事，正分牌尽量别丢
        score += cardPoints < 0 ? -cardPoints * 0.55 : -cardPoints * 0.95;
        score += -getRank(card) * 0.35;
        if (partnerWinning && cardPoints > 0) score += 12; // 搭档赢墩，正分牌给搭档可接受
        if (!partnerWinning && cardPoints > 0) score -= 8;
        if (isLastToPlay) {
          // 最后一家已知结果：如果无法赢墩，负分牌更值得甩
          if (cardPoints < 0) score += 4;
        }
      }

      // 有领出花色时必须跟牌，尽量跟小牌；无该花色时优先非计分牌
      const hasLeadSuit = leadSuit !== null && hand.some((c) => getSuit(c) === leadSuit);
      if (!hasLeadSuit && scoring) score -= 3;
    }

    // 轻微随机扰动，避免 AI 出牌完全固定
    score += Math.random() * 0.01;

    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  return bestCard;
}

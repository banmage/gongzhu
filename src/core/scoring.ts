import {
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  baseHeartValue,
  getSuit,
} from '../models/card';
import {
  ALL_POSITIONS,
  teamOf,
  type DealScore,
  type Position,
  type ScoreBreakdown,
  type SlamInfo,
  type Team,
} from '../models/game';
import { isGrandSlam, slamPigHeads } from './rules';

export interface ScoreDealInput {
  collected: Record<Position, number[]>;
  litCards: number[];
  litBy: Record<number, Position>;
  autoLitCards?: number[];
  /**
   * 亮猪者亮牌时手中的黑桃张数。
   * 为 1 时，亮猪者自收♠Q 属于“单张黑桃被迫收猪”，不记窝猪。
   */
  pigLighterSpadeCount?: number;
}

/**
 * 单副牌计分流水线（SRS 5.2），顺序不可调换：
 * 1. 统计实际收牌
 * 2. 判满贯
 * 3. 亮牌修正（猪/羊/♥A）
 * 4. 全红反转
 * 5. 窝猪
 * 6. 变压器倍率
 * 7. 个人正式分
 * 8. 团队本副小分
 */
export function scoreDeal(input: ScoreDealInput): DealScore {
  const { collected, litCards, litBy } = input;
  const litSet = new Set(litCards);
  const pigLit = litSet.has(PIG);
  const sheepLit = litSet.has(SHEEP);
  const transformerLit = litSet.has(TRANSFORMER);
  const heartALit = litSet.has(HEART_A);

  const slamPosition = ALL_POSITIONS.find((pos) => isGrandSlam(collected[pos]));
  /** 亮猪时手上只有一张黑桃（必然是♠Q）：自收♠Q 不记窝猪 */
  const pigLighterSingleSpade = input.pigLighterSpadeCount === 1;

  const breakdowns = {} as Record<Position, ScoreBreakdown>;
  for (const position of ALL_POSITIONS) {
    breakdowns[position] = buildBreakdown({
      position,
      cards: collected[position],
      pigLit,
      pigLighter: litBy[PIG],
      pigLighterSingleSpade,
      sheepLit,
      transformerLit,
      heartALit,
      /** 满贯者不计算猪负分，也不触发窝猪 */
      suppressPig: slamPosition === position,
      slamTriggered: slamPosition !== undefined,
    });
  }

  const teamScores: Record<Team, number> = { A: 0, B: 0 };
  for (const position of ALL_POSITIONS) {
    teamScores[teamOf(position)] += breakdowns[position].final;
  }

  const allKeyCardsLit = litCards.length === 4;
  const slam: SlamInfo = slamPosition
    ? {
        triggered: true,
        position: slamPosition,
        team: teamOf(slamPosition),
        allKeyCardsLit,
        pigHeads: slamPigHeads(allKeyCardsLit),
      }
    : { triggered: false, allKeyCardsLit, pigHeads: 0 };

  return {
    breakdowns,
    teamScores,
    slam,
    official: !slam.triggered,
    litCards: [...litCards],
    litBy: { ...litBy },
    autoLitCards: [...(input.autoLitCards ?? [])],
  };
}

interface BreakdownInput {
  position: Position;
  cards: number[];
  pigLit: boolean;
  pigLighter?: Position;
  pigLighterSingleSpade: boolean;
  sheepLit: boolean;
  transformerLit: boolean;
  heartALit: boolean;
  suppressPig: boolean;
  slamTriggered: boolean;
}

function buildBreakdown(input: BreakdownInput): ScoreBreakdown {
  const { position, cards } = input;
  const notes: string[] = [];

  const hasPig = cards.includes(PIG);
  const hasSheep = cards.includes(SHEEP);
  const hasTransformer = cards.includes(TRANSFORMER);
  const hearts = cards.filter((card) => getSuit(card) === 2);

  /* ---- 猪 ---- */
  let pigBase = 0;
  let pigLitAdj = 0;
  let ownPigAdj = 0;
  let ownPigExempt = false;
  if (hasPig) {
    if (input.suppressPig) {
      notes.push('满贯：猪不计负分');
    } else {
      pigBase = -100;
      if (input.pigLit) {
        pigLitAdj = -100;
        notes.push('亮猪：猪分 -100 → -200');
        if (input.pigLighter === position) {
          if (input.pigLighterSingleSpade) {
            ownPigExempt = true;
            notes.push('单张黑桃亮猪：自收♠Q 属被迫收猪，不记窝猪，仍按亮猪 -200');
          } else {
            ownPigAdj = -200;
            notes.push('窝猪：亮猪者自收♠Q，猪分记 -400');
          }
        }
      }
    }
  }
  const pigTotal = pigBase + pigLitAdj + ownPigAdj;

  /* ---- 羊 ---- */
  const sheepBase = hasSheep ? 100 : 0;
  const sheepLitAdj = hasSheep && input.sheepLit ? 100 : 0;
  if (hasSheep && input.sheepLit) notes.push('亮羊：羊分 +100 → +200');
  const sheepTotal = sheepBase + sheepLitAdj;

  /* ---- 红桃 ---- */
  const heartsBase = hearts.reduce((sum, card) => sum + baseHeartValue(card), 0);
  const allRed = hearts.length === 13;
  /** 亮♥A：全场所有选手的红桃分值都×2（含♥A自身），与谁亮、谁收无关 */
  const heartALitForPlayer = input.heartALit && hearts.length > 0;
  let heartsTotal = heartsBase;
  if (heartALitForPlayer) {
    notes.push('亮♥A：全场红桃分值 ×2（含♥A自身）');
  }
  if (allRed) {
    const doubled = input.heartALit ? heartsBase * 2 : heartsBase;
    heartsTotal = -doubled;
    notes.push(
      input.heartALit
        ? '全红：红桃 -400 → +400（先按亮♥A全场翻倍，再反转）'
        : '全红：红桃 -200 → +200',
    );
  } else if (input.heartALit) {
    heartsTotal = heartsBase * 2;
  }
  const heartLitAdj = heartsTotal - heartsBase;

  /* ---- 小计（变压器之前） ---- */
  const subtotal = pigTotal + sheepTotal + heartsTotal;

  /* ---- 变压器 ---- */
  const otherScoringCards = hasPig || hasSheep || hearts.length > 0;
  const transformerSolo = hasTransformer && !otherScoringCards;
  let transformerAdj = 0;
  if (hasTransformer) {
    if (transformerSolo) {
      transformerAdj = input.transformerLit ? 100 : 50;
      notes.push(`变压器独拿：+${transformerAdj}`);
    } else if (subtotal === 0) {
      transformerAdj = 0;
      notes.push('变压器非独拿：修正后总分为 0，×2/×4 仍为 0');
    } else {
      const multiplier = input.transformerLit ? 4 : 2;
      transformerAdj = subtotal * multiplier - subtotal;
      notes.push(`变压器非独拿：${subtotal} × ${multiplier} = ${subtotal * multiplier}`);
    }
  }

  const final = subtotal + transformerAdj;
  if (input.slamTriggered) notes.push('满贯：本副不生成正式个人分，此分为模拟展示分');

  return {
    position,
    collected: [...cards],
    pigBase,
    pigLitAdj,
    ownPigAdj,
    ownPigExempt,
    pigTotal,
    sheepBase,
    sheepLitAdj,
    sheepTotal,
    heartsBase,
    heartALit: heartALitForPlayer,
    heartLitAdj,
    heartsTotal,
    allRed,
    subtotal,
    hasTransformer,
    transformerLit: input.transformerLit,
    transformerSolo,
    transformerAdj,
    final,
    notes,
  };
}

/** 展示用的收牌分类 */
export function collectedSummary(cards: number[]): {
  pig: boolean;
  sheep: boolean;
  transformer: boolean;
  hearts: number;
  allRed: boolean;
} {
  return {
    pig: cards.includes(PIG),
    sheep: cards.includes(SHEEP),
    transformer: cards.includes(TRANSFORMER),
    hearts: cards.filter((card) => getSuit(card) === 2).length,
    allRed: cards.filter((card) => getSuit(card) === 2).length === 13,
  };
}

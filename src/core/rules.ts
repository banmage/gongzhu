import {
  PIG,
  SHEEP,
  TRANSFORMER,
  baseHeartValue,
  cardBasePoints,
  getRank,
  getSuit,
  type SuitIndex,
} from '../models/card';
import {
  otherTeam,
  resultText,
  teamName,
  type CardPlay,
  type MatchFormat,
  type MatchOutcome,
  type PigHeadResult,
  type Position,
  type RoundRecord,
  type SuitStatus,
  type Team,
} from '../models/game';

/* ------------------------------------------------------------------ *
 * 手牌展示排序
 * ------------------------------------------------------------------ */

const SUIT_DISPLAY_ORDER: SuitIndex[] = [3, 2, 0, 1];

/** 排序：♠ > ♥ > ♣ > ♦，同花色点数从 A 到 2 降序 */
export function sortHand(hand: number[]): number[] {
  return [...hand].sort((a, b) => {
    const ia = SUIT_DISPLAY_ORDER.indexOf(getSuit(a));
    const ib = SUIT_DISPLAY_ORDER.indexOf(getSuit(b));
    if (ia !== ib) return ia - ib;
    return getRank(b) - getRank(a);
  });
}

/* ------------------------------------------------------------------ *
 * 合法出牌
 * ------------------------------------------------------------------ */

export interface LegalContext {
  hand: number[];
  /** 本墩领出花色；null 表示由该玩家领出 */
  leadSuit: SuitIndex | null;
  /** 本墩是否为该花色“首次作为领出花色”的一墩 */
  isFirstLedSuit: boolean;
  /** 本副已亮出的关键牌 */
  litCards: number[];
  /** 各花色首轮状态 */
  suitStatus: Record<SuitIndex, SuitStatus>;
}

function isRestrictedByFirstLead(card: number, litCards: number[], suitStatus: Record<SuitIndex, SuitStatus>): boolean {
  return litCards.includes(card) && suitStatus[getSuit(card)] === 'NOT_LED';
}

/**
 * 返回当前合法出牌集合。
 *
 * 首轮限制（SRS 4.2.4）：
 * - 每副牌中，某花色第一次作为领出花色的一墩，该花色中被亮过的牌不能领出、不能跟牌；
 * - 例外①：跟牌时若手中该花色只剩受限制亮牌，则必须出；
 * - 例外②：领出时若手中只剩受限制亮牌，兜底允许任选一张领出，避免死锁。
 */
export function getLegalCards(ctx: LegalContext): number[] {
  const { hand, leadSuit, isFirstLedSuit, litCards, suitStatus } = ctx;

  // 领出：首引花色无限制，只受“该花色尚未领出时的亮牌限制”影响
  if (leadSuit === null) {
    const allowed = hand.filter((card) => !isRestrictedByFirstLead(card, litCards, suitStatus));
    // 兜底：手中全是受限制亮牌时允许任选一张领出
    return allowed.length > 0 ? allowed : [...hand];
  }

  // 跟牌：有领出花色必须跟
  const sameSuit = hand.filter((card) => getSuit(card) === leadSuit);
  if (sameSuit.length === 0) return [...hand];

  if (!isFirstLedSuit) return sameSuit;

  const allowed = sameSuit.filter((card) => !litCards.includes(card));
  // 例外①：该花色只剩受限制亮牌时必须出
  return allowed.length > 0 ? allowed : sameSuit;
}

export function isCardLegal(card: number, ctx: LegalContext): boolean {
  if (!ctx.hand.includes(card)) return false;
  return getLegalCards(ctx).includes(card);
}

/** 超时自动出牌：优先非计分牌，再按点数最小（SRS 8.2） */
export function pickTimeoutCard(legalCards: number[]): number {
  if (legalCards.length === 0) throw new Error('没有合法出牌');
  const sorted = [...legalCards].sort((a, b) => {
    const sa = isScoringForTimeout(a) ? 1 : 0;
    const sb = isScoringForTimeout(b) ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return getRank(a) - getRank(b);
  });
  return sorted[0];
}

function isScoringForTimeout(card: number): boolean {
  return card === PIG || card === SHEEP || card === TRANSFORMER || getSuit(card) === 2;
}

/* ------------------------------------------------------------------ *
 * 墩结算
 * ------------------------------------------------------------------ */

/** 赢墩者：同花色点数最大；无将牌，不同花色不比较 */
export function determineTrickWinner(plays: CardPlay[]): Position {
  if (plays.length !== 4) throw new Error('一墩必须有 4 张牌');
  const leadSuit = getSuit(plays[0].card);
  let best = plays[0];
  for (let i = 1; i < plays.length; i++) {
    const play = plays[i];
    if (getSuit(play.card) !== leadSuit) continue;
    if (getRank(play.card) > getRank(best.card)) best = play;
  }
  return best.position;
}

/** 本墩计分牌基础分之和（展示用） */
export function trickBasePoints(plays: CardPlay[]): number {
  return plays.reduce((sum, play) => sum + cardBasePoints(play.card), 0);
}

/** 本墩内的红桃张数 */
export function trickHeartCount(plays: CardPlay[]): number {
  return plays.filter((play) => getSuit(play.card) === 2).length;
}

/* ------------------------------------------------------------------ *
 * 满贯
 * ------------------------------------------------------------------ */

/** 单个玩家是否集齐猪、羊、变压器、全部 13 张红桃 */
export function isGrandSlam(collected: number[]): boolean {
  if (!collected.includes(PIG) || !collected.includes(SHEEP) || !collected.includes(TRANSFORMER)) {
    return false;
  }
  return collected.filter((card) => getSuit(card) === 2).length === 13;
}

/* ------------------------------------------------------------------ *
 * 画猪头判定
 * ------------------------------------------------------------------ */

/**
 * 普通画猪头条件（SRS 6.2）。
 * 正分阈值是进攻：某队小分达到 +1000，由对方被画头；
 * 负分阈值是防守：某队小分达到 -1000，本队被画头。
 */
export function evaluatePigHeads(sa: number, sb: number): PigHeadResult | null {
  const aHigh = sa >= 1000;
  const aLow = sa <= -1000;
  const bHigh = sb >= 1000;
  const bLow = sb <= -1000;

  let headsA = 0;
  let headsB = 0;
  if (aHigh) headsB += 2;
  if (bHigh) headsA += 2;
  if (aLow) headsA += 1;
  if (bLow) headsB += 1;

  if (headsA === 0 && headsB === 0) return null;

  let winner: PigHeadResult['winner'] = 'NONE';
  let loser: PigHeadResult['loser'] = 'NONE';
  if (headsA < headsB) {
    winner = 'A';
    loser = 'B';
  } else if (headsB < headsA) {
    winner = 'B';
    loser = 'A';
  } else if (sa < sb) {
    loser = 'A';
    winner = 'B';
  } else if (sb < sa) {
    loser = 'B';
    winner = 'A';
  }

  const result: PigHeadResult['result'] =
    winner === 'A' ? 'A_WIN' : winner === 'B' ? 'B_WIN' : 'DRAW';

  const parts: string[] = [];
  if (aHigh) parts.push('A队小分 ≥ +1000，B队被画2头');
  if (bHigh) parts.push('B队小分 ≥ +1000，A队被画2头');
  if (aLow) parts.push('A队小分 ≤ -1000，A队被画1头');
  if (bLow) parts.push('B队小分 ≤ -1000，B队被画1头');
  let reason = parts.join('；');
  if (headsA === headsB) {
    reason += `；双方新增猪头相同（各${headsA}头），按小分裁决：${
      winner === 'NONE' ? '小分相同，本局判和' : `${teamName(loser as Team)}小分更低，本局负`
    }`;
  }

  return {
    newPigHeads: { A: headsA, B: headsB },
    winner,
    loser,
    result,
    reason,
    endReason: 'PIG_HEAD',
  };
}

/** 6.5 一局兜底终止：小分更低方被画1头 */
export function evaluateDealLimit(sa: number, sb: number): PigHeadResult {
  if (sa < sb) {
    return {
      newPigHeads: { A: 1, B: 0 },
      winner: 'B',
      loser: 'A',
      result: 'B_WIN',
      reason: '达到单局副数上限，A队小分更低，A队被画1头',
      endReason: 'DEAL_LIMIT',
    };
  }
  if (sb < sa) {
    return {
      newPigHeads: { A: 0, B: 1 },
      winner: 'A',
      loser: 'B',
      result: 'A_WIN',
      reason: '达到单局副数上限，B队小分更低，B队被画1头',
      endReason: 'DEAL_LIMIT',
    };
  }
  return {
    newPigHeads: { A: 1, B: 1 },
    winner: 'NONE',
    loser: 'NONE',
    result: 'DRAW',
    reason: '达到单局副数上限，双方小分相同，各画1头，本局判和',
    endReason: 'DEAL_LIMIT',
  };
}

/** 满贯画头：非全亮 1 头，该副四张全亮 2 头 */
export function slamPigHeads(allKeyCardsLit: boolean): number {
  return allKeyCardsLit ? 2 : 1;
}

/* ------------------------------------------------------------------ *
 * 盘终裁决
 * ------------------------------------------------------------------ */

/**
 * 赛制终局裁决。
 * - 5局制：固定5局后比较总猪头；相同则进入突然死亡加赛；
 * - 8局制：固定8局后比较总猪头；相同则按最后一局输者负、必要时回溯。
 */
export function resolveMatch(
  format: MatchFormat,
  totalPigHeads: Record<Team, number>,
  rounds: RoundRecord[],
): MatchOutcome {
  const required = format;
  if (rounds.length < required) {
    return {
      finished: false,
      winner: null,
      reason: `进行第 ${rounds.length + 1} 局（${format}局制）`,
    };
  }

  const a = totalPigHeads.A;
  const b = totalPigHeads.B;
  if (a !== b) {
    return {
      finished: true,
      winner: a < b ? 'A' : 'B',
      reason: `${format}局结束，总猪头 A队 ${a} / B队 ${b}，猪头少者获胜`,
    };
  }

  if (format === 5) {
    return {
      finished: false,
      winner: null,
      reason: '5局后双方总猪头相同，进入突然死亡加赛：每加赛1局比较总猪头，少者立即获胜',
    };
  }

  // 8局制同猪头裁决
  const last = rounds[rounds.length - 1];
  if (last.newPigHeads.A !== last.newPigHeads.B) {
    const loser: Team = last.newPigHeads.A > last.newPigHeads.B ? 'A' : 'B';
    return {
      finished: true,
      winner: otherTeam(loser),
      reason: `8局后总猪头相同；最后一局${teamName(loser)}新增猪头更多，判其负`,
    };
  }

  if (last.result !== 'DRAW' && last.loser !== 'NONE') {
    return {
      finished: true,
      winner: last.winner,
      reason: `8局后总猪头相同；最后一局按小分裁决为${resultText(last.result)}，${teamName(
        last.loser as Team,
      )}负`,
    };
  }

  for (let i = rounds.length - 2; i >= 0; i--) {
    const record = rounds[i];
    if (record.result !== 'DRAW' && record.loser !== 'NONE') {
      return {
        finished: true,
        winner: record.winner,
        reason: `8局后总猪头相同；最后一局判和，回溯第${record.roundNumber}局，${teamName(
          record.loser as Team,
        )}为该局负者，判其负`,
      };
    }
  }

  return {
    finished: true,
    winner: 'NONE',
    reason: '8局后总猪头相同，且整盘无胜负局，双方判和',
  };
}

/* ------------------------------------------------------------------ *
 * 展示辅助
 * ------------------------------------------------------------------ */

/** 计算一手牌中的红桃基础总分 */
export function heartsBaseTotal(cards: number[]): number {
  return cards.reduce((sum, card) => sum + baseHeartValue(card), 0);
}

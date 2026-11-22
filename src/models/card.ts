/**
 * 牌表示（0-51）
 *
 * 花色：0=♣ 1=♦ 2=♥ 3=♠
 * 点数：0=2 ... 12=A（getRank 越大牌越大）
 */

export const SUIT = ['♣', '♦', '♥', '♠'] as const;
export type SuitIndex = 0 | 1 | 2 | 3;

export const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export const SUIT_NAMES_CN = ['梅花', '方块', '红桃', '黑桃'] as const;

export function getSuit(card: number): SuitIndex {
  return Math.floor(card / 13) as SuitIndex;
}

export function getRank(card: number): number {
  return card % 13;
}

export function getCard(suit: SuitIndex, rank: number): number {
  return suit * 13 + rank;
}

export function suitSymbol(suit: SuitIndex): string {
  return SUIT[suit];
}

export function rankName(card: number): string {
  return RANK_NAMES[getRank(card)];
}

/** 牌面文字，如 "♠A" */
export function cardLabel(card: number): string {
  return `${suitSymbol(getSuit(card))}${rankName(card)}`;
}

/** 红桃/方块为红色（UI 用） */
export function isRedSuit(suit: SuitIndex): boolean {
  return suit === 1 || suit === 2;
}

/* ------------------------------------------------------------------ *
 * 拱猪关键牌
 * ------------------------------------------------------------------ */

/** ♠Q 猪 */
export const PIG = getCard(3, 10);
/** ♦J 羊 */
export const SHEEP = getCard(1, 9);
/** ♣10 变压器 */
export const TRANSFORMER = getCard(0, 8);
/** ♥A 红桃A */
export const HEART_A = getCard(2, 12);
/** ♣2（保留常量，供通用牌面逻辑使用；不再作为首副强制首引） */
export const CLUB_2 = getCard(0, 0);
/** ♠3 首副领出标记牌：每局第一副由持 ♠3 者领出，首引花色不限 */
export const SPADE_3 = getCard(3, 1);

/** 四张可亮牌（展示顺序：猪、羊、变压器、红桃A） */
export const KEY_CARDS = [PIG, SHEEP, TRANSFORMER, HEART_A] as const;
export type KeyCard = (typeof KEY_CARDS)[number];

export const KEY_CARD_NAMES: Record<number, string> = {
  [PIG]: '猪',
  [SHEEP]: '羊',
  [TRANSFORMER]: '变压器',
  [HEART_A]: '红桃A',
};

export const KEY_CARD_SHORT: Record<number, string> = {
  [PIG]: '猪',
  [SHEEP]: '羊',
  [TRANSFORMER]: '变',
  [HEART_A]: '♥A',
};

export function isKeyCard(card: number): boolean {
  return (KEY_CARDS as readonly number[]).includes(card);
}

/** 红桃基础分（未考虑亮♥A/全红） */
export function baseHeartValue(card: number): number {
  if (getSuit(card) !== 2) return 0;
  const rank = getRank(card);
  if (rank >= 12) return -50; // A
  if (rank === 11) return -40; // K
  if (rank === 10) return -30; // Q
  if (rank === 9) return -20; // J
  if (rank >= 3) return -10; // 10..5
  return 0; // 4..2
}

/**
 * 是否属于“计分牌”：♠Q、♦J、♣10、全部 13 张红桃。
 * 用于变压器独拿判定与超时垫牌优先级。
 */
export function isScoringCard(card: number): boolean {
  return card === PIG || card === SHEEP || card === TRANSFORMER || getSuit(card) === 2;
}

/** 该牌的基础分值（仅用于界面展示，不含亮牌/变压器修正） */
export function cardBasePoints(card: number): number {
  if (card === PIG) return -100;
  if (card === SHEEP) return 100;
  if (card === TRANSFORMER) return 0;
  return baseHeartValue(card);
}

/** 牌面简短说明，如 "♠Q 猪" */
export function cardDescription(card: number): string {
  const name = KEY_CARD_NAMES[card];
  return name ? `${cardLabel(card)} ${name}` : cardLabel(card);
}

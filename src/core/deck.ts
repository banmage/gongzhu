import { DEAL_ORDER, type Position } from '../models/game';
import { makeRng, hashNumbers } from './rng';
import type { AuditInfo } from '../models/game';

export const SHUFFLE_ALGORITHM_VERSION = 'fisher-yates-v1';
export const RNG_VERSION = 'mulberry32-v1';

/** 生成一副标准的 52 张牌（0-51） */
export function createDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** 洗牌（Fisher-Yates） */
export function shuffle(deck: number[], rng: () => number = Math.random): number[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 依次给 南/东/北/西 各发 13 张 */
export function deal(shuffled: number[]): Record<Position, number[]> {
  const hands = { S: [] as number[], E: [] as number[], N: [] as number[], W: [] as number[] };
  DEAL_ORDER.forEach((pos, seatIndex) => {
    hands[pos] = shuffled.slice(seatIndex * 13, seatIndex * 13 + 13);
  });
  return hands;
}

/** 按 seed 洗牌并发牌，返回手牌与审计信息 */
export function dealWithSeed(seed: number): {
  hands: Record<Position, number[]>;
  deck: number[];
  audit: AuditInfo;
} {
  const rng = makeRng(seed);
  const deck = shuffle(createDeck(), rng);
  const hands = deal(deck);
  const flatHands = DEAL_ORDER.flatMap((pos) => hands[pos]);
  const audit: AuditInfo = {
    seed,
    algorithmVersion: SHUFFLE_ALGORITHM_VERSION,
    rngVersion: RNG_VERSION,
    deckHash: hashNumbers(deck),
    dealHash: hashNumbers(flatHands),
    revealedAt: null,
  };
  return { hands, deck, audit };
}

export function findCardHolder(hands: Record<Position, number[]>, card: number): Position {
  const found = DEAL_ORDER.find((pos) => hands[pos].includes(card));
  if (!found) throw new Error(`牌 ${card} 不在任何玩家手中`);
  return found;
}

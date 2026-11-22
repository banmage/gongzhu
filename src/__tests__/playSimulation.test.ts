import { describe, expect, it } from 'vitest';
import { SPADE_3, getSuit, type SuitIndex } from '../models/card';
import {
  ALL_POSITIONS,
  ORDER,
  type CardPlay,
  type DealState,
  type Position,
  type SuitStatus,
  type Trick,
} from '../models/game';
import { dealWithSeed, findCardHolder } from '../core/deck';
import { choosePlay } from '../core/ai';
import { buildPlayObservation } from '../core/aiObservation';
import { determineTrickWinner, getLegalCards, trickBasePoints } from '../core/rules';
import { scoreDeal } from '../core/scoring';

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

function emptyHands(): Record<Position, number[]> {
  return { S: [], E: [], N: [], W: [] };
}

function simulateDealWithObservation(seed: number): {
  collected: Record<Position, number[]>;
  tricks: Trick[];
} {
  const { hands } = dealWithSeed(seed);
  const leader = findCardHolder(hands, SPADE_3);
  const suitStatus: Record<SuitIndex, SuitStatus> = {
    0: 'NOT_LED',
    1: 'NOT_LED',
    2: 'NOT_LED',
    3: 'NOT_LED',
  };

  const deal: DealState = {
    index: 1,
    seed,
    hands,
    originalHands: {
      S: [...hands.S],
      E: [...hands.E],
      N: [...hands.N],
      W: [...hands.W],
    },
    leader,
    openingDeal: true,
    litCards: [],
    litBy: {},
    autoLitCards: [],
    submissions: { S: [], E: [], N: [], W: [] },
    submitted: { S: true, E: true, N: true, W: true },
    allKeyCardsLit: false,
    firstLedSuitStatus: { ...suitStatus },
    tricks: [],
    currentTrick: emptyTrick(leader),
    nextPlayer: leader,
    collected: emptyHands(),
    pigCollector: null,
    phase: 'playing',
    score: null,
    lastAction: null,
  };

  for (let trickNo = 0; trickNo < 13; trickNo++) {
    deal.currentTrick = emptyTrick(deal.nextPlayer);
    for (let playNo = 0; playNo < 4; playNo++) {
      const pos = deal.nextPlayer;
      const leadSuit =
        deal.currentTrick.plays.length > 0 ? getSuit(deal.currentTrick.plays[0].card) : null;
      const legal = getLegalCards({
        hand: deal.hands[pos],
        leadSuit,
        isFirstLedSuit: deal.currentTrick.isFirstLed,
        litCards: deal.litCards,
        suitStatus: deal.firstLedSuitStatus,
      });
      expect(legal.length).toBeGreaterThan(0);

      const observation = buildPlayObservation({
        deal,
        self: pos,
        round: {
          number: 1,
          isExtra: false,
          smallScores: { A: 0, B: 0 },
          dealsPlayed: 1,
          lastPigCollector: null,
        },
        match: { format: 5, totalPigHeads: { A: 0, B: 0 }, rounds: [] },
        config: { dealLimit: 20 },
        legalCards: legal,
      });
      const card = choosePlay(observation);
      expect(legal).toContain(card);

      deal.hands[pos] = deal.hands[pos].filter((held) => held !== card);
      const play: CardPlay = { position: pos, card };
      deal.currentTrick.plays.push(play);
      deal.lastAction = play;

      if (deal.currentTrick.plays.length === 1) {
        const suit = getSuit(card);
        deal.currentTrick.firstLedSuit = suit;
        if (deal.firstLedSuitStatus[suit] === 'NOT_LED') {
          deal.firstLedSuitStatus[suit] = 'LED';
          deal.currentTrick.isFirstLed = true;
        }
      }
      deal.nextPlayer = ORDER[(ORDER.indexOf(pos) + 1) % 4];
    }

    const winner = determineTrickWinner(deal.currentTrick.plays);
    deal.currentTrick.winner = winner;
    deal.currentTrick.points = trickBasePoints(deal.currentTrick.plays);
    deal.collected[winner].push(...deal.currentTrick.plays.map((play) => play.card));
    deal.tricks.push({ ...deal.currentTrick });
    deal.nextPlayer = winner;
  }

  return { collected: deal.collected, tricks: deal.tricks };
}

describe('完整观察下的概率出牌模拟', () => {
  it('多个种子都能合法打完 13 墩，且 52 张牌全部收完', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { collected, tricks } = simulateDealWithObservation(seed * 104729);
      expect(tricks).toHaveLength(13);
      for (const pos of ALL_POSITIONS) {
        expect(collected[pos].length % 4).toBe(0);
      }
      const all = ALL_POSITIONS.flatMap((pos) => collected[pos]);
      expect(all).toHaveLength(52);
      expect(new Set(all).size).toBe(52);
    }
  });

  it('完整观察模拟可以正常进入计分流水线', () => {
    const { collected } = simulateDealWithObservation(20261122);
    const score = scoreDeal({ collected, litCards: [], litBy: {} });
    expect(Number.isFinite(score.teamScores.A)).toBe(true);
    expect(Number.isFinite(score.teamScores.B)).toBe(true);
  });
});

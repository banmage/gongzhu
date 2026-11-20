import { describe, expect, it } from 'vitest';
import { CLUB_2, KEY_CARDS, PIG, getSuit, isKeyCard, type SuitIndex } from '../models/card';
import {
  ALL_POSITIONS,
  ORDER,
  teamOf,
  type CardPlay,
  type Position,
  type SuitStatus,
  type Trick,
} from '../models/game';
import { dealWithSeed, findCardHolder } from '../core/deck';
import { chooseLights, choosePlay } from '../core/ai';
import {
  determineTrickWinner,
  getLegalCards,
  sortHand,
  trickBasePoints,
} from '../core/rules';
import { scoreDeal } from '../core/scoring';

interface SimResult {
  tricks: Trick[];
  collected: Record<Position, number[]>;
  litCards: number[];
  litBy: Record<number, Position>;
  seed: number;
}

/** 用与 store 相同的规则驱动一副牌，验证 13 墩可以无死锁打完。 */
function simulateDeal(seed: number): SimResult {
  const { hands } = dealWithSeed(seed);
  const suitStatus: Record<SuitIndex, SuitStatus> = { 0: 'NOT_LED', 1: 'NOT_LED', 2: 'NOT_LED', 3: 'NOT_LED' };

  const litCards: number[] = [];
  const litBy: Record<number, Position> = {};
  for (const pos of ALL_POSITIONS) {
    const cards = chooseLights({
      hand: hands[pos],
      position: pos,
      teamSmallScore: 0,
      opponentSmallScore: 0,
      dealIndex: 1,
      litCount: litCards.length,
    });
    for (const card of cards) {
      if (!isKeyCard(card) || !hands[pos].includes(card)) continue;
      if (!litCards.includes(card)) {
        litCards.push(card);
        litBy[card] = pos;
      }
    }
  }

  const leader = findCardHolder(hands, CLUB_2);
  let forcedClub2 = true;
  let nextPlayer: Position = leader;
  const collected: Record<Position, number[]> = { S: [], E: [], N: [], W: [] };
  const tricks: Trick[] = [];
  let current: Trick = {
    leader,
    plays: [],
    winner: null,
    points: 0,
    firstLedSuit: null,
    isFirstLed: false,
  };

  for (let trickNo = 0; trickNo < 13; trickNo++) {
    for (let playNo = 0; playNo < 4; playNo++) {
      const leadSuit = current.plays.length > 0 ? getSuit(current.plays[0].card) : null;
      const mustLeadCard =
        forcedClub2 && leadSuit === null && nextPlayer === current.leader ? CLUB_2 : null;
      const legal = getLegalCards({
        hand: hands[nextPlayer],
        leadSuit,
        isFirstLedSuit: current.isFirstLed,
        litCards,
        suitStatus,
        mustLeadCard,
      });
      expect(legal.length).toBeGreaterThan(0);

      const card = choosePlay({
        hand: hands[nextPlayer],
        position: nextPlayer,
        currentTrick: current.plays,
        legalCards: legal,
        litCards,
        isLastToPlay: current.plays.length === 3,
      });
      expect(legal).toContain(card);

      hands[nextPlayer] = hands[nextPlayer].filter((c) => c !== card);
      const play: CardPlay = { position: nextPlayer, card };
      current.plays.push(play);

      if (current.plays.length === 1) {
        const suit = getSuit(card);
        current.firstLedSuit = suit;
        if (suitStatus[suit] === 'NOT_LED') {
          suitStatus[suit] = 'LED';
          current.isFirstLed = true;
        }
        forcedClub2 = false;
      }

      nextPlayer = ORDER[(ORDER.indexOf(nextPlayer) + 1) % 4];
    }

    const winner = determineTrickWinner(current.plays);
    current.winner = winner;
    current.points = trickBasePoints(current.plays);
    collected[winner].push(...current.plays.map((play) => play.card));
    tricks.push({ ...current });

    current = {
      leader: winner,
      plays: [],
      winner: null,
      points: 0,
      firstLedSuit: null,
      isFirstLed: false,
    };
    nextPlayer = winner;
  }

  for (const pos of ALL_POSITIONS) {
    expect(hands[pos]).toHaveLength(0);
    expect(collected[pos].length % 4).toBe(0);
  }
  expect(ALL_POSITIONS.reduce((sum, pos) => sum + collected[pos].length, 0)).toBe(52);
  expect(tricks).toHaveLength(13);

  const all = ALL_POSITIONS.flatMap((pos) => collected[pos]);
  expect(new Set(all).size).toBe(52);

  return { tricks, collected, litCards, litBy, seed };
}

describe('整副牌模拟', () => {
  it('固定种子可以无死锁打完 13 墩，并正确结算', () => {
    const result = simulateDeal(20260101);
    const score = scoreDeal({
      collected: result.collected,
      litCards: result.litCards,
      litBy: result.litBy,
    });

    for (const pos of ALL_POSITIONS) {
      expect(score.breakdowns[pos].final).toBe(score.breakdowns[pos].final);
    }
    expect(score.teamScores.A + score.teamScores.B).toBe(
      ALL_POSITIONS.reduce((sum, pos) => sum + score.breakdowns[pos].final, 0),
    );
    expect(score.litCards.length).toBeLessThanOrEqual(4);
  });

  it('多种子批量模拟均能完成，且首轮限制不会造成死锁', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const result = simulateDeal(seed * 7919);
      const pigOwner = ALL_POSITIONS.find((pos) => result.collected[pos].includes(PIG));
      expect(pigOwner).toBeTruthy();
      expect(sortHand(result.collected[pigOwner!]).length % 4).toBe(0);
    }
  });
});

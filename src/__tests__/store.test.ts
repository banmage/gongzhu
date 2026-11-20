import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore } from '../store/game';
import { ALL_POSITIONS } from '../models/game';

describe('store 端到端流程', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('发牌 → 亮牌 → 揭晓 → 13墩 → 结算可以完整走通', () => {
    const store = useGameStore();
    store.startMatch(5, 12345);

    expect(store.phase).toBe('dealing');
    expect(store.deal).not.toBeNull();

    vi.advanceTimersByTime(2000);
    expect(store.phase).toBe('lighting');
    expect(store.lightCountdown).toBeGreaterThan(0);

    // 人类选择不亮，AI 随后提交
    store.submitHumanLight([]);
    expect(store.deal?.submitted.S).toBe(true);

    vi.advanceTimersByTime(4000);
    // 全员提交后 380ms 进入揭晓
    expect(['revealing', 'playing']).toContain(store.phase);

    vi.advanceTimersByTime(3000);
    expect(store.phase).toBe('playing');

    store.setAutoPilot(true);
    vi.advanceTimersByTime(200_000);

    expect(store.phase).toBe('scoring');
    expect(store.deal?.tricks).toHaveLength(13);
    expect(store.deal?.score).not.toBeNull();
    expect(store.dealResultVisible).toBe(true);

    for (const pos of ALL_POSITIONS) {
      expect(store.deal?.hands[pos]).toHaveLength(0);
    }

    const totalCollected = ALL_POSITIONS.reduce(
      (sum, pos) => sum + (store.deal?.collected[pos].length ?? 0),
      0,
    );
    expect(totalCollected).toBe(52);
  });

  it('首副必须由持♣2者领出，且首引只能是♣2', () => {
    const store = useGameStore();
    store.startMatch(5, 777);

    vi.advanceTimersByTime(2000);
    store.submitHumanLight([]);
    for (let i = 0; i < 100 && store.phase !== 'playing'; i++) {
      vi.advanceTimersByTime(100);
    }

    expect(store.phase).toBe('playing');
    const deal = store.deal!;
    expect(deal.leader).toBe(
      ALL_POSITIONS.find((pos) => deal.originalHands[pos].includes(0))!,
    );
    expect(deal.forcedClub2).toBe(true);
    expect(store.legalCardsFor(deal.leader)).toEqual([0]);
  });

  it('南家没有可亮牌时自动跳过亮牌提交', () => {
    const store = useGameStore();
    // 种子 1 派生出的首副手牌，南家没有四张可亮牌中的任何一张
    store.startMatch(5, 1);
    vi.advanceTimersByTime(2000);

    expect(store.phase).toBe('lighting');
    expect(store.deal?.submitted.S).toBe(true);
    expect(store.deal?.submissions.S).toEqual([]);
    expect(store.humanSubmittedLight).toBe(true);
  });

  it('轮到南家出牌时给出合法推荐牌', () => {
    const store = useGameStore();
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);
    store.submitHumanLight([]);

    for (let i = 0; i < 200 && store.phase !== 'playing'; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(store.phase).toBe('playing');

    for (let i = 0; i < 200 && !store.isHumanTurn; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(store.isHumanTurn).toBe(true);
    expect(store.recommendedCard).not.toBeNull();
    expect(store.legalCards).toContain(store.recommendedCard);
  });

  it('托管南家后，亮牌阶段会自动提交并继续', () => {
    const store = useGameStore();
    store.startMatch(5, 999);
    vi.advanceTimersByTime(2000);
    expect(store.phase).toBe('lighting');

    store.setAutoPilot(true);
    expect(store.deal?.submitted.S).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(['revealing', 'playing']).toContain(store.phase);
  });

  it('墩面先完整展示，再高亮赢家，随后进入下一墩', () => {
    const store = useGameStore();
    store.startMatch(5, 20261120);
    store.setAutoPilot(true);

    // 先快进到出牌阶段并等出第一墩的四张牌
    let guard = 0;
    while (
      (store.phase !== 'playing' || store.deal?.currentTrick.plays.length !== 4) &&
      guard < 5000
    ) {
      guard++;
      vi.advanceTimersByTime(10);
    }
    expect(store.phase).toBe('playing');
    expect(store.deal?.currentTrick.plays).toHaveLength(4);

    // 四张牌展示阶段尚未揭晓赢家
    expect(store.deal?.currentTrick.winner).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(store.deal?.currentTrick.winner).toBeNull();

    // 赢家高亮
    vi.advanceTimersByTime(500);
    expect(store.deal?.currentTrick.winner).not.toBeNull();
    expect(store.settling).toBe(true);

    // 高亮结束后收牌并进入下一墩
    const completed = store.deal?.tricks.length ?? 0;
    vi.advanceTimersByTime(1000);
    expect(store.settling).toBe(false);
    expect(store.deal?.tricks.length).toBe(completed);
    expect(store.deal?.currentTrick.plays.length).toBeLessThan(4);
  });

  it('南家只剩唯一合法牌时短暂停留后自动打出', () => {
    const store = useGameStore();
    // 种子 12 的首副南家持 ♣2，开局领出时合法牌只剩 ♣2
    store.startMatch(5, 12);
    vi.advanceTimersByTime(2000);
    expect(store.phase).toBe('lighting');
    store.submitHumanLight([]);

    for (let i = 0; i < 100 && store.phase !== 'playing'; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(store.phase).toBe('playing');
    expect(store.deal?.leader).toBe('S');
    expect(store.deal?.forcedClub2).toBe(true);
    expect(store.legalCards).toEqual([0]);
    expect(store.deal?.currentTrick.plays).toHaveLength(0);

    // 短暂停留后无需操作自动出牌，并标记为唯一合法牌自动出牌
    vi.advanceTimersByTime(300);
    expect(store.deal?.lastAction).toMatchObject({ position: 'S', card: 0, single: true });
    expect(store.deal?.currentTrick.plays).toHaveLength(1);
    expect(store.deal?.currentTrick.plays[0].single).toBe(true);
  });

  it('全托管可以连续打完多局并进入盘终结算', () => {
    const store = useGameStore();
    store.startMatch(5, 4242);
    store.setAutoPilot(true);

    let guard = 0;
    while (store.phase !== 'matchEnd' && guard < 800) {
      guard++;
      if (store.phase === 'scoring') {
        store.advanceAfterDeal();
      } else {
        vi.advanceTimersByTime(300_000);
      }
    }

    expect(store.phase).toBe('matchEnd');
    expect(store.match.finished).toBe(true);
    expect(store.match.rounds.length).toBeGreaterThanOrEqual(5);
    expect(store.match.reason.length).toBeGreaterThan(0);

    for (const record of store.match.rounds) {
      expect(record.dealsPlayed).toBeGreaterThan(0);
      expect(record.dealsPlayed).toBeLessThanOrEqual(20);
      expect(record.newPigHeads.A + record.newPigHeads.B).toBeGreaterThan(0);
    }
  });
});

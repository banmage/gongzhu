import { describe, expect, it } from 'vitest';
import type { RoundRecord, Team } from '../models/game';
import { resolveMatch } from '../core/rules';

function record(
  roundNumber: number,
  newPigHeads: Record<Team, number>,
  result: RoundRecord['result'],
  winner: RoundRecord['winner'],
  loser: RoundRecord['loser'],
  isExtra = false,
): RoundRecord {
  return {
    roundNumber,
    isExtra,
    dealsPlayed: 3,
    smallScores: { A: 0, B: 0 },
    newPigHeads,
    winner,
    loser,
    result,
    endReason: 'PIG_HEAD',
    totalPigHeadsAfter: { A: 0, B: 0 },
    note: '',
  };
}

const WIN_A = (n: number, isExtra = false) => record(n, { A: 0, B: 1 }, 'A_WIN', 'A', 'B', isExtra);
const WIN_B = (n: number, isExtra = false) => record(n, { A: 1, B: 0 }, 'B_WIN', 'B', 'A', isExtra);
const DRAW = (n: number, isExtra = false) => record(n, { A: 1, B: 1 }, 'DRAW', 'NONE', 'NONE', isExtra);

describe('5局制盘终裁决', () => {
  it('5局后总猪头少者获胜', () => {
    const rounds = [WIN_A(1), WIN_A(2), WIN_B(3), WIN_A(4), WIN_B(5)];
    const outcome = resolveMatch(5, { A: 2, B: 3 }, rounds);
    expect(outcome.finished).toBe(true);
    expect(outcome.winner).toBe('A');
  });

  it('5局后总猪头相同：进入突然死亡加赛', () => {
    const rounds = [WIN_A(1), WIN_B(2), WIN_A(3), WIN_B(4), DRAW(5)];
    const outcome = resolveMatch(5, { A: 3, B: 3 }, rounds);
    expect(outcome.finished).toBe(false);
    expect(outcome.winner).toBeNull();
    expect(outcome.reason).toContain('加赛');
  });

  it('加赛后总猪头分出胜负即结束', () => {
    const rounds = [WIN_A(1), WIN_B(2), WIN_A(3), WIN_B(4), DRAW(5), WIN_B(6, true)];
    const outcome = resolveMatch(5, { A: 4, B: 3 }, rounds);
    expect(outcome.finished).toBe(true);
    expect(outcome.winner).toBe('B');
  });

  it('加赛后总猪头仍相同则继续加赛', () => {
    const rounds = [WIN_A(1), WIN_B(2), WIN_A(3), WIN_B(4), DRAW(5), DRAW(6, true)];
    const outcome = resolveMatch(5, { A: 4, B: 4 }, rounds);
    expect(outcome.finished).toBe(false);
    expect(outcome.reason).toContain('加赛');
  });
});

describe('8局制同猪头裁决', () => {
  it('8局后总猪头少者获胜', () => {
    const rounds = [WIN_A(1), WIN_A(2), WIN_A(3), WIN_B(4), WIN_A(5), WIN_A(6), WIN_B(7), WIN_A(8)];
    const outcome = resolveMatch(8, { A: 2, B: 6 }, rounds);
    expect(outcome.finished).toBe(true);
    expect(outcome.winner).toBe('A');
  });

  it('总猪头相同：最后一局新增猪头多者负', () => {
    const last = record(8, { A: 2, B: 1 }, 'A_WIN', 'A', 'B');
    const rounds = [WIN_A(1), WIN_B(2), WIN_A(3), WIN_B(4), WIN_A(5), WIN_B(6), WIN_A(7), last];
    const outcome = resolveMatch(8, { A: 10, B: 10 }, rounds);
    expect(outcome.finished).toBe(true);
    expect(outcome.winner).toBe('B');
    expect(outcome.reason).toContain('新增猪头更多');
  });

  it('总猪头相同、最后一局新增相同：按6.4本局胜负裁决', () => {
    const last = record(8, { A: 1, B: 1 }, 'A_WIN', 'A', 'B');
    const rounds = [WIN_A(1), WIN_B(2), WIN_A(3), WIN_B(4), WIN_A(5), WIN_B(6), WIN_A(7), last];
    const outcome = resolveMatch(8, { A: 10, B: 10 }, rounds);
    expect(outcome.finished).toBe(true);
    expect(outcome.winner).toBe('A');
    expect(outcome.reason).toContain('最后一局');
  });

  it('最后一局判和：向前回溯最近一局有胜负的局', () => {
    const rounds = [
      WIN_A(1),
      WIN_B(2),
      WIN_A(3),
      WIN_B(4),
      WIN_A(5),
      WIN_B(6),
      WIN_A(7),
      DRAW(8),
    ];
    const outcome = resolveMatch(8, { A: 10, B: 10 }, rounds);
    expect(outcome.finished).toBe(true);
    expect(outcome.winner).toBe('A');
    expect(outcome.reason).toContain('回溯第7局');
  });

  it('整盘无胜负局：判和', () => {
    const rounds = Array.from({ length: 8 }, (_, i) => DRAW(i + 1));
    const outcome = resolveMatch(8, { A: 8, B: 8 }, rounds);
    expect(outcome.finished).toBe(true);
    expect(outcome.winner).toBe('NONE');
  });
});

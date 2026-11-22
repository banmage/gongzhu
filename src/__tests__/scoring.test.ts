import { describe, expect, it } from 'vitest';
import {
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  getCard,
  type SuitIndex,
} from '../models/card';
import type { Position } from '../models/game';
import { scoreDeal } from '../core/scoring';

const ALL_HEARTS = Array.from({ length: 13 }, (_, rank) => getCard(2 as SuitIndex, rank));

function collected(patch: Partial<Record<Position, number[]>> = {}): Record<Position, number[]> {
  return { S: [], E: [], N: [], W: [], ...patch };
}

function score(
  patch: Partial<Record<Position, number[]>>,
  litCards: number[] = [],
  litBy: Record<number, Position> = {},
) {
  return scoreDeal({ collected: collected(patch), litCards, litBy });
}

describe('计分：猪', () => {
  it('未亮猪收猪 -100', () => {
    const result = score({ S: [PIG] });
    expect(result.breakdowns.S.pigTotal).toBe(-100);
    expect(result.breakdowns.S.final).toBe(-100);
  });

  it('亮猪后非亮猪者收猪 -200', () => {
    const result = score({ N: [PIG] }, [PIG], { [PIG]: 'S' });
    expect(result.breakdowns.N.pigTotal).toBe(-200);
  });

  it('亮猪者自收触发窝猪 -400', () => {
    const result = score({ S: [PIG] }, [PIG], { [PIG]: 'S' });
    expect(result.breakdowns.S.pigBase).toBe(-100);
    expect(result.breakdowns.S.pigLitAdj).toBe(-100);
    expect(result.breakdowns.S.ownPigAdj).toBe(-200);
    expect(result.breakdowns.S.pigTotal).toBe(-400);
  });

  it('自动亮猪自收同样算窝猪', () => {
    const result = score({ S: [PIG] }, [PIG], { [PIG]: 'S' });
    expect(result.breakdowns.S.final).toBe(-400);
  });

  it('单张黑桃亮猪自收：免窝猪，仍按亮猪 -200', () => {
    const result = scoreDeal({
      collected: collected({ S: [PIG] }),
      litCards: [PIG],
      litBy: { [PIG]: 'S' },
      pigLighterSpadeCount: 1,
    });
    expect(result.breakdowns.S.pigBase).toBe(-100);
    expect(result.breakdowns.S.pigLitAdj).toBe(-100);
    expect(result.breakdowns.S.ownPigAdj).toBe(0);
    expect(result.breakdowns.S.ownPigExempt).toBe(true);
    expect(result.breakdowns.S.pigTotal).toBe(-200);
    expect(result.breakdowns.S.final).toBe(-200);
  });

  it('亮猪者有多张黑桃时自收仍算窝猪', () => {
    const result = scoreDeal({
      collected: collected({ S: [PIG] }),
      litCards: [PIG],
      litBy: { [PIG]: 'S' },
      pigLighterSpadeCount: 2,
    });
    expect(result.breakdowns.S.ownPigAdj).toBe(-200);
    expect(result.breakdowns.S.ownPigExempt).toBe(false);
    expect(result.breakdowns.S.pigTotal).toBe(-400);
  });

  it('单张黑桃免窝猪只作用于亮猪者本人，不改变他人收猪的 -200', () => {
    const result = scoreDeal({
      collected: collected({ N: [PIG] }),
      litCards: [PIG],
      litBy: { [PIG]: 'S' },
      pigLighterSpadeCount: 1,
    });
    expect(result.breakdowns.N.pigTotal).toBe(-200);
    expect(result.breakdowns.N.ownPigAdj).toBe(0);
  });
});

describe('计分：羊与红桃', () => {
  it('亮羊 +200，不亮羊 +100', () => {
    expect(score({ S: [SHEEP] }).breakdowns.S.final).toBe(100);
    expect(score({ S: [SHEEP] }, [SHEEP], { [SHEEP]: 'S' }).breakdowns.S.final).toBe(200);
  });

  it('亮♥A使全场所有选手红桃分值 ×2（含♥A自身）', () => {
    const hearts = [HEART_A, getCard(2, 11)]; // A + K = -90
    expect(score({ S: hearts }).breakdowns.S.heartsTotal).toBe(-90);
    expect(score({ S: hearts }, [HEART_A], { [HEART_A]: 'S' }).breakdowns.S.heartsTotal).toBe(-180);
  });

  it('亮♥A后未收♥A的玩家红桃也 ×2，团队分同步翻倍', () => {
    // 南收 ♥A(-50)，北收 ♥K(-40)；亮♥A 后南 -100、北 -80，团队 -180
    const result = score(
      { S: [HEART_A], N: [getCard(2, 11)] },
      [HEART_A],
      { [HEART_A]: 'E' },
    );
    expect(result.breakdowns.S.heartsTotal).toBe(-100);
    expect(result.breakdowns.N.heartsTotal).toBe(-80);
    expect(result.teamScores.A).toBe(-180);
  });

  it('亮猪后被同伴收：仍按 -200', () => {
    const result = score({ N: [PIG] }, [PIG], { [PIG]: 'S' });
    expect(result.breakdowns.N.pigTotal).toBe(-200);
    expect(result.breakdowns.N.ownPigAdj).toBe(0);
  });

  it('亮猪后被对手收：仍按 -200', () => {
    const result = score({ E: [PIG] }, [PIG], { [PIG]: 'S' });
    expect(result.breakdowns.E.pigTotal).toBe(-200);
  });

  it('亮羊后由他人收：收牌者仍按 +200', () => {
    const result = score({ N: [SHEEP] }, [SHEEP], { [SHEEP]: 'S' });
    expect(result.breakdowns.N.sheepTotal).toBe(200);
  });

  it('亮羊但无人收下：不产生羊分', () => {
    const result = score({ S: [HEART_A] }, [SHEEP], { [SHEEP]: 'N' });
    expect(result.breakdowns.S.sheepTotal).toBe(0);
    expect(result.breakdowns.N.sheepTotal).toBe(0);
  });

  it('全红：红桃 -200 → +200；亮♥A 则 -400 → +400', () => {
    const plain = score({ S: ALL_HEARTS });
    expect(plain.breakdowns.S.allRed).toBe(true);
    expect(plain.breakdowns.S.heartsTotal).toBe(200);

    const lit = score({ S: ALL_HEARTS }, [HEART_A], { [HEART_A]: 'S' });
    expect(lit.breakdowns.S.heartsTotal).toBe(400);
  });

  it('窝猪 + 全红 = -200', () => {
    const result = score({ S: [PIG, ...ALL_HEARTS] }, [PIG], { [PIG]: 'S' });
    expect(result.breakdowns.S.pigTotal).toBe(-400);
    expect(result.breakdowns.S.heartsTotal).toBe(200);
    expect(result.breakdowns.S.final).toBe(-200);
  });

  it('窝猪 + 全红 + 亮♥A = 0', () => {
    const result = score(
      { S: [PIG, ...ALL_HEARTS] },
      [PIG, HEART_A],
      { [PIG]: 'S', [HEART_A]: 'S' },
    );
    expect(result.breakdowns.S.final).toBe(0);
  });
});

describe('计分：变压器', () => {
  it('独拿变压器 +50，亮变 +100', () => {
    expect(score({ S: [TRANSFORMER] }).breakdowns.S.final).toBe(50);
    expect(
      score({ S: [TRANSFORMER] }, [TRANSFORMER], { [TRANSFORMER]: 'S' }).breakdowns.S.final,
    ).toBe(100);
  });

  it('仅♣10 + 普通非计分牌：仍为独拿 +50', () => {
    const result = score({ S: [TRANSFORMER, getCard(3, 0)] }); // ♣10 + ♠2
    expect(result.breakdowns.S.transformerSolo).toBe(true);
    expect(result.breakdowns.S.final).toBe(50);
  });

  it('仅♣10 + ♥4 为非独拿，总分 0，×2 仍 0，不 +50', () => {
    const result = score({ S: [TRANSFORMER, getCard(2, 2)] }); // ♥4 = rank 2
    expect(result.breakdowns.S.transformerSolo).toBe(false);
    expect(result.breakdowns.S.subtotal).toBe(0);
    expect(result.breakdowns.S.final).toBe(0);
  });

  it('非独拿：修正后总分 ×2；亮变 ×4', () => {
    const result = score({ S: [SHEEP, TRANSFORMER] });
    expect(result.breakdowns.S.subtotal).toBe(100);
    expect(result.breakdowns.S.final).toBe(200);

    const lit = score({ S: [SHEEP, TRANSFORMER] }, [TRANSFORMER], { [TRANSFORMER]: 'S' });
    expect(lit.breakdowns.S.final).toBe(400);
  });

  it('窝猪 + 亮变 = -1600', () => {
    const result = score({ S: [PIG, TRANSFORMER] }, [PIG, TRANSFORMER], {
      [PIG]: 'S',
      [TRANSFORMER]: 'S',
    });
    expect(result.breakdowns.S.subtotal).toBe(-400);
    expect(result.breakdowns.S.final).toBe(-1600);
  });

  it('窝猪 + 全红 + 亮♥A + 亮变 = 0（×4 仍 0）', () => {
    const result = score(
      { S: [PIG, TRANSFORMER, ...ALL_HEARTS] },
      [PIG, TRANSFORMER, HEART_A],
      { [PIG]: 'S', [TRANSFORMER]: 'S', [HEART_A]: 'S' },
    );
    expect(result.breakdowns.S.subtotal).toBe(0);
    expect(result.breakdowns.S.transformerSolo).toBe(false);
    expect(result.breakdowns.S.final).toBe(0);
  });
});

describe('计分：团队与满贯', () => {
  it('团队本副小分 = 两人个人分相加', () => {
    const result = score({ S: [SHEEP], N: [PIG] });
    expect(result.teamScores.A).toBe(0);
    expect(result.teamScores.B).toBe(0);
    expect(result.breakdowns.S.final).toBe(100);
    expect(result.breakdowns.N.final).toBe(-100);
  });

  it('满贯触发：不生成正式个人分，按全亮/非全亮给对方 1/2 头', () => {
    const slamCards = [PIG, SHEEP, TRANSFORMER, ...ALL_HEARTS];
    const nonAll = scoreDeal({
      collected: collected({ S: slamCards }),
      litCards: [PIG, SHEEP],
      litBy: { [PIG]: 'S', [SHEEP]: 'S' },
    });
    expect(nonAll.slam.triggered).toBe(true);
    expect(nonAll.slam.position).toBe('S');
    expect(nonAll.slam.team).toBe('A');
    expect(nonAll.slam.pigHeads).toBe(1);
    expect(nonAll.official).toBe(false);

    const allLit = scoreDeal({
      collected: collected({ S: slamCards }),
      litCards: [PIG, SHEEP, TRANSFORMER, HEART_A],
      litBy: { [PIG]: 'S', [SHEEP]: 'S', [TRANSFORMER]: 'S', [HEART_A]: 'S' },
    });
    expect(allLit.slam.pigHeads).toBe(2);
    expect(allLit.slam.allKeyCardsLit).toBe(true);
  });

  it('满贯者猪不计负分（模拟展示分）', () => {
    const result = score({ S: [PIG, SHEEP, TRANSFORMER, ...ALL_HEARTS] });
    expect(result.slam.triggered).toBe(true);
    expect(result.breakdowns.S.pigTotal).toBe(0);
    expect(result.breakdowns.S.notes.some((note) => note.includes('满贯'))).toBe(true);
  });
});

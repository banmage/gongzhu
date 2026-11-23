import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore } from '../store/game';
import { ALL_POSITIONS } from '../models/game';
import { HEART_A, PIG, SHEEP, SPADE_3, TRANSFORMER, getCard } from '../models/card';

describe('store 端到端流程', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** 跳过发牌与亮牌阶段，进入出牌阶段 */
  function reachPlaying(store: ReturnType<typeof useGameStore>): void {
    vi.advanceTimersByTime(2000);
    if (store.phase === 'lighting' && !store.humanSubmittedLight) {
      store.submitHumanLight([]);
    }
    for (let i = 0; i < 200 && store.phase !== 'playing'; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(store.phase).toBe('playing');
  }

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
    // 计分牌全部归属或剩余牌均为最大牌时会提前结束，不再强制打满 13 墩
    expect(store.deal?.tricks.length).toBeGreaterThan(0);
    expect(store.deal?.tricks.length).toBeLessThanOrEqual(13);
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

  it('首副由持♠3者领出，首引花色无限制', () => {
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
      ALL_POSITIONS.find((pos) => deal.originalHands[pos].includes(SPADE_3))!,
    );
    expect(deal.openingDeal).toBe(true);
    const legal = store.legalCardsFor(deal.leader);
    // 首引不强制某张牌；仅受“该花色尚未领出时的亮牌限制”约束。
    expect(legal.length).toBeGreaterThan(1);
    expect(legal.every((card) => deal.hands[deal.leader].includes(card))).toBe(true);
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

  it('读秒配置支持 5~60 秒，并可用 0 表示无读秒', () => {
    const store = useGameStore();
    store.config.lightSeconds = 100;
    store.config.playSeconds = 2;
    store.startMatch(5, 1);
    expect(store.config.lightSeconds).toBe(60);
    expect(store.config.playSeconds).toBe(5);

    store.returnToIdle();
    store.config.lightSeconds = 0;
    store.config.playSeconds = 0;
    store.startMatch(5, 1);
    expect(store.config.lightSeconds).toBe(0);
    expect(store.config.playSeconds).toBe(0);
  });

  it('亮牌无读秒时不会因倒计时自动结束，需南家手动提交', () => {
    const store = useGameStore();
    // 种子 4：南家首副持 ♠Q（可亮牌），不会被自动跳过
    store.config.lightSeconds = 0;
    store.startMatch(5, 4);
    vi.advanceTimersByTime(2000);

    expect(store.phase).toBe('lighting');
    expect(store.lightCountdown).toBe(0);
    expect(store.countdownText).toBe('不限时');
    expect(store.humanSubmittedLight).toBe(false);

    vi.advanceTimersByTime(120_000);
    expect(store.phase).toBe('lighting');
    expect(store.humanSubmittedLight).toBe(false);

    store.submitHumanLight([]);
    vi.advanceTimersByTime(5000);
    expect(['revealing', 'playing']).toContain(store.phase);
  });

  it('亮牌最后 10 秒才显示读秒并语音播报；不足 10 秒从实际秒数开始', () => {
    const spoken: string[] = [];
    const speak = vi.fn((utterance: { text: string }) => spoken.push(utterance.text));
    class FakeUtterance {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

    const store = useGameStore();
    store.config.lightSeconds = 30;
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);

    expect(store.phase).toBe('lighting');
    expect(store.lightCountdown).toBeGreaterThan(10);
    expect(store.lightCountdownVisible).toBe(false);
    expect(store.countdownText).toBe('—');
    expect(speak).not.toHaveBeenCalled();

    // 剩余 10 秒进入读秒：显示倒计时并播报
    vi.advanceTimersByTime(20_000);
    expect(store.lightCountdown).toBe(10);
    expect(store.lightCountdownVisible).toBe(true);
    expect(store.countdownText).toBe('10s');
    expect(spoken.at(-1)).toBe('10');

    // 时限不足 10 秒：从实际秒数 6 开始显示和播报
    store.returnToIdle();
    store.config.lightSeconds = 6;
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);
    expect(store.lightCountdown).toBe(6);
    expect(store.lightCountdownVisible).toBe(true);
    expect(store.countdownText).toBe('6s');
    expect(spoken.at(-1)).toBe('6');
  });

  it('出牌最后 10 秒才显示读秒并语音播报；不足 10 秒从实际秒数开始', () => {
    const spoken: string[] = [];
    const speak = vi.fn((utterance: { text: string }) => spoken.push(utterance.text));
    class FakeUtterance {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

    const store = useGameStore();
    store.config.playSeconds = 30;
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);
    store.submitHumanLight([]);

    for (let i = 0; i < 200 && !store.isHumanTurn; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(store.isHumanTurn).toBe(true);
    expect(store.countdown).toBe(30);
    expect(store.playCountdownVisible).toBe(false);
    expect(store.countdownText).toBe('—');
    expect(spoken).toHaveLength(0);

    // 剩余 10 秒进入读秒：显示倒计时并播报
    vi.advanceTimersByTime(20_000);
    expect(store.countdown).toBe(10);
    expect(store.playCountdownVisible).toBe(true);
    expect(store.countdownText).toBe('10s');
    expect(spoken.at(-1)).toBe('10');

    // 时限不足 10 秒：从实际秒数 6 开始显示和播报
    store.returnToIdle();
    store.config.playSeconds = 6;
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);
    store.submitHumanLight([]);
    for (let i = 0; i < 200 && !store.isHumanTurn; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(store.isHumanTurn).toBe(true);
    expect(store.countdown).toBe(6);
    expect(store.playCountdownVisible).toBe(true);
    expect(store.countdownText).toBe('6s');
    expect(spoken.at(-1)).toBe('6');
  });

  /** 手动构造“已亮 3 张”的提交结果，返回揭晓后的 deal */
  function finishWithThreeLights(autoLightLastOne: boolean) {
    const store = useGameStore();
    store.config.autoLightLastOne = autoLightLastOne;
    // 种子 4：南家首副持 ♠Q，可手动提交亮猪
    store.startMatch(5, 4);
    vi.advanceTimersByTime(2000);
    const deal = store.deal!;

    deal.submissions.E = [SHEEP];
    deal.submitted.E = true;
    deal.submissions.N = [TRANSFORMER];
    deal.submitted.N = true;
    deal.submissions.W = [];
    deal.submitted.W = true;
    store.submitHumanLight([PIG]);
    vi.advanceTimersByTime(500);
    return deal;
  }

  it('第四张自动亮开启：已亮 3 张后自动亮剩余关键牌', () => {
    const deal = finishWithThreeLights(true);
    expect(deal.litCards).toEqual(expect.arrayContaining([PIG, SHEEP, TRANSFORMER, HEART_A]));
    expect(deal.autoLitCards).toEqual([HEART_A]);
    expect(deal.allKeyCardsLit).toBe(true);
  });

  it('第四张自动亮关闭：只保留玩家实际提交的 3 张', () => {
    const deal = finishWithThreeLights(false);
    expect(deal.litCards).toEqual(expect.arrayContaining([PIG, SHEEP, TRANSFORMER]));
    expect(deal.litCards).not.toContain(HEART_A);
    expect(deal.autoLitCards).toEqual([]);
    expect(deal.allKeyCardsLit).toBe(false);
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

  it('亮牌规则可热更新，并立即刷新当前推荐亮牌', () => {
    const store = useGameStore();
    // 种子 7：南家首副持 ♠Q，默认 V1.0 推荐亮猪
    store.startMatch(5, 7);
    vi.advanceTimersByTime(2000);
    expect(store.phase).toBe('lighting');
    expect(store.humanLightSelection).toContain(PIG);

    const custom = JSON.parse(store.exportLightRuleJson());
    custom.meta.version = 'hot-test';
    custom.sampling.mode = 'threshold';
    custom.module_d.n_max.normal = 0;
    const result = store.applyLightRule(JSON.stringify(custom));
    expect(result.ok).toBe(true);
    expect(store.lightRuleRuntime.config.meta.version).toBe('hot-test');
    expect(store.humanLightSelection).toEqual([]);

    store.restoreDefaultLightRule();
    expect(store.lightRuleRuntime.config.meta.version).toBe('1.0');
    expect(store.humanLightSelection).toContain(PIG);

    store.returnToIdle();
  });

  it('亮牌读秒结束自动提交当前选择', () => {
    const store = useGameStore();
    store.config.lightSeconds = 5;
    // 种子 7：南家首副持 ♠Q，默认 V1.0 推荐亮猪
    store.startMatch(5, 7);
    vi.advanceTimersByTime(2000);
    expect(store.phase).toBe('lighting');
    expect(store.deal?.submitted.S).toBe(false);
    expect(store.humanLightSelection).toContain(PIG);

    // 不点击提交，直接走完 5 秒读秒
    vi.advanceTimersByTime(5000);
    expect(store.deal?.submitted.S).toBe(true);
    expect(store.deal?.submissions.S).toContain(PIG);
    expect(store.deal?.litBy[PIG]).toBe('S');
    expect(['revealing', 'playing']).toContain(store.phase);
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
    store.startMatch(5, 12);
    vi.advanceTimersByTime(2000);
    expect(store.phase).toBe('lighting');
    store.submitHumanLight([]);

    for (let i = 0; i < 100 && store.phase !== 'revealing'; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(store.phase).toBe('revealing');

    // 构造南家领出且手中只有一张牌的确定性局面
    const onlyCard = getCard(2, 0); // ♥2
    store.deal!.leader = 'S';
    store.deal!.hands.S = [onlyCard];

    vi.advanceTimersByTime(2400);
    expect(store.phase).toBe('playing');
    expect(store.deal?.leader).toBe('S');
    expect(store.legalCards).toEqual([onlyCard]);
    expect(store.deal?.currentTrick.plays).toHaveLength(0);

    // 短暂停留后无需操作自动出牌，并标记为唯一合法牌自动出牌
    vi.advanceTimersByTime(300);
    expect(store.deal?.lastAction).toMatchObject({ position: 'S', card: onlyCard, single: true });
    expect(store.deal?.currentTrick.plays).toHaveLength(1);
    expect(store.deal?.currentTrick.plays[0].single).toBe(true);
  });

  it('所有红桃与猪羊变压器都有归属时自动结束本副', () => {
    const store = useGameStore();
    store.config.aiDelayMs = 0;
    store.config.playSeconds = 0;
    store.startMatch(5, 20261123);
    reachPlaying(store);

    const current = store.deal!;
    const allHearts = Array.from({ length: 13 }, (_, rank) => getCard(2, rank));
    current.hands.S = [getCard(3, 0)]; // ♠2
    current.hands.E = [getCard(3, 1)]; // ♠3
    current.hands.N = [getCard(3, 2)]; // ♠4
    current.hands.W = [getCard(3, 3)]; // ♠5
    current.collected.S = [PIG, ...allHearts];
    current.collected.E = [SHEEP, TRANSFORMER];
    current.collected.N = [];
    current.collected.W = [];
    current.leader = 'S';
    current.nextPlayer = 'S';
    current.currentTrick = {
      leader: 'S',
      plays: [],
      winner: null,
      points: 0,
      firstLedSuit: null,
      isFirstLed: false,
    };

    store.setAutoPilot(true);
    vi.advanceTimersByTime(10_000);

    expect(store.phase).toBe('scoring');
    expect(store.earlyConclusion?.reason).toBe('ALL_SCORING_COLLECTED');
    expect(store.deal?.tricks).toHaveLength(1);
    // 13 张红桃 + 猪/羊/变压器 + 本墩 4 张黑桃
    expect(
      ALL_POSITIONS.reduce((sum, pos) => sum + (store.deal?.collected[pos].length ?? 0), 0),
    ).toBe(20);
  });

  it('控制出牌权者剩余牌全为最大牌时，亮开手牌并收下全部剩余牌', () => {
    const store = useGameStore();
    store.config.aiDelayMs = 0;
    store.config.playSeconds = 0;
    store.startMatch(5, 20261124);
    reachPlaying(store);

    const current = store.deal!;
    current.hands.S = [getCard(3, 12), getCard(3, 11)]; // ♠A ♠K
    current.hands.E = [getCard(3, 10)]; // ♠Q
    current.hands.N = [getCard(3, 9)]; // ♠J
    current.hands.W = [getCard(3, 8)]; // ♠10
    current.collected.S = [];
    current.collected.E = [];
    current.collected.N = [];
    current.collected.W = [];
    current.leader = 'S';
    current.nextPlayer = 'S';
    current.currentTrick = {
      leader: 'S',
      plays: [],
      winner: null,
      points: 0,
      firstLedSuit: null,
      isFirstLed: false,
    };

    store.setAutoPilot(true);
    vi.advanceTimersByTime(3300);

    // 已亮开所有人的剩余手牌，并提示结束牌局
    expect(store.phase).toBe('playing');
    expect(store.remainingRevealed).toBe(true);
    expect(store.earlyConclusion).toEqual({ reason: 'TOP_CARDS', reveal: true });
    expect(store.message).toContain('最大牌');
    expect(store.earlyConclusionText).toContain('最大牌');
    expect(store.remainingAwardTo).toBe('S');

    vi.advanceTimersByTime(2500);

    expect(store.phase).toBe('scoring');
    expect(store.deal?.tricks).toHaveLength(1);
    // 本墩 4 张 + 领出者剩余的 1 张最大牌
    expect(store.deal?.collected.S).toHaveLength(5);
    expect(ALL_POSITIONS.reduce(
      (sum, pos) => sum + (store.deal?.collected[pos].length ?? 0),
      0,
    )).toBe(5);
  });

  it('单独变压器持有者收下剩余红桃后，变压器按非独拿计 0 分', () => {
    const store = useGameStore();
    store.config.aiDelayMs = 0;
    store.config.playSeconds = 0;
    store.startMatch(5, 20261125);
    reachPlaying(store);

    const current = store.deal!;
    current.hands.S = [
      getCard(3, 12), // ♠A
      getCard(2, 2), // ♥4
      getCard(2, 1), // ♥3
      getCard(2, 0), // ♥2
    ];
    current.hands.E = [getCard(3, 9)]; // ♠J
    current.hands.N = [getCard(3, 8)]; // ♠10
    current.hands.W = [getCard(3, 7)]; // ♠9
    current.collected.S = [TRANSFORMER];
    current.collected.E = [];
    current.collected.N = [];
    current.collected.W = [];
    current.leader = 'S';
    current.nextPlayer = 'S';
    current.currentTrick = {
      leader: 'S',
      plays: [],
      winner: null,
      points: 0,
      firstLedSuit: null,
      isFirstLed: false,
    };

    store.setAutoPilot(true);
    vi.advanceTimersByTime(3300);
    expect(store.earlyConclusion?.reason).toBe('TOP_CARDS');

    vi.advanceTimersByTime(2500);
    expect(store.phase).toBe('scoring');
    // 领出者收下剩余 ♥4/♥3/♥2，变压器不再是独拿
    expect(store.deal?.collected.S).toEqual(
      expect.arrayContaining([getCard(2, 2), getCard(2, 1), getCard(2, 0)]),
    );
    const breakdown = store.deal!.score!.breakdowns.S;
    expect(breakdown.transformerSolo).toBe(false);
    expect(breakdown.final).toBe(0);
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

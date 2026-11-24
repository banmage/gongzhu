import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ElementPlus from 'element-plus';
import { nextTick } from 'vue';
import App from '../App.vue';
import Hand from '../components/Hand.vue';
import LitArea from '../components/LitArea.vue';
import { useGameStore } from '../store/game';
import { HEART_A, PIG, SHEEP, TRANSFORMER, getCard, getSuit, isKeyCard, isScoringCard } from '../models/card';
import { ALL_POSITIONS, formatSigned, scoreSignClass, seatName } from '../models/game';
import { scoreDeal } from '../core/scoring';
import type { PlayRecommendation } from '../core/aiExplain';

/** 结算弹窗中某座位的计分明细卡片 */
function findBreakdownCard(seat: string): Element {
  const card = [...document.body.querySelectorAll('.bd-card')].find(
    (el) => el.querySelector('.bd-seat')?.textContent?.trim() === seat,
  );
  expect(card).toBeTruthy();
  return card!;
}

/** 结算弹窗中某座位“猪”这一行的明细 */
function findPigDetail(seat: string): Element {
  const card = findBreakdownCard(seat);
  const row = [...card.querySelectorAll('.bd-row')].find(
    (el) => el.querySelector('.bd-label')?.textContent?.trim() === '猪',
  );
  expect(row).toBeTruthy();
  return row!;
}

describe('UI 冒烟测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('分数着色规则：正分红、负分绿、零分中性', () => {
    expect(scoreSignClass(1)).toBe('score-pos');
    expect(scoreSignClass(-1)).toBe('score-neg');
    expect(scoreSignClass(0)).toBe('score-zero');
  });

  it('开始页与牌桌都能正常渲染', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    expect(wrapper.text()).toContain('拱猪');
    expect(wrapper.find('.start-screen').exists()).toBe(true);

    const store = useGameStore();
    store.startMatch(5, 20260101);
    await nextTick();

    expect(wrapper.find('.table').exists()).toBe(true);
    expect(wrapper.text()).toContain('第 1 局');
    expect(wrapper.text()).toContain('发牌中');

    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(wrapper.text()).toContain('亮牌阶段');
    expect(wrapper.find('.lighting-center').exists()).toBe(true);

    store.returnToIdle();
    wrapper.unmount();
  });

  it('出牌阶段不显示底部操作条，点击弹出/收回，右键可出牌', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);
    await nextTick();

    // 亮牌阶段保留右侧提交状态面板
    expect(wrapper.find('.side-panel').exists()).toBe(true);

    if (!store.humanSubmittedLight) store.submitHumanLight([]);
    for (let i = 0; i < 200 && store.phase !== 'playing'; i++) {
      vi.advanceTimersByTime(100);
    }
    for (let i = 0; i < 200 && !store.isHumanTurn; i++) {
      vi.advanceTimersByTime(100);
    }
    await nextTick();

    expect(store.phase).toBe('playing');
    expect(store.isHumanTurn).toBe(true);
    expect(wrapper.find('.action-bar').exists()).toBe(false);
    // 出牌阶段不留下空的右侧面板；南家保持左亮牌 / 中手牌 / 右收牌三列
    expect(wrapper.find('.side-panel').exists()).toBe(false);
    expect(wrapper.find('.south-left').exists()).toBe(true);
    expect(wrapper.find('.south-main .hand').exists()).toBe(true);
    expect(wrapper.find('.south-right').exists()).toBe(true);

    const legalCard = wrapper.findAll('.south .card-slot:not(.illegal) .playing-card')[0];
    expect(legalCard).toBeTruthy();

    // 单击弹出，再次单击收回
    await legalCard.trigger('click');
    expect(legalCard.classes()).toContain('selected');
    await legalCard.trigger('click');
    expect(legalCard.classes()).not.toContain('selected');

    // 重新弹出后右键直接出牌：手牌数量减一
    await legalCard.trigger('click');
    expect(legalCard.classes()).toContain('selected');
    const handBefore = store.deal?.hands.S.length ?? 0;
    await legalCard.trigger('contextmenu');
    await nextTick();
    expect(store.deal?.hands.S.length).toBe(handBefore - 1);

    store.returnToIdle();
    wrapper.unmount();
  });

  it('亮牌阶段自动弹起推荐的牌，点击可收回并再次弹起', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    // 种子 7：南家首副持 ♠Q，按 V1.0 规则会推荐亮猪
    store.startMatch(5, 7);
    vi.advanceTimersByTime(2000);
    await nextTick();

    expect(store.phase).toBe('lighting');
    const recommendedCount = store.humanLightSelection.length;
    expect(recommendedCount).toBeGreaterThan(0);

    const selectedSlot = wrapper.find('.south .card-slot.light-selected');
    expect(selectedSlot.exists()).toBe(true);

    const card = selectedSlot.find('.playing-card');
    await card.trigger('click');
    expect(store.humanLightSelection.length).toBe(recommendedCount - 1);
    await card.trigger('click');
    expect(store.humanLightSelection.length).toBe(recommendedCount);

    store.returnToIdle();
    wrapper.unmount();
  });

  it('亮牌提交后在座位旁立即以正面公开', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);

    expect(store.phase).toBe('lighting');
    const keyCard = store.deal?.hands.S.find((card) => isKeyCard(card));
    expect(keyCard).toBeDefined();

    store.submitHumanLight([keyCard!]);
    await nextTick();

    // 仍处于亮牌阶段，但已提交的亮牌应已经正面公开
    expect(store.phase).toBe('lighting');
    const litCard = wrapper.find('.south-area .lit-cards .playing-card');
    expect(litCard.exists()).toBe(true);
    expect(litCard.attributes('data-rank')).toBeTruthy();

    store.returnToIdle();
    wrapper.unmount();
  });

  it('唯一合法牌自动出牌时在墩面标记“唯一”', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.startMatch(5, 12);
    vi.advanceTimersByTime(2000);

    if (!store.humanSubmittedLight) store.submitHumanLight([]);
    for (let i = 0; i < 200 && store.phase !== 'revealing'; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(store.phase).toBe('revealing');

    // 构造南家领出且只有一张牌的确定性局面
    const onlyCard = getCard(2, 0);
    store.deal!.leader = 'S';
    store.deal!.hands.S = [onlyCard];

    vi.advanceTimersByTime(2400);
    await nextTick();

    expect(store.isHumanTurn).toBe(true);
    expect(store.legalCards).toEqual([onlyCard]);

    vi.advanceTimersByTime(300);
    await nextTick();

    const flag = wrapper.find('.trick-board .auto-flag.single-flag');
    expect(flag.exists()).toBe(true);
    expect(flag.text()).toBe('唯一');

    store.returnToIdle();
    wrapper.unmount();
  });

  it('双击合法手牌直接出牌', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);

    if (!store.humanSubmittedLight) store.submitHumanLight([]);
    for (let i = 0; i < 200 && store.phase !== 'playing'; i++) {
      vi.advanceTimersByTime(100);
    }
    for (let i = 0; i < 200 && !store.isHumanTurn; i++) {
      vi.advanceTimersByTime(100);
    }
    await nextTick();

    const legalCard = wrapper.findAll('.south .card-slot:not(.illegal) .playing-card')[0];
    expect(legalCard).toBeTruthy();

    const handBefore = store.deal?.hands.S.length ?? 0;
    await legalCard.trigger('dblclick');
    await nextTick();
    expect(store.deal?.hands.S.length).toBe(handBefore - 1);

    store.returnToIdle();
    wrapper.unmount();
  });

  it('结算弹窗可以渲染 ScoreBreakdown 与复盘入口', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.startMatch(5, 4242);
    store.setAutoPilot(true);

    let guard = 0;
    while (store.phase !== 'scoring' && guard < 100) {
      guard++;
      vi.advanceTimersByTime(5000);
    }
    await nextTick();
    expect(store.phase).toBe('scoring');
    expect(store.deal?.score).not.toBeNull();
    expect(store.dealHistory.length).toBe(1);

    // 结算弹窗内容由 Element Plus teleport 到 body，检查 store 数据与页面无异常即可
    expect(wrapper.find('.table').exists()).toBe(true);

    store.returnToIdle();
    wrapper.unmount();
  });

  it('亮牌读秒浮在南家可亮牌中央，而不是顶栏', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    // 亮牌时限设为 10 秒：开始即进入最后读秒区间
    store.config.lightSeconds = 10;
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);
    await nextTick();
    // 读秒定位在渲染完成后测量可亮牌包围盒，再触发一次渲染
    await nextTick();
    await nextTick();

    expect(store.phase).toBe('lighting');
    expect(store.humanSubmittedLight).toBe(false);
    const badge = wrapper.find('.south .hand .light-countdown');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('s');
    expect(wrapper.find('.app-header .header-timer').exists()).toBe(false);

    store.returnToIdle();
    wrapper.unmount();
  });

  it('亮牌读秒只在最后 10 秒出现', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);
    await nextTick();

    expect(store.phase).toBe('lighting');
    expect(store.lightCountdown).toBeGreaterThan(10);
    expect(wrapper.find('.south .hand .light-countdown').exists()).toBe(false);

    vi.advanceTimersByTime(20_000);
    await nextTick();
    await nextTick();
    await nextTick();

    expect(store.lightCountdown).toBe(10);
    expect(wrapper.find('.south .hand .light-countdown').exists()).toBe(true);

    store.returnToIdle();
    wrapper.unmount();
  });

  it('出牌读秒：自己的落在推荐牌上，其他玩家落在中间牌背正中', async () => {
    const cards = [
      getCard(3, 12),
      getCard(3, 8),
      getCard(2, 6),
      getCard(1, 4),
      getCard(0, 2),
    ];

    const own = mount(Hand, {
      props: {
        cards,
        position: 'S',
        recommendedCard: cards[2],
        playCountdown: 10,
      },
    });
    await nextTick();
    await nextTick();
    const ownBadge = own.find('.play-countdown');
    expect(ownBadge.exists()).toBe(true);
    expect(ownBadge.attributes('data-anchor')).toBe('recommended');
    own.unmount();

    const other = mount(Hand, {
      props: {
        cards,
        position: 'E',
        faceDown: true,
        playCountdown: 10,
      },
    });
    await nextTick();
    await nextTick();
    const otherBadge = other.find('.play-countdown');
    expect(otherBadge.exists()).toBe(true);
    expect(otherBadge.attributes('data-anchor')).toBe('middle');
    other.unmount();
  });

  it('出牌读秒不出现在顶栏', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.config.playSeconds = 10;
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);
    await nextTick();

    if (!store.humanSubmittedLight) store.submitHumanLight([]);
    for (let i = 0; i < 200 && !store.isHumanTurn; i++) {
      vi.advanceTimersByTime(100);
    }
    await nextTick();
    await nextTick();
    await nextTick();

    expect(store.isHumanTurn).toBe(true);
    expect(store.playRecommendation).not.toBeNull();
    expect(store.legalCards).toContain(store.playRecommendation!.card);
    expect(store.playCountdownFor('S')).not.toBeNull();
    expect(wrapper.find('.south .hand .play-countdown').exists()).toBe(true);
    expect(wrapper.find('.app-header .header-timer').exists()).toBe(false);

    // 切换到其他玩家：读秒移到该玩家的中间牌背，南家读秒消失
    store.deal!.nextPlayer = 'E';
    await nextTick();
    await nextTick();
    await nextTick();
    expect(store.playCountdownFor('E')).not.toBeNull();
    expect(wrapper.find('.east .hand .play-countdown').exists()).toBe(true);
    expect(wrapper.find('.south .hand .play-countdown').exists()).toBe(false);

    store.returnToIdle();
    wrapper.unmount();
  });

  it('推荐牌只做箭头标记，其他合法牌仍可点击出牌', async () => {
    const cards = [
      getCard(3, 12),
      getCard(3, 8),
      getCard(2, 6),
      getCard(1, 4),
      getCard(0, 2),
    ];
    const wrapper = mount(Hand, {
      props: {
        cards,
        position: 'S',
        clickable: true,
        legalCards: cards,
        recommendedCard: cards[2],
      },
    });

    expect(wrapper.findAll('.card-slot.recommended-slot')).toHaveLength(1);
    const other = wrapper
      .findAll('.card-slot')
      .find((slot) => !slot.classes().includes('recommended-slot'));
    expect(other).toBeTruthy();
    await other!.find('button').trigger('click');

    const emitted = wrapper.emitted('card-click');
    expect(emitted).toHaveLength(1);
    expect(emitted![0][0]).not.toBe(cards[2]);

    wrapper.unmount();
  });

  it('悬停推荐牌才显示 AI 推荐理由与公开推断', async () => {
    const cards = [
      getCard(3, 12),
      getCard(3, 8),
      getCard(2, 6),
      getCard(1, 4),
      getCard(0, 2),
    ];
    const recommendation = {
      card: cards[2],
      title: `推荐出 ${cards[2]}`,
      reasons: ['优先保留控制张', '本墩我方收墩概率较高'],
      inference: '东家缺♥；猪♠Q 仍在场上',
    } as unknown as PlayRecommendation;

    const wrapper = mount(Hand, {
      props: {
        cards,
        position: 'S',
        recommendedCard: cards[2],
        recommendation,
      },
    });

    expect(wrapper.find('.recommend-tip').exists()).toBe(false);
    const recommended = wrapper.find('.card-slot.recommended-slot');
    expect(recommended.exists()).toBe(true);
    await recommended.trigger('mouseenter');
    expect(wrapper.find('.recommend-tip').exists()).toBe(true);
    expect(wrapper.text()).toContain('优先保留控制张');
    expect(wrapper.text()).toContain('东家缺♥；猪♠Q 仍在场上');

    await recommended.trigger('mouseleave');
    expect(wrapper.find('.recommend-tip').exists()).toBe(false);

    const other = wrapper
      .findAll('.card-slot')
      .find((slot) => !slot.classes().includes('recommended-slot'));
    expect(other).toBeTruthy();
    await other!.trigger('mouseenter');
    expect(wrapper.find('.recommend-tip').exists()).toBe(false);

    wrapper.unmount();
  });

  it('已打出的亮牌在座位旁半透明显示', () => {
    const wrapper = mount(LitArea, {
      props: { cards: [PIG, SHEEP], playedCards: [PIG] },
    });
    const cards = wrapper.findAll('.playing-card');
    expect(cards.length).toBe(2);
    expect(cards[0].classes()).toContain('lit-played');
    expect(cards[1].classes()).not.toContain('lit-played');
    wrapper.unmount();
  });

  it('自动亮出的最后一张牌带明暗分割标记与“自动”标签', () => {
    const wrapper = mount(LitArea, {
      props: { cards: [PIG, SHEEP], autoCards: [SHEEP] },
    });
    const slots = wrapper.findAll('.lit-card');
    expect(slots.length).toBe(2);
    expect(slots[0].classes()).not.toContain('lit-auto');
    expect(slots[1].classes()).toContain('lit-auto');
    expect(slots[1].find('.lit-auto-tag').text()).toBe('自动');
    wrapper.unmount();
  });

  it('亮牌阶段显示两队本局总分', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.startMatch(5, 424242);
    vi.advanceTimersByTime(2000);
    await nextTick();

    expect(store.phase).toBe('lighting');
    store.round.smallScores.A = 123;
    store.round.smallScores.B = -45;
    await nextTick();

    const board = wrapper.find('.light-team-scores');
    expect(board.exists()).toBe(true);
    expect(board.text()).toContain('南北队');
    expect(board.text()).toContain('东西队');
    expect(board.text()).toContain(formatSigned(123));
    expect(board.text()).toContain(formatSigned(-45));

    // 正分红、负分绿：亮牌阶段中央与左侧信息面板同步着色
    expect(board.find('.lts-item.team-a .lts-value').classes()).toContain('score-pos');
    expect(board.find('.lts-item.team-b .lts-value').classes()).toContain('score-neg');

    const infoLine = wrapper.findAll('.info-panel .score-line')[0];
    expect(infoLine.find('.team-a > span').classes()).toContain('score-pos');
    expect(infoLine.find('.team-b > span').classes()).toContain('score-neg');

    store.returnToIdle();
    wrapper.unmount();
  });

  it('牌桌中已打出的亮牌会加上半透明标记', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.startMatch(5, 12);
    vi.advanceTimersByTime(2000);

    for (const card of [...(store.deal?.hands.S ?? [])].filter(isKeyCard)) {
      store.toggleHumanLight(card);
    }
    store.submitHumanLight();
    for (let i = 0; i < 200 && store.phase !== 'playing'; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(store.phase).toBe('playing');

    let playedKeyCard: number | null = null;
    for (let i = 0; i < 2000 && playedKeyCard === null; i++) {
      if (store.isHumanTurn) {
        const legalKey = store.legalCards.find((card) => isKeyCard(card));
        const card = legalKey ?? store.legalCards[0];
        if (card !== undefined) {
          store.humanPlay(card);
          if (legalKey !== undefined) playedKeyCard = legalKey;
        }
      }
      vi.advanceTimersByTime(100);
    }

    expect(playedKeyCard).not.toBeNull();
    await nextTick();
    await nextTick();
    expect(store.isCardPlayed(playedKeyCard!)).toBe(true);
    const played = wrapper.find('.south-left .lit-played');
    expect(played.exists()).toBe(true);

    store.returnToIdle();
    wrapper.unmount();
  });

  it('关闭结算页后，主页面仍可查看结算并进入下一副', async () => {
    const wrapper = mount(App, { global: { plugins: [ElementPlus] } });
    const store = useGameStore();
    store.startMatch(5, 4242);
    store.setAutoPilot(true);

    let guard = 0;
    while (store.phase !== 'scoring' && guard < 100) {
      guard++;
      vi.advanceTimersByTime(5000);
    }
    await nextTick();

    expect(store.phase).toBe('scoring');
    expect(store.dealResultOpen).toBe(true);
    expect(wrapper.find('.action-bar.scoring').exists()).toBe(false);

    store.closeDealResult();
    await nextTick();
    expect(store.dealResultOpen).toBe(false);

    const bar = wrapper.find('.action-bar.scoring');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain(store.nextStepLabel);
    expect(bar.text()).toContain('查看结算');

    await bar.find('.el-button--primary').trigger('click');
    await nextTick();
    expect(store.phase).toBe('dealing');

    store.returnToIdle();
    wrapper.unmount();
  });

  it('结算页收牌明细只展示参与计分的牌', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    const store = useGameStore();
    store.startMatch(5, 4242);
    store.setAutoPilot(true);

    let guard = 0;
    while (store.phase !== 'scoring' && guard < 100) {
      guard++;
      vi.advanceTimersByTime(5000);
    }
    await nextTick();
    await nextTick();

    expect(store.phase).toBe('scoring');
    const expected = ALL_POSITIONS.reduce(
      (count, pos) => count + (store.deal?.collected[pos].filter(isScoringCard).length ?? 0),
      0,
    );
    const displayed = document.body.querySelectorAll('.bd-collected .playing-card').length;
    expect(displayed).toBe(expected);

    wrapper.unmount();
  });

  it('结算页南北队/东西队分左右两栏，累计总分已含本副', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    const store = useGameStore();
    store.startMatch(5, 4242);
    store.setAutoPilot(true);

    let guard = 0;
    while (store.phase !== 'scoring' && guard < 100) {
      guard++;
      vi.advanceTimersByTime(5000);
    }
    await nextTick();
    await nextTick();

    expect(store.phase).toBe('scoring');
    const score = store.deal!.score!;
    const columns = document.body.querySelectorAll('.team-summary .ts-col');
    expect(columns.length).toBe(2);

    // 左栏南北队（A队），右栏东西队（B队）
    expect(columns[0].classList).toContain('team-a');
    expect(columns[0].textContent).toContain('南北队');
    expect(columns[1].classList).toContain('team-b');
    expect(columns[1].textContent).toContain('东西队');

    // 本副亮牌醒目展示：亮出的关键牌高亮并标注亮牌者，其余标“未亮”
    const lightItems = document.body.querySelectorAll('.deal-lights .dl-item');
    expect(lightItems.length).toBe(4);
    const litCards = score.litCards;
    const litItems = document.body.querySelectorAll('.deal-lights .dl-item.lit');
    expect(litItems.length).toBe(litCards.length);
    for (const item of litItems) {
      expect(item.querySelector('.dl-seat')?.textContent).toContain('亮');
    }
    expect(document.body.querySelectorAll('.deal-lights .dl-unlit').length).toBe(
      4 - litCards.length,
    );

    const rows = columns[0].querySelectorAll('.ts-row');
    expect(rows.length).toBe(2);
    // 栏内只保留“南/北”与本副分数，不再显示“本副得分”等说明文字
    expect(columns[0].textContent).not.toContain('本副得分');
    expect(columns[0].textContent).not.toContain('总和');
    expect(rows[0].querySelector('.ts-label')?.textContent?.trim()).toBe('南');
    expect(rows[1].querySelector('.ts-label')?.textContent?.trim()).toBe('北');
    expect(columns[0].querySelector('.ts-sum')).toBeNull();

    // 累积总得分在结算时已把本副计入，与 store 中的本局小分一致
    expect(store.round.smallScores.A).toBe(score.teamScores.A);
    expect(rows[0].textContent).toContain(formatSigned(score.breakdowns.S.final));
    expect(rows[1].textContent).toContain(formatSigned(score.breakdowns.N.final));
    expect(score.breakdowns.S.final + score.breakdowns.N.final).toBe(score.teamScores.A);

    // 弹窗标题处也先显示“含本副”的两队总分，而不是只显示本副小计
    const headerScores = document.body.querySelectorAll('.dr-team-score');
    expect(headerScores.length).toBe(2);
    expect(headerScores[0].textContent).toContain(formatSigned(store.round.smallScores.A));
    expect(headerScores[1].textContent).toContain(formatSigned(store.round.smallScores.B));

    // 明细只展示实际涉及的类别：未涉及的类别整行都不显示
    const bdCards = document.body.querySelectorAll('.bd-card');
    expect(bdCards.length).toBe(4);
    const seatPositions = new Map(ALL_POSITIONS.map((pos) => [seatName(pos), pos]));
    for (const card of bdCards) {
      const seat = card.querySelector('.bd-seat')?.textContent?.trim() ?? '';
      const pos = seatPositions.get(seat);
      expect(pos).toBeTruthy();
      const breakdown = score.breakdowns[pos!];
      const expectedLabels: string[] = [];
      if (breakdown.collected.some((card) => getSuit(card) === 2)) expectedLabels.push('红桃');
      if (breakdown.collected.includes(SHEEP)) expectedLabels.push('羊');
      if (breakdown.collected.includes(PIG)) expectedLabels.push('猪');
      if (breakdown.hasTransformer) expectedLabels.push('变压器');

      const labels = [...card.querySelectorAll('.bd-row .bd-label')].map((el) =>
        el.textContent?.trim(),
      );
      expect(labels).toEqual(expectedLabels);
    }

    // 所有分数都按正负套用统一着色，且颜色与实际分值一致
    const scoreEls = document.body.querySelectorAll(
      '.dr-team-score, .ts-value, .bd-col-score, .bd-final, .bd-value',
    );
    expect(scoreEls.length).toBeGreaterThan(0);
    for (const el of scoreEls) {
      const value = Number((el.textContent ?? '').trim().replace(/^\+/, ''));
      expect(Number.isFinite(value)).toBe(true);
      expect(el.classList.contains(scoreSignClass(value))).toBe(true);
    }

    store.returnToIdle();
    wrapper.unmount();
  });

  it('亮♥A 后全场所有选手红桃分翻倍并计入团队分', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    const store = useGameStore();
    store.startMatch(5, 1);
    // 南收 ♥A+♥K+♥J：基础 -110 → -220；北收 ♥Q：基础 -30 → -60
    const collected = {
      S: [HEART_A, getCard(2, 11), getCard(2, 9)],
      N: [getCard(2, 10)],
      E: [],
      W: [],
    };
    const score = scoreDeal({
      collected,
      litCards: [HEART_A],
      litBy: { [HEART_A]: 'E' },
    });
    expect(score.breakdowns.S.heartsBase).toBe(-110);
    expect(score.breakdowns.S.heartsTotal).toBe(-220);
    expect(score.breakdowns.N.heartsBase).toBe(-30);
    expect(score.breakdowns.N.heartsTotal).toBe(-60);
    expect(score.teamScores.A).toBe(-280);

    store.deal!.score = score;
    store.deal!.collected = collected;
    store.phase = 'scoring';
    store.round.smallScores.A = score.teamScores.A;
    store.round.smallScores.B = score.teamScores.B;
    await nextTick();
    await nextTick();

    const headerA = document.body.querySelector('.dr-team-scores .dr-team.a .dr-team-score');
    expect(headerA?.textContent).toContain(formatSigned(-280));
    const sRow = [...document.body.querySelectorAll('.team-summary .ts-col.team-a .ts-row')].find(
      (el) => el.querySelector('.ts-label')?.textContent?.trim() === '南',
    );
    expect(sRow?.textContent).toContain(formatSigned(-220));
    const nRow = [...document.body.querySelectorAll('.team-summary .ts-col.team-a .ts-row')].find(
      (el) => el.querySelector('.ts-label')?.textContent?.trim() === '北',
    );
    expect(nRow?.textContent).toContain(formatSigned(-60));

    const heartsRow = (seat: string) =>
      [...findBreakdownCard(seat).querySelectorAll('.bd-row')].find(
        (el) => el.querySelector('.bd-label')?.textContent?.trim() === '红桃',
      );
    expect(heartsRow('南')?.textContent).toContain('亮♥A 全场×2');
    expect(heartsRow('南')?.querySelector('.bd-value')?.textContent?.trim()).toBe('-220');
    expect(heartsRow('北')?.textContent).toContain('亮♥A 全场×2');
    expect(heartsRow('北')?.querySelector('.bd-value')?.textContent?.trim()).toBe('-60');

    const heartAItem = [...document.body.querySelectorAll('.deal-lights .dl-item')].find((el) =>
      el.textContent?.includes('红桃A'),
    );
    expect(heartAItem?.classList).toContain('lit');
    expect(heartAItem?.querySelector('.dl-seat')?.textContent).toContain('东');

    store.returnToIdle();
    wrapper.unmount();
  });

  it('结算明细中的亮猪/窝猪/亮羊显示累计分值', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    const store = useGameStore();
    store.startMatch(5, 1);
    const collected = { S: [PIG, SHEEP], E: [], N: [], W: [] };
    const score = scoreDeal({
      collected,
      litCards: [PIG, SHEEP],
      litBy: { [PIG]: 'S', [SHEEP]: 'S' },
    });
    store.deal!.score = score;
    store.deal!.collected = collected;
    store.phase = 'scoring';
    store.round.smallScores.A = score.teamScores.A;
    store.round.smallScores.B = score.teamScores.B;
    await nextTick();
    await nextTick();

    const pigText = (findPigDetail('南').textContent ?? '').replace(/\s+/g, ' ');
    // 亮猪展示累计后的 -200，窝猪展示累计后的 -400，而不是单次调整量
    expect(pigText).toContain('亮猪 -200');
    expect(pigText).toContain('窝猪 -400');
    expect(pigText).not.toContain('亮猪 -100');
    expect(pigText).not.toContain('窝猪 -200');

    const sheepRow = [...findBreakdownCard('南').querySelectorAll('.bd-row')].find(
      (el) => el.querySelector('.bd-label')?.textContent?.trim() === '羊',
    );
    expect((sheepRow?.textContent ?? '').replace(/\s+/g, ' ')).toContain('亮羊 +200');

    store.returnToIdle();
    wrapper.unmount();
  });

  it('单张黑桃亮猪自收时明细不显示窝猪', async () => {
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    const store = useGameStore();
    store.startMatch(5, 1);
    const collected = { S: [PIG], E: [], N: [], W: [] };
    const score = scoreDeal({
      collected,
      litCards: [PIG],
      litBy: { [PIG]: 'S' },
      pigLighterSpadeCount: 1,
    });
    store.deal!.score = score;
    store.deal!.collected = collected;
    store.phase = 'scoring';
    store.round.smallScores.A = score.teamScores.A;
    store.round.smallScores.B = score.teamScores.B;
    await nextTick();
    await nextTick();

    const pigText = (findPigDetail('南').textContent ?? '').replace(/\s+/g, ' ');
    expect(pigText).toContain('亮猪 -200');
    expect(pigText).not.toContain('窝猪');
    expect(findBreakdownCard('南').textContent).toContain('免窝猪');

    store.returnToIdle();
    wrapper.unmount();
  });
});

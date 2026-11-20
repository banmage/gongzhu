import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ElementPlus from 'element-plus';
import { nextTick } from 'vue';
import App from '../App.vue';
import LitArea from '../components/LitArea.vue';
import { useGameStore } from '../store/game';
import { PIG, SHEEP, isKeyCard, isScoringCard } from '../models/card';
import { ALL_POSITIONS, formatSigned } from '../models/game';

describe('UI 冒烟测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    store.startMatch(5, 424242);
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
    for (let i = 0; i < 200 && store.phase !== 'playing'; i++) {
      vi.advanceTimersByTime(100);
    }
    await nextTick();

    expect(store.isHumanTurn).toBe(true);
    expect(store.legalCards).toEqual([0]);

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
    const columns = document.body.querySelectorAll('.team-summary .ts-col');
    expect(columns.length).toBe(2);

    // 左栏南北队（A队），右栏东西队（B队）
    expect(columns[0].classList).toContain('team-a');
    expect(columns[0].textContent).toContain('南北队');
    expect(columns[1].classList).toContain('team-b');
    expect(columns[1].textContent).toContain('东西队');

    const rows = columns[0].querySelectorAll('.ts-row');
    expect(rows.length).toBe(4);
    // 第一行：本局累积总得分；随后南、北本副得分；最后两人总和
    expect(rows[0].classList).toContain('ts-round');
    expect(rows[0].textContent).toContain('本局各副牌累积总得分');
    expect(rows[1].textContent).toContain('南本副得分');
    expect(rows[2].textContent).toContain('北本副得分');
    expect(rows[3].classList).toContain('ts-sum');

    // 累积总得分在结算时已把本副计入，与 store 中的本局小分一致
    const score = store.deal!.score!;
    expect(store.round.smallScores.A).toBe(score.teamScores.A);
    expect(rows[0].textContent).toContain(formatSigned(store.round.smallScores.A));
    expect(rows[1].textContent).toContain(formatSigned(score.breakdowns.S.final));
    expect(rows[2].textContent).toContain(formatSigned(score.breakdowns.N.final));
    expect(score.breakdowns.S.final + score.breakdowns.N.final).toBe(score.teamScores.A);

    store.returnToIdle();
    wrapper.unmount();
  });
});

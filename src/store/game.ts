import { computed, reactive, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { KEY_CARDS, PIG, SPADE_3, cardBasePoints, cardLabel, getSuit, isKeyCard } from '../models/card';
import {
  ALL_POSITIONS,
  DEAL_ORDER,
  DEFAULT_CONFIG,
  formatSigned,
  normalizeCountdownSeconds,
  otherTeam,
  resultText,
  seatName,
  teamName,
  teamOf,
  type AuditInfo,
  type CardPlay,
  type DealRecord,
  type DealScore,
  type DealState,
  type GameConfig,
  type GameEvent,
  type GameEventType,
  type MatchFormat,
  type MatchState,
  type Phase,
  type Position,
  type RoundRecord,
  type RoundState,
  type Team,
  type Trick,
} from '../models/game';
import { dealWithSeed, findCardHolder } from '../core/deck';
import { randomSeed } from '../core/rng';
import {
  determineTrickWinner,
  evaluateDealConclusion,
  evaluateDealLimit,
  evaluatePigHeads,
  getLegalCards,
  pickTimeoutCard,
  remainingCards,
  resolveMatch,
  sortHand,
  trickBasePoints,
  type DealConclusion,
} from '../core/rules';
import { scoreDeal } from '../core/scoring';
import {
  chooseLights,
  choosePlay,
  recommendPlay,
  type PlayRecommendation,
} from '../core/ai';
import { buildPlayObservation, type PlayObservation } from '../core/aiObservation';
import {
  activateLightRule,
  getActiveLightRule,
  lightRuleRuntime,
  resetLightRuleRegistry,
  serializeLightRule,
} from '../rules/lightRuleRegistry';
import type { LightRuleConfig } from '../rules/lightRuleConfig';
import { cancelCountdownSpeech, isFinalCountdown, speakCountdown } from '../core/countdown';

/** 发牌动画每张牌的间隔 */
const DEAL_TICK_MS = 24;
/** 亮牌揭晓展示时长 */
const REVEAL_MS = 2300;
/** 四张牌全部打出后，墩面完整展示的总时长（含赢家高亮） */
const TRICK_DISPLAY_MS = 2000;
/** 墩面展示的后半段：赢家高亮时长 */
const TRICK_WINNER_HOLD_MS = 620;
/** 四张牌先完整展示、再揭晓赢家的等待时长 */
const TRICK_PRE_WINNER_MS = TRICK_DISPLAY_MS - TRICK_WINNER_HOLD_MS;
/** 南家只剩唯一合法牌时，自动出牌前的短暂停留 */
const SINGLE_CARD_AUTO_MS = 300;
/** 剩余牌全部为最大牌时，亮开手牌并展示给玩家的时长 */
const TOP_CARDS_REVEAL_MS = 1800;
/** 其他提前结束情形，展示结束提示的时长 */
const EARLY_CONCLUDE_MS = 900;

function emptyHands(): Record<Position, number[]> {
  return { S: [], E: [], N: [], W: [] };
}

function cloneHands(hands: Record<Position, number[]>): Record<Position, number[]> {
  return { S: [...hands.S], E: [...hands.E], N: [...hands.N], W: [...hands.W] };
}

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

function newMatchState(format: MatchFormat, seed: number): MatchState {
  return {
    format,
    totalPigHeads: { A: 0, B: 0 },
    rounds: [],
    winner: null,
    reason: '',
    finished: false,
    seed,
  };
}

function newRoundState(number: number, isExtra: boolean): RoundState {
  return {
    number,
    isExtra,
    smallScores: { A: 0, B: 0 },
    newPigHeads: { A: 0, B: 0 },
    dealsPlayed: 0,
    lastPigCollector: null,
    result: null,
  };
}

export const useGameStore = defineStore('gongzhu', () => {
  const phase = ref<Phase>('idle');
  const config = reactive<GameConfig>({ ...DEFAULT_CONFIG });
  const match = reactive<MatchState>(newMatchState(DEFAULT_CONFIG.format, 0));
  const round = reactive<RoundState>(newRoundState(1, false));
  const deal = ref<DealState | null>(null);

  const message = ref('选择赛制，开始对局');
  const isAiThinking = ref(false);
  const settling = ref(false);
  /** 结算页可被关闭；关闭后主页面仍保留“下一副”入口 */
  const dealResultDismissed = ref(false);
  const autoPilot = ref(false);
  const dealProgress = ref(0);
  const countdown = ref(0);
  const lightCountdown = ref(0);
  const humanLightSelection = ref<number[]>([]);
  const hintCard = ref<number | null>(null);
  const auditInfo = ref<AuditInfo | null>(null);
  const events = ref<GameEvent[]>([]);
  const dealHistory = ref<DealRecord[]>([]);
  /** 提前结束本副时，是否亮开所有人的剩余手牌 */
  const remainingRevealed = ref(false);
  /** 提前结束本副时，收下全部剩余牌的座位 */
  const remainingAwardTo = ref<Position | null>(null);
  /** 本副提前结束的判定结果（用于提示与测试） */
  const earlyConclusion = ref<DealConclusion | null>(null);
  let eventSeq = 0;

  /** 记录审计事件；亮牌提交后即视为公开信息，可写入具体牌种。 */
  function logEvent(
    type: GameEventType,
    detail: string,
    extra: { position?: Position; card?: number } = {},
  ): void {
    eventSeq += 1;
    events.value.push({
      seq: eventSeq,
      at: new Date().toISOString(),
      type,
      roundNumber: round.number,
      dealIndex: deal.value?.index ?? null,
      ...extra,
      detail,
    });
  }

  /* ------------------------------------------------------------------ *
   * 定时器管理
   * ------------------------------------------------------------------ */

  let dealTimer: ReturnType<typeof setInterval> | null = null;
  let dealFinishTimer: ReturnType<typeof setTimeout> | null = null;
  let lightCountdownTimer: ReturnType<typeof setInterval> | null = null;
  let playCountdownTimer: ReturnType<typeof setInterval> | null = null;
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  let aiTimer: ReturnType<typeof setTimeout> | null = null;
  let singleCardTimer: ReturnType<typeof setTimeout> | null = null;
  let trickTimer: ReturnType<typeof setTimeout> | null = null;
  let concludeTimer: ReturnType<typeof setTimeout> | null = null;
  let lightFinishTimer: ReturnType<typeof setTimeout> | null = null;
  let lightAiTimers: ReturnType<typeof setTimeout>[] = [];

  function clearDealTimer(): void {
    if (dealTimer !== null) clearInterval(dealTimer);
    dealTimer = null;
    if (dealFinishTimer !== null) clearTimeout(dealFinishTimer);
    dealFinishTimer = null;
  }

  function clearLightCountdown(): void {
    if (lightCountdownTimer !== null) clearInterval(lightCountdownTimer);
    lightCountdownTimer = null;
    cancelCountdownSpeech();
  }

  function clearPlayCountdown(): void {
    if (playCountdownTimer !== null) clearInterval(playCountdownTimer);
    playCountdownTimer = null;
    cancelCountdownSpeech();
  }

  function clearAiTimer(): void {
    if (aiTimer !== null) clearTimeout(aiTimer);
    aiTimer = null;
  }

  function clearSingleCardTimer(): void {
    if (singleCardTimer !== null) clearTimeout(singleCardTimer);
    singleCardTimer = null;
  }

  function clearTrickTimer(): void {
    if (trickTimer !== null) clearTimeout(trickTimer);
    trickTimer = null;
  }

  function clearConcludeTimer(): void {
    if (concludeTimer !== null) clearTimeout(concludeTimer);
    concludeTimer = null;
  }

  function clearLightTimers(): void {
    clearLightCountdown();
    if (lightFinishTimer !== null) clearTimeout(lightFinishTimer);
    lightFinishTimer = null;
    for (const timer of lightAiTimers) clearTimeout(timer);
    lightAiTimers = [];
  }

  function clearAllTimers(): void {
    clearDealTimer();
    clearLightTimers();
    clearPlayCountdown();
    clearAiTimer();
    clearSingleCardTimer();
    clearTrickTimer();
    clearConcludeTimer();
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = null;
  }

  /* ------------------------------------------------------------------ *
   * 计算属性
   * ------------------------------------------------------------------ */

  const isAiSeat = (pos: Position): boolean => pos !== 'S' || autoPilot.value;

  const humanSubmittedLight = computed(() => deal.value?.submitted.S ?? false);
  const canHumanPlay = computed(
    () =>
      phase.value === 'playing' &&
      !settling.value &&
      !!deal.value &&
      deal.value.nextPlayer === 'S' &&
      !isAiSeat('S'),
  );

  const legalCards = computed<number[]>(() => {
    if (phase.value !== 'playing' || settling.value || !deal.value) return [];
    return legalCardsFor(deal.value.nextPlayer);
  });

  const isHumanTurn = computed(
    () => phase.value === 'playing' && !settling.value && deal.value?.nextPlayer === 'S' && !isAiSeat('S'),
  );

  /** 亮牌读秒：只在南家仍需提交且剩余时间进入最后读秒区间时显示 */
  const lightCountdownVisible = computed(() => {
    const current = deal.value;
    return (
      phase.value === 'lighting' &&
      config.lightSeconds > 0 &&
      isFinalCountdown(lightCountdown.value) &&
      !!current &&
      !current.submitted.S &&
      !isAiSeat('S') &&
      current.hands.S.some((card) => isKeyCard(card))
    );
  });

  /** 出牌读秒：只在轮到南家且剩余时间进入最后读秒区间时显示 */
  const playCountdownVisible = computed(
    () =>
      phase.value === 'playing' &&
      config.playSeconds > 0 &&
      isFinalCountdown(countdown.value) &&
      isHumanTurn.value,
  );

  /**
   * 指定座位的出牌读秒。
   * 自己的读秒显示在推荐牌上；其他座位的读秒显示在中间牌背上。
   */
  function playCountdownFor(pos: Position): number | null {
    const current = deal.value;
    if (!current || phase.value !== 'playing' || settling.value) return null;
    if (config.playSeconds <= 0 || !isFinalCountdown(countdown.value)) return null;
    return current.nextPlayer === pos ? countdown.value : null;
  }

  const dealResultVisible = computed(() => phase.value === 'scoring' && !!deal.value?.score);
  /** 结算弹窗是否展开：关闭后仍可再次打开 */
  const dealResultOpen = computed(() => dealResultVisible.value && !dealResultDismissed.value);
  const matchResultVisible = computed(() => phase.value === 'matchEnd');
  const roundEnded = computed(() => round.result !== null);

  const currentTrick = computed(() => deal.value?.currentTrick ?? null);
  const allLit = computed(() => deal.value?.litCards ?? []);

  const teamScores = computed(() => round.smallScores);

  /** 本副已亮牌数量（揭晓前只统计提交，不含自动亮） */
  const submittedLitCount = computed(() => {
    if (!deal.value) return 0;
    return ALL_POSITIONS.reduce((sum, pos) => sum + deal.value!.submissions[pos].length, 0);
  });

  /** 已提交亮牌的家数 */
  const submittedSeatCount = computed(() => {
    if (!deal.value) return 0;
    return ALL_POSITIONS.filter((pos) => deal.value!.submitted[pos]).length;
  });

  /** 当前已公开的亮牌（open 模式）：已揭晓 + 亮牌阶段已提交的牌。 */
  function publiclyLitCards(current: DealState): number[] {
    const cards = new Set<number>(current.litCards);
    if (phase.value === 'lighting') {
      for (const pos of ALL_POSITIONS) {
        for (const card of current.submissions[pos]) cards.add(card);
      }
    }
    return [...cards];
  }

  /**
   * 按当前激活的亮牌规则（可热插拔）计算某座位的推荐亮牌。
   * 规则引擎只使用该座位手牌与公开信息。
   */
  function recommendLightsFor(pos: Position): number[] {
    const current = deal.value;
    if (!current) return [];
    return chooseLights({
      hand: current.hands[pos],
      position: pos,
      teamSmallScore: round.smallScores[teamOf(pos)],
      opponentSmallScore: round.smallScores[otherTeam(teamOf(pos))],
      dealIndex: current.index,
      litCount: submittedLitCount.value,
      seed: current.seed,
      litCards: publiclyLitCards(current),
      rule: getActiveLightRule(),
    });
  }

  /** 管理员热更新规则后，立即刷新南家尚未提交的推荐亮牌。 */
  function refreshHumanLightRecommendation(): void {
    const current = deal.value;
    if (!current || phase.value !== 'lighting' || current.submitted.S || isAiSeat('S')) return;
    humanLightSelection.value = recommendLightsFor('S');
  }

  /** 发牌动画中每个座位已经收到的牌数 */
  function dealtCount(pos: Position): number {
    const index = DEAL_ORDER.indexOf(pos);
    const progress = dealProgress.value;
    return Math.max(0, Math.min(13, Math.floor((progress + 3 - index) / 4)));
  }

  /** 界面展示用手牌：发牌阶段按进度逐步显示，其他阶段显示真实手牌 */
  function visibleHand(pos: Position): number[] {
    const current = deal.value;
    if (!current) return [];
    if (phase.value === 'dealing') return current.hands[pos].slice(0, dealtCount(pos));
    return current.hands[pos];
  }

  function legalCardsFor(pos: Position): number[] {
    const current = deal.value;
    if (!current) return [];
    const leadSuit = current.currentTrick.plays.length
      ? getSuit(current.currentTrick.plays[0].card)
      : null;
    return getLegalCards({
      hand: current.hands[pos],
      leadSuit,
      isFirstLedSuit: current.currentTrick.isFirstLed,
      litCards: current.litCards,
      suitStatus: current.firstLedSuitStatus,
    });
  }

  /** 构造只含公开信息的出牌观察，供概率出牌 AI 使用。 */
  function playObservationFor(pos: Position, legal: number[]): PlayObservation {
    const current = deal.value;
    if (!current) throw new Error('当前没有进行中的牌局');
    return buildPlayObservation({
      deal: current,
      self: pos,
      round,
      match,
      config,
      legalCards: legal,
    });
  }

  /** 亮牌后每个座位亮出的牌 */
  function seatLitCards(pos: Position): number[] {
    const current = deal.value;
    if (!current || phase.value === 'lighting' || phase.value === 'dealing') return [];
    return current.litCards.filter((card) => current.litBy[card] === pos);
  }

  /** 亮牌阶段每个座位已提交的亮牌数量 */
  function seatLightCount(pos: Position): number {
    const current = deal.value;
    if (!current) return 0;
    if (phase.value === 'lighting') return current.submissions[pos].length;
    return current.litCards.filter((card) => current.litBy[card] === pos).length;
  }

  /** 某座位当前已收牌的基础分（展示用，所有牌均为公开出牌） */
  function collectedBasePoints(pos: Position): number {
    const current = deal.value;
    if (!current) return 0;
    return current.collected[pos].reduce((sum, card) => sum + cardBasePoints(card), 0);
  }

  function seatStatus(pos: Position): string {
    const current = deal.value;
    if (!current) return '';
    if (phase.value === 'dealing') return dealtCount(pos) >= 13 ? '已发牌' : `发牌 ${dealtCount(pos)}/13`;
    if (phase.value === 'lighting') {
      if (current.submitted[pos]) {
        return current.submissions[pos].length > 0 ? `已提交 · 亮${current.submissions[pos].length}张` : '已提交 · 不亮';
      }
      return isAiSeat(pos) ? '思考中…' : '待提交';
    }
    if (phase.value === 'revealing') {
      const count = seatLightCount(pos);
      return count > 0 ? `亮${count}张` : '未亮';
    }
    if (phase.value === 'playing') {
      if (settling.value && current.currentTrick.winner === pos) return '赢墩';
      if (current.nextPlayer === pos) return isAiSeat(pos) ? '思考中…' : '轮到你';
      return '等待';
    }
    if (phase.value === 'scoring') return '已结算';
    return '';
  }

  /** 首轮限制状态（花色首次领出后解除） */
  const firstLeadStatus = computed(() => {
    const status = deal.value?.firstLedSuitStatus;
    return [
      { suit: 3, label: '♠', state: status?.[3] ?? 'NOT_LED' },
      { suit: 2, label: '♥', state: status?.[2] ?? 'NOT_LED' },
      { suit: 0, label: '♣', state: status?.[0] ?? 'NOT_LED' },
      { suit: 1, label: '♦', state: status?.[1] ?? 'NOT_LED' },
    ] as const;
  });

  /** 当前回合的倒计时展示值：仅在最后读秒区间显示具体秒数 */
  const countdownText = computed(() => {
    if (phase.value === 'lighting') {
      if (config.lightSeconds <= 0) return '不限时';
      return lightCountdownVisible.value ? `${lightCountdown.value}s` : '—';
    }
    if (phase.value === 'playing' && !isAiSeat(deal.value?.nextPlayer ?? 'S')) {
      if (config.playSeconds <= 0) return '不限时';
      return playCountdownVisible.value ? `${countdown.value}s` : '—';
    }
    return '—';
  });

  const hintText = computed(() => {
    if (!hintCard.value) return '';
    return `建议出 ${cardLabel(hintCard.value)}（仅辅助，可自由选择）`;
  });

  /**
   * 轮到南家出牌时，实时给出系统推荐的出牌、评分明细和公开信息推断。
   * 计算属性带缓存，同一手牌状态下推荐结果稳定，不会因为无关重绘而闪烁。
   */
  const playRecommendation = computed<PlayRecommendation | null>(() => {
    const current = deal.value;
    if (!current || phase.value !== 'playing' || settling.value) return null;
    if (current.nextPlayer !== 'S' || isAiSeat('S')) return null;
    const legal = legalCards.value;
    if (legal.length === 0) return null;
    const preferred =
      hintCard.value !== null && legal.includes(hintCard.value) ? hintCard.value : undefined;
    return recommendPlay(playObservationFor('S', legal), { preferredCard: preferred });
  });

  /** 界面用闪烁箭头指向的推荐牌。 */
  const recommendedCard = computed<number | null>(() => playRecommendation.value?.card ?? null);

  /* ------------------------------------------------------------------ *
   * 开局 / 局 / 副
   * ------------------------------------------------------------------ */

  function startMatch(format: MatchFormat, seed?: number): void {
    clearAllTimers();
    config.format = format;
    config.lightSeconds = normalizeCountdownSeconds(
      config.lightSeconds,
      DEFAULT_CONFIG.lightSeconds,
    );
    config.playSeconds = normalizeCountdownSeconds(
      config.playSeconds,
      DEFAULT_CONFIG.playSeconds,
    );
    config.dealLimit = Math.max(1, Math.min(60, Math.round(config.dealLimit || 20)));
    const matchSeed = seed ?? randomSeed();
    Object.assign(match, newMatchState(format, matchSeed));
    Object.assign(round, newRoundState(1, false));
    deal.value = null;
    auditInfo.value = null;
    events.value = [];
    dealHistory.value = [];
    eventSeq = 0;
    settling.value = false;
    isAiThinking.value = false;
    hintCard.value = null;
    dealResultDismissed.value = false;
    message.value = `${format}局制开始，南北队 vs 东西队`;
    logEvent(
      'MATCH_STARTED',
      `${format}局制开始；A队=南北，B队=东西；发牌种子 #${matchSeed}；单局上限 ${config.dealLimit} 副；亮牌 ${
        config.lightSeconds > 0 ? `${config.lightSeconds}s` : '不限时'
      } / 出牌 ${config.playSeconds > 0 ? `${config.playSeconds}s` : '不限时'}；第四张自动亮${
        config.autoLightLastOne ? '开启' : '关闭'
      }`,
    );
    startRound(1);
  }

  function returnToIdle(): void {
    clearAllTimers();
    phase.value = 'idle';
    deal.value = null;
    auditInfo.value = null;
    events.value = [];
    dealHistory.value = [];
    eventSeq = 0;
    settling.value = false;
    isAiThinking.value = false;
    dealResultDismissed.value = false;
    Object.assign(match, newMatchState(config.format, 0));
    Object.assign(round, newRoundState(1, false));
    message.value = '选择赛制，开始对局';
  }

  function startRound(number: number): void {
    clearAllTimers();
    const isExtra = match.format === 5 && number > 5;
    Object.assign(round, newRoundState(number, isExtra));
    message.value = isExtra ? `加赛第 ${number} 局开始` : `第 ${number} 局开始`;
    startDeal();
  }

  function startDeal(): void {
    clearAllTimers();
    const dealIndex = round.dealsPlayed + 1;
    const seed = (match.seed + round.number * 7919 + dealIndex * 104729) >>> 0;
    const { hands, audit } = dealWithSeed(seed);
    auditInfo.value = audit;

    const leader: Position =
      round.dealsPlayed === 0 ? findCardHolder(hands, SPADE_3) : (round.lastPigCollector ?? 'S');
    const openingDeal = round.dealsPlayed === 0;

    deal.value = {
      index: dealIndex,
      seed,
      hands: cloneHands(hands),
      originalHands: cloneHands(hands),
      leader,
      openingDeal,
      litCards: [],
      litBy: {},
      autoLitCards: [],
      submissions: { S: [], E: [], N: [], W: [] },
      submitted: { S: false, E: false, N: false, W: false },
      allKeyCardsLit: false,
      firstLedSuitStatus: { 0: 'NOT_LED', 1: 'NOT_LED', 2: 'NOT_LED', 3: 'NOT_LED' },
      tricks: [],
      currentTrick: emptyTrick(leader),
      nextPlayer: leader,
      collected: emptyHands(),
      pigCollector: null,
      phase: 'dealing',
      score: null,
      lastAction: null,
    };

    phase.value = 'dealing';
    dealProgress.value = 0;
    humanLightSelection.value = [];
    hintCard.value = null;
    settling.value = false;
    isAiThinking.value = false;
    dealResultDismissed.value = false;
    remainingRevealed.value = false;
    remainingAwardTo.value = null;
    earlyConclusion.value = null;
    message.value = `第 ${round.number} 局 · 第 ${dealIndex} 副：发牌中…`;
    logEvent(
      'DEAL_CREATED',
      `第 ${round.number} 局第 ${dealIndex} 副发牌；种子 #${seed}；${seatName(leader)}领出${
        openingDeal ? '（首副持♠3，首引花色不限）' : ''
      }`,
      { position: leader },
    );

    dealTimer = setInterval(() => {
      dealProgress.value += 1;
      if (dealProgress.value >= 52) {
        clearDealTimer();
        dealFinishTimer = setTimeout(() => beginLighting(), 520);
      }
    }, DEAL_TICK_MS);
  }

  /* ------------------------------------------------------------------ *
   * 亮牌阶段
   * ------------------------------------------------------------------ */

  function beginLighting(): void {
    const current = deal.value;
    if (!current) return;
    current.phase = 'lighting';
    phase.value = 'lighting';
    lightCountdown.value = config.lightSeconds;

    // 系统推荐：按当前激活的亮牌规则把推荐亮出的关键牌弹起，玩家可点击收回或改选
    humanLightSelection.value = isAiSeat('S') ? [] : recommendLightsFor('S');
    message.value =
      humanLightSelection.value.length > 0
        ? `亮牌阶段：已推荐亮出 ${humanLightSelection.value.length} 张，可点击调整后亮牌${
            config.lightSeconds > 0 ? '' : '（本局无读秒）'
          }`
        : `亮牌阶段：点击可亮的关键牌使其弹起，再点击“亮牌”公开${
            config.lightSeconds > 0 ? '' : '（本局无读秒）'
          }`;

    clearLightTimers();
    if (config.lightSeconds > 0) {
      lightCountdownTimer = setInterval(() => {
        lightCountdown.value -= 1;
        if (lightCountdown.value <= 0) {
          clearLightCountdown();
          // V1.0 §3.3：倒计时结束自动提交当前选择（通常为空）。
          autoSubmitHumanLightOnTimeout();
          finishLighting();
          return;
        }
        announceLightCountdown();
      }, 1000);
    }

    scheduleAiLightSubmissions();

    // 手中没有可亮的牌：自动跳过亮牌提交，界面上不再出现“提交亮牌”按钮
    if (!current.hands.S.some((card) => isKeyCard(card))) {
      submitLight('S', []);
      message.value = '手中没有可亮的牌，已自动跳过亮牌';
    } else {
      announceLightCountdown();
    }
  }

  /** 亮牌最后读秒：只在南家仍需提交时语音播报 */
  function announceLightCountdown(): void {
    const current = deal.value;
    if (!current || phase.value !== 'lighting') return;
    if (current.submitted.S || isAiSeat('S')) return;
    if (!current.hands.S.some((card) => isKeyCard(card))) return;
    speakCountdown(lightCountdown.value);
  }

  /**
   * 亮牌读秒结束：把南家当前选择（可能为空）作为最终提交。
   * 若南家已提交或由 AI 托管，则不做任何事。
   */
  function autoSubmitHumanLightOnTimeout(): void {
    const current = deal.value;
    if (!current || phase.value !== 'lighting') return;
    if (current.submitted.S || isAiSeat('S')) return;
    submitLight('S', [...humanLightSelection.value]);
  }

  function scheduleAiLightSubmissions(): void {
    const current = deal.value;
    if (!current) return;
    ALL_POSITIONS.forEach((pos, index) => {
      if (!isAiSeat(pos)) return;
      const delay = config.aiDelayMs + 500 + index * 260 + Math.random() * 900;
      const timer = setTimeout(() => {
        const live = deal.value;
        if (phase.value !== 'lighting' || !live || live.submitted[pos]) return;
        submitLight(pos, recommendLightsFor(pos));
      }, delay);
      lightAiTimers.push(timer);
    });
  }

  function toggleHumanLight(card: number): void {
    const current = deal.value;
    if (!current || phase.value !== 'lighting' || current.submitted.S) return;
    if (!isKeyCard(card) || !current.hands.S.includes(card)) return;
    const index = humanLightSelection.value.indexOf(card);
    if (index >= 0) humanLightSelection.value.splice(index, 1);
    else humanLightSelection.value.push(card);
  }

  function submitHumanLight(cards?: number[]): void {
    if (phase.value !== 'lighting') return;
    submitLight('S', cards ?? [...humanLightSelection.value]);
  }

  function submitLight(pos: Position, cards: number[]): void {
    const current = deal.value;
    if (!current || phase.value !== 'lighting' || current.submitted[pos]) return;
    const unique = [...new Set(cards)].filter(
      (card) => isKeyCard(card) && current.hands[pos].includes(card),
    );
    current.submissions[pos] = unique;
    current.submitted[pos] = true;
    if (pos === 'S') message.value = '已提交亮牌，等待其他玩家…';
    logEvent(
      'PLAYER_LIGHT_SUBMITTED',
      `${seatName(pos)}提交亮牌：${unique.length > 0 ? `亮 ${unique.map((card) => cardLabel(card)).join('、')}` : '不亮'}`,
      { position: pos },
    );

    if (ALL_POSITIONS.every((seat) => current.submitted[seat])) {
      clearLightTimers();
      lightFinishTimer = setTimeout(() => finishLighting(), 380);
    }
  }

  function finishLighting(): void {
    const current = deal.value;
    if (!current || phase.value !== 'lighting') return;
    clearLightTimers();

    const litCards: number[] = [];
    const litBy: Record<number, Position> = {};
    for (const pos of ALL_POSITIONS) {
      for (const card of current.submissions[pos]) {
        if (!litCards.includes(card)) {
          litCards.push(card);
          litBy[card] = pos;
        }
      }
    }

    const autoLitCards: number[] = [];
    if (config.autoLightLastOne && litCards.length === 3) {
      const remaining = (KEY_CARDS as readonly number[]).find((card) => !litCards.includes(card));
      if (remaining !== undefined) {
        const holder = findCardHolder(current.hands, remaining);
        litCards.push(remaining);
        litBy[remaining] = holder;
        autoLitCards.push(remaining);
      }
    }

    current.litCards = litCards;
    current.litBy = litBy;
    current.autoLitCards = autoLitCards;
    current.allKeyCardsLit = litCards.length === 4;
    current.phase = 'revealing';
    phase.value = 'revealing';
    if (auditInfo.value) auditInfo.value.revealedAt = new Date().toISOString();

    if (autoLitCards.length > 0) {
      const card = autoLitCards[0];
      message.value = `自动亮：${cardLabel(card)}（${seatName(litBy[card])}）`;
      logEvent('AUTO_LIGHT_TRIGGERED', `已亮3张，自动亮最后一张：${cardLabel(card)}（${seatName(litBy[card])}）`, {
        position: litBy[card],
        card,
      });
    } else if (current.allKeyCardsLit) {
      message.value = '四张关键牌全部亮出！';
    } else {
      message.value = '亮牌揭晓';
    }

    logEvent(
      'LIGHT_REVEALED',
      litCards.length > 0
        ? `亮牌揭晓：${litCards
            .map((card) => `${cardLabel(card)}（${seatName(litBy[card])}${autoLitCards.includes(card) ? '·自动亮' : ''}）`)
            .join('、')}`
        : '亮牌揭晓：本副无人亮牌',
    );

    revealTimer = setTimeout(() => beginPlaying(), REVEAL_MS);
  }

  /* ------------------------------------------------------------------ *
   * 出牌阶段
   * ------------------------------------------------------------------ */

  function beginPlaying(): void {
    const current = deal.value;
    if (!current) return;
    current.phase = 'playing';
    phase.value = 'playing';
    current.nextPlayer = current.leader;
    current.currentTrick = emptyTrick(current.leader);
    settling.value = false;
    message.value = current.openingDeal
      ? `首副：${seatName(current.leader)}持♠3领出，首引花色不限`
      : `${seatName(current.leader)}领出`;

    const conclusion = evaluateDealConclusion(current.hands, current.collected, current.leader);
    if (conclusion) {
      concludeDealEarly(current.leader, conclusion);
      return;
    }

    startPlayCountdown();
    scheduleAiIfNeeded();
  }

  function conclusionMessage(conclusion: DealConclusion, recipient: Position): string {
    switch (conclusion.reason) {
      case 'TOP_CARDS':
        return `${seatName(recipient)}手中剩余牌均为场上最大牌，亮开所有人剩余手牌，全部剩余牌归${seatName(recipient)}，本副结束`;
      case 'ALL_SCORING_COLLECTED':
        return `红桃与猪、羊、变压器均已归属，本副提前结束`;
      case 'HARMLESS_REMAINDER':
        return `剩余牌均无分值且不影响全红与变压器，本副提前结束`;
    }
  }

  /** 结算页展示用的提前结束说明 */
  const earlyConclusionText = computed(() => {
    const conclusion = earlyConclusion.value;
    if (!conclusion) return '';
    const recipient = remainingAwardTo.value ?? deal.value?.leader ?? 'S';
    return conclusionMessage(conclusion, recipient);
  });

  /** 提前结束本副：锁定出牌权，亮开手牌（如需要），随后进入计分阶段 */
  function concludeDealEarly(recipient: Position, conclusion: DealConclusion): void {
    const current = deal.value;
    if (!current || phase.value !== 'playing') return;

    clearPlayCountdown();
    clearAiTimer();
    clearSingleCardTimer();
    clearTrickTimer();
    clearConcludeTimer();
    isAiThinking.value = false;
    settling.value = true;
    remainingRevealed.value = conclusion.reveal;
    remainingAwardTo.value = recipient;
    earlyConclusion.value = conclusion;

    const remaining = remainingCards(current.hands);
    const text = conclusionMessage(conclusion, recipient);
    message.value = `${text}（剩余 ${remaining.length} 张）`;
    logEvent('DEAL_CONCLUDED', `${text}（剩余 ${remaining.length} 张）`, { position: recipient });

    concludeTimer = setTimeout(() => {
      concludeTimer = null;
      endDeal();
    }, conclusion.reveal ? TOP_CARDS_REVEAL_MS : EARLY_CONCLUDE_MS);
  }

  function startPlayCountdown(): void {
    clearPlayCountdown();
    const current = deal.value;
    if (!current || phase.value !== 'playing' || config.playSeconds <= 0) {
      countdown.value = 0;
      return;
    }
    // AI 座位也启动读秒，仅用于界面展示；实际出牌仍由 AI 调度器负责。
    countdown.value = config.playSeconds;
    announcePlayCountdown();
    playCountdownTimer = setInterval(() => {
      countdown.value -= 1;
      if (countdown.value <= 0) {
        clearPlayCountdown();
        const live = deal.value;
        if (!live || phase.value !== 'playing' || settling.value) return;
        const pos = live.nextPlayer;
        if (isAiSeat(pos)) return;
        const legal = legalCardsFor(pos);
        if (legal.length > 0) {
          const card = pickTimeoutCard(legal);
          message.value = `${seatName(pos)}超时，系统自动出牌：${cardLabel(card)}`;
          applyPlay(pos, card, { auto: true });
        }
        return;
      }
      announcePlayCountdown();
    }, 1000);
  }

  /** 出牌最后读秒：只在轮到南家时语音播报 */
  function announcePlayCountdown(): void {
    if (phase.value !== 'playing' || !isHumanTurn.value) return;
    speakCountdown(countdown.value);
  }

  /** 南家只剩唯一合法牌时无需选择，短暂停留后自动打出 */
  function scheduleSingleCardAutoPlay(pos: Position): void {
    clearSingleCardTimer();
    const current = deal.value;
    if (
      pos !== 'S' ||
      isAiSeat(pos) ||
      !current ||
      phase.value !== 'playing' ||
      settling.value ||
      current.nextPlayer !== pos
    ) {
      return;
    }
    const legal = legalCardsFor(pos);
    if (legal.length !== 1) return;
    const card = legal[0];
    singleCardTimer = setTimeout(() => {
      singleCardTimer = null;
      const live = deal.value;
      if (!live || phase.value !== 'playing' || settling.value || live.nextPlayer !== pos) return;
      const liveLegal = legalCardsFor(pos);
      if (liveLegal.length !== 1 || liveLegal[0] !== card) return;
      message.value = `${seatName(pos)}只剩一张合法牌，自动出牌：${cardLabel(card)}`;
      applyPlay(pos, card, { single: true });
    }, SINGLE_CARD_AUTO_MS);
  }

  function scheduleAiIfNeeded(): void {
    clearAiTimer();
    clearSingleCardTimer();
    const current = deal.value;
    if (!current || phase.value !== 'playing' || settling.value) {
      isAiThinking.value = false;
      return;
    }
    const pos = current.nextPlayer;
    if (!isAiSeat(pos)) {
      isAiThinking.value = false;
      scheduleSingleCardAutoPlay(pos);
      return;
    }
    isAiThinking.value = true;
    aiTimer = setTimeout(() => {
      const live = deal.value;
      if (!live || phase.value !== 'playing' || settling.value || live.nextPlayer !== pos) {
        isAiThinking.value = false;
        return;
      }
      const legal = legalCardsFor(pos);
      if (legal.length === 0) {
        isAiThinking.value = false;
        return;
      }
      const card = choosePlay(playObservationFor(pos, legal));
      applyPlay(pos, card, { ai: true });
    }, config.aiDelayMs + Math.random() * 500);
  }

  function humanPlay(card: number): boolean {
    if (!canHumanPlay.value) return false;
    const current = deal.value;
    if (!current) return false;
    if (!legalCardsFor('S').includes(card)) {
      message.value = '该牌不合法：有领出花色必须跟牌，受首轮限制的亮牌也不能出';
      return false;
    }
    hintCard.value = null;
    return applyPlay('S', card, {});
  }

  function applyPlay(
    pos: Position,
    card: number,
    meta: { auto?: boolean; ai?: boolean; single?: boolean },
  ): boolean {
    const current = deal.value;
    if (!current || phase.value !== 'playing' || settling.value) return false;
    if (current.nextPlayer !== pos) return false;
    const legal = legalCardsFor(pos);
    if (!legal.includes(card)) return false;
    const index = current.hands[pos].indexOf(card);
    if (index < 0) return false;

    clearPlayCountdown();
    clearAiTimer();
    clearSingleCardTimer();
    isAiThinking.value = false;

    hintCard.value = null;
    current.hands[pos].splice(index, 1);
    const play: CardPlay = {
      position: pos,
      card,
      auto: meta.auto,
      ai: meta.ai,
      single: meta.single,
    };
    current.lastAction = play;
    current.currentTrick.plays.push(play);
    current.currentTrick.points = trickBasePoints(current.currentTrick.plays);

    if (meta.auto) {
      logEvent('TIMEOUT_AUTO_PLAY', `${seatName(pos)}超时，系统按最小合法牌规则自动出 ${cardLabel(card)}`, {
        position: pos,
        card,
      });
    } else if (meta.single) {
      logEvent(
        'CARD_PLAYED',
        `${seatName(pos)}只剩唯一合法牌，自动出 ${cardLabel(card)}`,
        { position: pos, card },
      );
    } else {
      logEvent(
        'CARD_PLAYED',
        `${seatName(pos)}${meta.ai ? '（AI）' : ''}出 ${cardLabel(card)}`,
        { position: pos, card },
      );
    }

    if (current.currentTrick.plays.length === 1) {
      const leadSuit = getSuit(card);
      current.currentTrick.firstLedSuit = leadSuit;
      if (current.firstLedSuitStatus[leadSuit] === 'NOT_LED') {
        current.firstLedSuitStatus[leadSuit] = 'LED';
        current.currentTrick.isFirstLed = true;
      }
    }

    if (current.currentTrick.plays.length === 4) {
      settling.value = true;
      clearTrickTimer();
      trickTimer = setTimeout(() => settleTrick(), TRICK_PRE_WINNER_MS);
      message.value = '四张牌已出完，即将揭晓本墩赢家…';
      return true;
    }

    current.nextPlayer = nextPositionInDeal(pos);
    message.value = meta.auto
      ? `${seatName(pos)}超时自动出牌：${cardLabel(card)}`
      : meta.single
        ? `${seatName(pos)}只剩唯一合法牌，自动出牌：${cardLabel(card)}`
        : `${seatName(pos)}出 ${cardLabel(card)}`;
    startPlayCountdown();
    scheduleAiIfNeeded();
    return true;
  }

  function settleTrick(): void {
    const current = deal.value;
    if (!current || current.currentTrick.plays.length !== 4) return;
    const winner = determineTrickWinner(current.currentTrick.plays);
    current.currentTrick.winner = winner;
    current.currentTrick.points = trickBasePoints(current.currentTrick.plays);
    const cards = current.currentTrick.plays.map((play) => play.card);
    current.collected[winner].push(...cards);
    current.tricks.push({ ...current.currentTrick });

    const points = current.currentTrick.points;
    message.value = `${seatName(winner)}赢得本墩${points !== 0 ? `（${formatSigned(points)}分）` : ''}`;
    logEvent(
      'TRICK_COMPLETED',
      `第 ${current.tricks.length} 墩：${seatName(winner)}赢墩${points !== 0 ? `，本墩基础分 ${formatSigned(points)}` : '，本墩无分牌'}`,
      { position: winner },
    );

    if (current.tricks.length === 13) {
      clearTrickTimer();
      trickTimer = setTimeout(() => endDeal(), TRICK_WINNER_HOLD_MS);
      return;
    }

    // 赢家获得下一墩出牌权；若已经满足提前结束条件，先完整展示本墩再结束。
    const conclusion = evaluateDealConclusion(current.hands, current.collected, winner);
    if (conclusion) {
      clearTrickTimer();
      trickTimer = setTimeout(() => {
        trickTimer = null;
        concludeDealEarly(winner, conclusion);
      }, TRICK_WINNER_HOLD_MS);
      return;
    }

    clearTrickTimer();
    trickTimer = setTimeout(() => {
      const live = deal.value;
      if (!live) return;
      live.currentTrick = emptyTrick(winner);
      live.nextPlayer = winner;
      settling.value = false;
      message.value = `${seatName(winner)}领出`;
      startPlayCountdown();
      scheduleAiIfNeeded();
    }, TRICK_WINNER_HOLD_MS);
  }

  function nextPositionInDeal(pos: Position): Position {
    const order: Position[] = ['S', 'E', 'N', 'W'];
    return order[(order.indexOf(pos) + 1) % 4];
  }

  /* ------------------------------------------------------------------ *
   * 结算
   * ------------------------------------------------------------------ */

  function endDeal(): void {
    const current = deal.value;
    if (!current) return;
    clearPlayCountdown();
    clearAiTimer();
    clearSingleCardTimer();
    clearTrickTimer();
    clearConcludeTimer();
    settling.value = false;
    isAiThinking.value = false;

    // 提前结束时，剩余手牌全部归控制出牌权的座位。
    // 触发条件已保证这些牌要么无分值，要么全部是场上最大牌。
    const conclusion = earlyConclusion.value;
    const awardTo = remainingAwardTo.value;
    if (awardTo) {
      const leftovers = remainingCards(current.hands);
      if (leftovers.length > 0) {
        current.collected[awardTo].push(...leftovers);
        for (const pos of ALL_POSITIONS) current.hands[pos] = [];
      }
      // 保留 remainingAwardTo 供结算页说明使用，下一副发牌时统一重置。
    }
    const conclusionPrefix =
      conclusion && awardTo ? `${conclusionMessage(conclusion, awardTo)}；` : '';

    const pigLighter = current.litBy[PIG];
    /** 亮猪者亮牌时（亮牌阶段手牌完整）手中的黑桃张数 */
    const pigLighterSpadeCount = pigLighter
      ? current.originalHands[pigLighter].filter((card) => getSuit(card) === 3).length
      : undefined;
    const score: DealScore = scoreDeal({
      collected: current.collected,
      litCards: current.litCards,
      litBy: current.litBy,
      autoLitCards: current.autoLitCards,
      pigLighterSpadeCount,
    });
    current.score = score;
    current.phase = 'scoring';
    current.pigCollector = ALL_POSITIONS.find((pos) => current.collected[pos].includes(PIG)) ?? null;
    round.lastPigCollector = current.pigCollector;
    round.dealsPlayed += 1;
    phase.value = 'scoring';
    // 每副结算时重新展开结算页
    dealResultDismissed.value = false;

    logEvent(
      'SCORE_CALCULATED',
      `第 ${current.index} 副结算：${ALL_POSITIONS.map(
        (pos) => `${seatName(pos)} ${formatSigned(score.breakdowns[pos].final)}`,
      ).join(' / ')}；团队本副 A ${formatSigned(score.teamScores.A)} / B ${formatSigned(
        score.teamScores.B,
      )}${score.slam.triggered ? '（满贯，正式分不参与小分）' : ''}`,
    );

    dealHistory.value.push({
      index: current.index,
      seed: current.seed,
      roundNumber: round.number,
      leader: current.leader,
      openingDeal: current.openingDeal,
      litCards: [...current.litCards],
      litBy: { ...current.litBy },
      autoLitCards: [...current.autoLitCards],
      allKeyCardsLit: current.allKeyCardsLit,
      tricks: current.tricks.map((trick) => ({
        ...trick,
        plays: trick.plays.map((play) => ({ ...play })),
      })),
      collected: {
        S: [...current.collected.S],
        E: [...current.collected.E],
        N: [...current.collected.N],
        W: [...current.collected.W],
      },
      score,
      pigCollector: current.pigCollector,
    });

    if (score.slam.triggered && score.slam.team && score.slam.position) {
      const slamTeam = score.slam.team;
      const opponent = otherTeam(slamTeam);
      const newPigHeads: Record<Team, number> = { A: 0, B: 0 };
      newPigHeads[opponent] = score.slam.pigHeads;
      round.newPigHeads = { ...newPigHeads };
      round.result = {
        newPigHeads,
        winner: slamTeam,
        loser: opponent,
        result: slamTeam === 'A' ? 'A_WIN' : 'B_WIN',
        reason: `满贯！${seatName(score.slam.position)}集齐猪、羊、变压器与全部13张红桃，${teamName(
          slamTeam,
        )}赢下本局；该副${score.slam.allKeyCardsLit ? '四张全亮' : '非全亮'}，${teamName(
          opponent,
        )}被画${score.slam.pigHeads}头`,
        endReason: 'SLAM',
        slam: score.slam,
      };
      message.value = `满贯！${teamName(slamTeam)}赢下本局`;
      logEvent(
        'PIG_HEAD_ASSIGNED',
        `满贯画头：${teamName(opponent)}被画 ${score.slam.pigHeads} 头（${score.slam.allKeyCardsLit ? '四张全亮' : '非全亮'}）`,
      );
      return;
    }

    round.smallScores.A += score.teamScores.A;
    round.smallScores.B += score.teamScores.B;

    const pig = evaluatePigHeads(round.smallScores.A, round.smallScores.B);
    if (pig) {
      round.newPigHeads = { ...pig.newPigHeads };
      round.result = pig;
      message.value = `画猪头！${pig.reason}`;
      logEvent('PIG_HEAD_ASSIGNED', pig.reason);
      return;
    }

    if (round.dealsPlayed >= config.dealLimit) {
      const limitResult = evaluateDealLimit(round.smallScores.A, round.smallScores.B);
      round.newPigHeads = { ...limitResult.newPigHeads };
      round.result = limitResult;
      message.value = limitResult.reason;
      logEvent('PIG_HEAD_ASSIGNED', limitResult.reason);
      return;
    }

    message.value = `${conclusionPrefix}本副结算：A队 ${formatSigned(
      score.teamScores.A,
    )} / B队 ${formatSigned(score.teamScores.B)}，继续下一副`;
  }

  /** 本副结算弹窗点击“下一副 / 进入下一局” */
  function advanceAfterDeal(): void {
    if (phase.value !== 'scoring') return;
    if (round.result) {
      finalizeRound();
      if (match.finished) {
        phase.value = 'matchEnd';
        message.value = `盘结束：${match.reason}`;
        return;
      }
      startRound(round.number + 1);
      return;
    }
    startDeal();
  }

  function finalizeRound(): void {
    const result = round.result;
    if (!result) return;
    match.totalPigHeads.A += result.newPigHeads.A;
    match.totalPigHeads.B += result.newPigHeads.B;

    const record: RoundRecord = {
      roundNumber: round.number,
      isExtra: round.isExtra,
      dealsPlayed: round.dealsPlayed,
      smallScores: { ...round.smallScores },
      newPigHeads: { ...result.newPigHeads },
      winner: result.winner,
      loser: result.loser,
      result: result.result,
      endReason: result.endReason,
      slam: result.slam,
      totalPigHeadsAfter: { ...match.totalPigHeads },
      note: result.reason,
    };
    match.rounds.push(record);

    const outcome = resolveMatch(match.format, match.totalPigHeads, match.rounds);
    match.finished = outcome.finished;
    match.winner = outcome.winner;
    match.reason = outcome.reason;
    round.result = null;

    logEvent(
      'ROUND_COMPLETED',
      `第 ${record.roundNumber} 局结束：${resultText(record.result)}；本局 ${record.dealsPlayed} 副；新增猪头 A ${record.newPigHeads.A} / B ${record.newPigHeads.B}；累计 A ${record.totalPigHeadsAfter.A} / B ${record.totalPigHeadsAfter.B}；${outcome.reason}`,
    );
    if (match.finished) {
      logEvent(
        'MATCH_COMPLETED',
        `盘终：${match.winner === 'A' ? 'A队（南北）胜' : match.winner === 'B' ? 'B队（东西）胜' : '判和'}；${match.reason}`,
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * 亮牌规则热插拔
   * ------------------------------------------------------------------ */

  /** 管理员应用新亮牌规则：校验通过后立即热更新，并刷新当前推荐。 */
  function applyLightRule(input: string | unknown): { ok: boolean; error?: string; version?: string } {
    try {
      const config: LightRuleConfig = activateLightRule(input);
      refreshHumanLightRecommendation();
      logEvent(
        'LIGHT_RULE_UPDATED',
        `亮牌规则已热更新：${config.meta.version}${config.meta.name ? `（${config.meta.name}）` : ''}`,
      );
      message.value = `亮牌规则已热更新至 ${config.meta.version}，后续推荐亮牌立即使用新规则`;
      return { ok: true, version: config.meta.version };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 恢复内置 V1.0 亮牌规则。 */
  function restoreDefaultLightRule(): { ok: boolean; version?: string } {
    const config = resetLightRuleRegistry();
    refreshHumanLightRecommendation();
    logEvent('LIGHT_RULE_UPDATED', `亮牌规则已恢复内置默认：${config.meta.version}`);
    message.value = `亮牌规则已恢复内置默认 ${config.meta.version}`;
    return { ok: true, version: config.meta.version };
  }

  function exportLightRuleJson(): string {
    return serializeLightRule(lightRuleRuntime.config);
  }

  // 规则注册表可在任意时刻被热更新；亮牌阶段尚未提交时自动刷新推荐。
  watch(
    () => lightRuleRuntime.config,
    () => {
      if (phase.value === 'lighting' && deal.value && !deal.value.submitted.S && !isAiSeat('S')) {
        refreshHumanLightRecommendation();
      }
    },
  );

  /* ------------------------------------------------------------------ *
   * 辅助动作
   * ------------------------------------------------------------------ */

  function setAutoPilot(value: boolean): void {
    autoPilot.value = value;
    if (value && phase.value !== 'idle') {
      logEvent('AI_TAKEOVER_STARTED', '南家开启托管，由概率团队策略 AI 接管；AI 与真人使用同一公开信息边界');
    }
    if (phase.value === 'lighting') {
      // 托管状态变化后，取消旧的 AI 亮牌定时器，按新座位归属重新安排
      for (const timer of lightAiTimers) clearTimeout(timer);
      lightAiTimers = [];
      scheduleAiLightSubmissions();
      const current = deal.value;
      if (value && current && !current.submitted.S) {
        submitLight('S', recommendLightsFor('S'));
      }
    }
    if (phase.value === 'playing') {
      startPlayCountdown();
      scheduleAiIfNeeded();
    } else if (!value) {
      clearAiTimer();
      isAiThinking.value = false;
    }
  }

  function requestHint(): void {
    const current = deal.value;
    if (!current || !isHumanTurn.value) return;
    const legal = legalCardsFor('S');
    if (legal.length === 0) return;
    hintCard.value = choosePlay(playObservationFor('S', legal));
  }

  function clearHint(): void {
    hintCard.value = null;
  }

  /** 供界面展示的排序手牌 */
  function sortedHand(pos: Position): number[] {
    return sortHand(visibleHand(pos));
  }

  function collectedCards(pos: Position): number[] {
    return sortHand(deal.value?.collected[pos] ?? []);
  }

  /** 当前墩中每个座位的牌 */
  function trickPlayFor(pos: Position): CardPlay | null {
    return deal.value?.currentTrick.plays.find((play) => play.position === pos) ?? null;
  }

  /** 亮牌阶段/揭晓阶段四张关键牌的状态 */
  const keyCardStates = computed(() => {
    const current = deal.value;
    return KEY_CARDS.map((card) => {
      const lit = current?.litCards.includes(card) ?? false;
      const auto = current?.autoLitCards.includes(card) ?? false;
      // 关键牌打出后已不在任何手牌中，此处只做安全查找，不能抛错。
      const holder = current
        ? ALL_POSITIONS.find((pos) => current.hands[pos].includes(card)) ?? null
        : null;
      return {
        card,
        lit,
        auto,
        holder,
        litBy: current?.litBy[card] ?? null,
      };
    });
  });

  function teamCollectedPoints(team: Team): number {
    return ALL_POSITIONS.filter((pos) => teamOf(pos) === team).reduce(
      (sum, pos) => sum + collectedBasePoints(pos),
      0,
    );
  }

  /** 结算弹窗用：本局当前小分（含本副） */
  const roundSummaryText = computed(() => {
    if (!round.result) return '';
    return `${resultText(round.result.result)} · ${round.result.reason}`;
  });

  /** 主页面与结算弹窗共用的下一步按钮文案 */
  const nextStepLabel = computed(() => {
    if (phase.value !== 'scoring') return '';
    const result = round.result;
    if (!result) return '下一副';

    const record: RoundRecord = {
      roundNumber: round.number,
      isExtra: round.isExtra,
      dealsPlayed: round.dealsPlayed,
      smallScores: { ...round.smallScores },
      newPigHeads: { ...result.newPigHeads },
      winner: result.winner,
      loser: result.loser,
      result: result.result,
      endReason: result.endReason,
      slam: result.slam,
      totalPigHeadsAfter: {
        A: match.totalPigHeads.A + result.newPigHeads.A,
        B: match.totalPigHeads.B + result.newPigHeads.B,
      },
      note: result.reason,
    };
    const outcome = resolveMatch(match.format, record.totalPigHeadsAfter, [
      ...match.rounds,
      record,
    ]);
    return outcome.finished ? '查看盘终结果' : '进入下一局';
  });

  /** 某张牌是否已经离开所有手牌（打出后亮牌区会降亮度显示） */
  function isCardPlayed(card: number): boolean {
    const current = deal.value;
    if (!current) return false;
    return !ALL_POSITIONS.some((pos) => current.hands[pos].includes(card));
  }

  function closeDealResult(): void {
    if (dealResultVisible.value) dealResultDismissed.value = true;
  }

  function openDealResult(): void {
    if (dealResultVisible.value) dealResultDismissed.value = false;
  }

  return {
    // state
    phase,
    config,
    match,
    round,
    deal,
    message,
    isAiThinking,
    settling,
    autoPilot,
    dealProgress,
    countdown,
    lightCountdown,
    humanLightSelection,
    hintCard,
    auditInfo,
    events,
    dealHistory,
    remainingRevealed,
    remainingAwardTo,
    earlyConclusion,
    earlyConclusionText,
    lightRuleRuntime,

    // computed
    humanSubmittedLight,
    canHumanPlay,
    legalCards,
    isHumanTurn,
    lightCountdownVisible,
    playCountdownVisible,
    playCountdownFor,
    dealResultVisible,
    dealResultOpen,
    matchResultVisible,
    roundEnded,
    currentTrick,
    allLit,
    teamScores,
    submittedLitCount,
    submittedSeatCount,
    firstLeadStatus,
    countdownText,
    hintText,
    recommendedCard,
    playRecommendation,
    keyCardStates,
    roundSummaryText,
    nextStepLabel,

    // actions
    startMatch,
    returnToIdle,
    startDeal,
    beginLighting,
    toggleHumanLight,
    submitHumanLight,
    humanPlay,
    advanceAfterDeal,
    closeDealResult,
    openDealResult,
    setAutoPilot,
    requestHint,
    clearHint,
    applyLightRule,
    restoreDefaultLightRule,
    exportLightRuleJson,

    // helpers
    isAiSeat,
    visibleHand,
    sortedHand,
    legalCardsFor,
    seatLitCards,
    seatLightCount,
    collectedBasePoints,
    collectedCards,
    seatStatus,
    trickPlayFor,
    isCardPlayed,
    teamCollectedPoints,
    dealtCount,
    formatSigned,
  };
});

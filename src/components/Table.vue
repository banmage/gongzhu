<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore } from '../store/game';
import { KEY_CARD_NAMES, isKeyCard } from '../models/card';
import { scoreSignClass, seatName, teamOf, teamShort, type Position } from '../models/game';
import Hand from './Hand.vue';
import PlayingCard from './PlayingCard.vue';
import CollectedArea from './CollectedArea.vue';
import LitArea from './LitArea.vue';

const store = useGameStore();

const selectedCard = ref<number | null>(null);

watch(
  [
    () => store.phase,
    () => store.deal?.nextPlayer,
    () => store.deal?.index,
    () => store.settling,
  ],
  () => {
    selectedCard.value = null;
  },
);

const isLighting = computed(() => store.phase === 'lighting');
const isPlaying = computed(() => store.phase === 'playing');
const isRevealing = computed(() => store.phase === 'revealing');
const isDealing = computed(() => store.phase === 'dealing');

/** 手中是否有可亮的牌；没有时系统自动跳过，不再显示提交按钮 */
const humanCanLight = computed(() => (store.deal?.hands.S ?? []).some((card) => isKeyCard(card)));

/** 只在亮牌阶段需要提交时显示底部操作条；出牌完全通过点击牌完成 */
const showActionBar = computed(
  () => isLighting.value && !store.humanSubmittedLight && humanCanLight.value,
);

/** 亮牌读秒只在最后读秒区间、南家尚未提交且手中有可亮牌时显示 */
const showLightCountdown = computed(() => store.lightCountdownVisible);

/** 已经打出的亮牌（不再在任何手牌中）用于半透明展示 */
function playedLit(cards: number[]): number[] {
  return cards.filter((card) => store.isCardPlayed(card));
}

function isActive(pos: Position): boolean {
  if (isLighting.value) return !(store.deal?.submitted[pos] ?? false);
  if (isPlaying.value) return store.deal?.nextPlayer === pos && !store.settling;
  return false;
}

/** 是否轮到该座位出牌（用于显示指向其手牌的闪烁箭头） */
function showTurnArrow(pos: Position): boolean {
  return isPlaying.value && !store.settling && store.deal?.nextPlayer === pos;
}

function isClickable(pos: Position): boolean {
  if (pos !== 'S') return false;
  if (isLighting.value) return !store.humanSubmittedLight;
  return store.canHumanPlay;
}

function legalForSouth(): number[] {
  return store.isHumanTurn ? store.legalCards : [];
}

function onCardClick(pos: Position, card: number): void {
  if (pos !== 'S') return;
  if (isLighting.value) {
    store.toggleHumanLight(card);
    return;
  }
  if (!store.isHumanTurn) return;
  if (!store.legalCards.includes(card)) return;
  selectedCard.value = selectedCard.value === card ? null : card;
}

function playCard(card: number): void {
  if (!store.isHumanTurn) return;
  if (!store.legalCards.includes(card)) return;
  selectedCard.value = null;
  store.humanPlay(card);
}

/** 右键直接出牌；未选中的牌也可以直接右键打出 */
function onCardConfirm(pos: Position, card: number): void {
  if (pos !== 'S' || isLighting.value) return;
  playCard(card);
}

function onCardDoubleClick(pos: Position, card: number): void {
  if (pos !== 'S' || isLighting.value) return;
  playCard(card);
}

/** 亮牌阶段直接展示已提交的亮牌正面；揭晓后展示最终亮牌 */
function visibleLit(pos: Position): number[] {
  const current = store.deal;
  if (!current) return [];
  if (isLighting.value) return current.submissions[pos];
  return store.seatLitCards(pos);
}

/** 该座位被系统自动亮出的关键牌（揭晓前不公开，因此亮牌阶段不标记） */
function seatAutoLit(pos: Position): number[] {
  const current = store.deal;
  if (!current || isLighting.value) return [];
  return current.autoLitCards.filter((card) => current.litBy[card] === pos);
}

const northLit = computed(() => visibleLit('N'));
const eastLit = computed(() => visibleLit('E'));
const westLit = computed(() => visibleLit('W'));
const southLit = computed(() => visibleLit('S'));

/** 南家亮牌区：只显示已经提交/揭晓的亮牌；弹出中的选择仍留在手牌里 */
const southDisplayLit = computed(() => southLit.value);

function seatLightHint(pos: Position): string {
  if (!store.deal?.submitted[pos]) return '';
  return store.deal.submissions[pos].length > 0 ? '已提交' : '已提交 · 不亮';
}

const trickPlays = computed(() => store.deal?.currentTrick.plays ?? []);
const trickWinner = computed(() => store.deal?.currentTrick.winner ?? null);

function playFor(pos: Position) {
  return trickPlays.value.find((play) => play.position === pos) ?? null;
}

function slotClass(pos: Position): string {
  return `slot-${pos}`;
}

const dealIndexText = computed(() => store.deal?.index ?? 1);



const teamScoreText = computed(() => ({
  A: store.formatSigned(store.round.smallScores.A),
  B: store.formatSigned(store.round.smallScores.B),
}));
</script>

<template>
  <div class="table">
    <!-- 北家 -->
    <div class="seat north" :class="{ active: isActive('N') }">
      <div class="seat-profile">
        <span class="seat-name">北N_机器人</span>
        <span class="team-chip a">A队</span>
        <span v-if="isLighting || isDealing" class="seat-status">{{ store.seatStatus('N') }}</span>
      </div>
      <LitArea
        v-if="northLit.length > 0"
        :cards="northLit"
        :played-cards="playedLit(northLit)"
        :auto-cards="seatAutoLit('N')"
      />
      <span v-else-if="isLighting && seatLightHint('N')" class="lit-note">
        {{ seatLightHint('N') }}
      </span>
      <Hand
        :cards="store.visibleHand('N')"
        position="N"
        :face-down="true"
        :active="isActive('N')"
        :clickable="false"
        :show-turn-arrow="showTurnArrow('N')"
      />
      <CollectedArea
        v-if="isPlaying || store.phase === 'scoring'"
        :cards="store.collectedCards('N')"
      />
    </div>

    <!-- 左上角信息 -->
    <aside class="info-panel" aria-label="牌局信息">
      <div class="info-title">
        <span>{{ store.match.format }}局制</span>
        <span class="info-round">
          第 {{ store.round.number }} 局<template v-if="store.round.isExtra">（加赛）</template>
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">本副</span>
        <span class="info-value">
          第 {{ dealIndexText }} 副
          <span class="sub">已打 {{ store.round.dealsPlayed }}/{{ store.config.dealLimit }}</span>
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">小分</span>
        <span class="info-value score-line">
          <span class="team-a">
            A <span :class="scoreSignClass(store.round.smallScores.A)">{{ teamScoreText.A }}</span>
          </span>
          <span class="team-b">
            B <span :class="scoreSignClass(store.round.smallScores.B)">{{ teamScoreText.B }}</span>
          </span>
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">总猪头</span>
        <span class="info-value score-line">
          <span class="team-a">A {{ store.match.totalPigHeads.A }}</span>
          <span class="team-b">B {{ store.match.totalPigHeads.B }}</span>
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">本局新增</span>
        <span class="info-value score-line">
          <span class="team-a">A {{ store.round.newPigHeads.A }}</span>
          <span class="team-b">B {{ store.round.newPigHeads.B }}</span>
        </span>
      </div>
      <div class="info-row first-lead-row">
        <span class="info-label">首轮限制</span>
        <span class="info-value lead-chips">
          <span
            v-for="item in store.firstLeadStatus"
            :key="item.suit"
            class="lead-chip"
            :class="{ led: item.state === 'LED' }"
            :title="item.state === 'LED' ? '该花色首轮限制已解除' : '该花色首次领出时，亮牌不能出'"
          >
            {{ item.label }}{{ item.state === 'LED' ? '✓' : '✕' }}
          </span>
        </span>
      </div>
    </aside>

    <!-- 西家 -->
    <div class="seat west" :class="{ active: isActive('W') }">
      <div class="seat-profile">
        <span class="seat-name">西W_机器人</span>
        <span class="team-chip b">B队</span>
        <span v-if="isLighting || isDealing" class="seat-status">{{ store.seatStatus('W') }}</span>
      </div>
      <LitArea
        v-if="westLit.length > 0"
        :cards="westLit"
        :played-cards="playedLit(westLit)"
        :auto-cards="seatAutoLit('W')"
      />
      <span v-else-if="isLighting && seatLightHint('W')" class="lit-note">
        {{ seatLightHint('W') }}
      </span>
      <Hand
        :cards="store.visibleHand('W')"
        position="W"
        :face-down="true"
        :active="isActive('W')"
        :clickable="false"
        :show-turn-arrow="showTurnArrow('W')"
      />
      <CollectedArea
        v-if="isPlaying || store.phase === 'scoring'"
        :cards="store.collectedCards('W')"
      />
    </div>

    <!-- 右侧信息：只在亮牌阶段显示，避免出牌阶段留下空面板 -->
    <aside v-if="isLighting" class="side-panel" aria-label="亮牌与本副战况">
      <template v-if="isLighting">
        <h4>亮牌提交</h4>
        <div v-for="pos in (['S', 'E', 'N', 'W'] as Position[])" :key="`light-status-${pos}`" class="light-status-row">
          <span class="light-seat">{{ seatName(pos) }}<span class="mini-team">{{ teamShort(teamOf(pos)) }}</span></span>
          <span class="light-state" :class="{ done: store.deal?.submitted[pos] }">
            {{ store.seatStatus(pos) }}
          </span>
        </div>
        <div class="side-note">
          亮牌提交后即在该座位旁正面公开；尚未提交时只显示提交状态。
        </div>
      </template>
    </aside>

    <!-- 中央 -->
    <div class="center">
      <!-- 发牌 -->
      <div v-if="isDealing" class="dealing-center">
        <div class="deck-stack" aria-hidden="true">
          <PlayingCard v-for="i in 10" :key="`deck-${i}`" back size="lg" :style="{ transform: `translate(${i * 1.5}px, ${-i * 2}px)` }" />
        </div>
        <div class="deal-title">发牌中</div>
        <div class="deal-progress">
          <span>{{ store.dealProgress }} / 52</span>
          <div class="progress-track"><i :style="{ width: `${(store.dealProgress / 52) * 100}%` }"></i></div>
        </div>
        <p class="center-note">洗牌种子 #{{ store.deal?.seed }} · 可复现审计</p>
      </div>

      <!-- 亮牌阶段 -->
      <div v-else-if="isLighting" class="lighting-center">
        <div class="phase-kicker">LIGHTING · 亮牌</div>
        <!-- 亮牌阶段也让玩家随时看到两队本局总分（已结算各副累计） -->
        <div class="light-team-scores" aria-label="两队本局总分">
          <div class="lts-item team-a">
            <span class="lts-name">南北队 · A</span>
            <span class="lts-value" :class="scoreSignClass(store.round.smallScores.A)">{{ teamScoreText.A }}</span>
          </div>
          <div class="lts-item team-b">
            <span class="lts-name">东西队 · B</span>
            <span class="lts-value" :class="scoreSignClass(store.round.smallScores.B)">{{ teamScoreText.B }}</span>
          </div>
          <div class="lts-note">
            本局总分 · 已结算 {{ store.round.dealsPlayed }} 副
          </div>
        </div>
        <div class="light-submit-count">已提交 {{ store.submittedSeatCount }}/4 家</div>
        <div v-if="store.config.lightSeconds <= 0" class="light-time-note">本局亮牌不限时</div>
        <div class="light-seat-grid">
          <div
            v-for="pos in (['S', 'E', 'N', 'W'] as Position[])"
            :key="`lseat-${pos}`"
            class="light-seat-card"
            :class="{ done: store.deal?.submitted[pos], me: pos === 'S' }"
          >
            <span class="ls-name">{{ seatName(pos) }}</span>
            <span class="ls-state">{{ store.deal?.submitted[pos] ? '已提交' : (store.isAiSeat(pos) ? '思考中' : '待提交') }}</span>
            <span class="ls-count">
              {{ store.deal?.submitted[pos] ? `亮 ${store.deal?.submissions[pos].length} 张` : '—' }}
            </span>
          </div>
        </div>
      </div>

      <!-- 亮牌揭晓 -->
      <div v-else-if="isRevealing" class="reveal-center">
        <div class="phase-kicker">REVEAL · 亮牌揭晓</div>
        <div class="reveal-grid">
          <div
            v-for="item in store.keyCardStates"
            :key="`reveal-${item.card}`"
            class="reveal-card"
            :class="{ lit: item.lit, auto: item.auto }"
          >
            <PlayingCard :card="item.card" size="lg" :class="{ 'dim-card': !item.lit }" />
            <div class="reveal-name">{{ KEY_CARD_NAMES[item.card] }}</div>
            <div v-if="item.lit" class="reveal-by">
              {{ item.litBy ? `${seatName(item.litBy)}亮` : '已亮' }}
              <span v-if="item.auto" class="tag tag-gold mini">自动亮</span>
            </div>
            <div v-else class="reveal-by muted">未亮</div>
          </div>
        </div>
        <div class="reveal-summary">
          <span v-if="store.deal?.allKeyCardsLit" class="tag tag-gold">四张全亮</span>
          <span v-else class="tag tag-gray">已亮 {{ store.deal?.litCards.length }}/4</span>
          <span class="center-note">亮牌正面已公开，进入出牌阶段</span>
        </div>
      </div>

      <!-- 出牌 -->
      <div v-else class="trick-board">
        <div class="trick-stack">
          <div
            v-for="pos in (['S', 'E', 'N', 'W'] as Position[])"
            :key="`slot-${pos}`"
            class="trick-slot"
            :class="[slotClass(pos), { winner: trickWinner === pos, empty: !playFor(pos) }]"
          >
            <template v-if="playFor(pos)">
              <PlayingCard :card="playFor(pos)!.card" size="xxl" label-mode="suit-first" />
              <span class="play-order">{{ trickPlays.findIndex((p) => p.position === pos) + 1 }}</span>
              <span v-if="playFor(pos)!.auto" class="auto-flag">超时</span>
              <span v-else-if="playFor(pos)!.single" class="auto-flag single-flag">唯一</span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 东家 -->
    <div class="seat east" :class="{ active: isActive('E') }">
      <div class="seat-profile">
        <span class="seat-name">东E_机器人</span>
        <span class="team-chip b">B队</span>
        <span v-if="isLighting || isDealing" class="seat-status">{{ store.seatStatus('E') }}</span>
      </div>
      <LitArea
        v-if="eastLit.length > 0"
        :cards="eastLit"
        :played-cards="playedLit(eastLit)"
        :auto-cards="seatAutoLit('E')"
      />
      <span v-else-if="isLighting && seatLightHint('E')" class="lit-note">
        {{ seatLightHint('E') }}
      </span>
      <Hand
        :cards="store.visibleHand('E')"
        position="E"
        :face-down="true"
        :active="isActive('E')"
        :clickable="false"
        :show-turn-arrow="showTurnArrow('E')"
      />
      <CollectedArea
        v-if="isPlaying || store.phase === 'scoring'"
        :cards="store.collectedCards('E')"
      />
    </div>

    <!-- 南家（你）：左侧已亮牌，中间手牌，右侧已收计分牌 -->
    <div class="south-area">
      <div class="south-side south-left">
        <LitArea
          v-if="southDisplayLit.length > 0"
          :cards="southDisplayLit"
          :played-cards="playedLit(southDisplayLit)"
          :auto-cards="seatAutoLit('S')"
          variant="column"
        />
      </div>

      <div class="south-main">
        <div class="seat south" :class="{ active: isActive('S') }">
          <Hand
            :cards="store.visibleHand('S')"
            position="S"
            :face-down="false"
            :clickable="isClickable('S')"
            :active="isActive('S')"
            :selected-card="selectedCard"
            :legal-cards="legalForSouth()"
            :lit-cards="isLighting || isDealing ? [] : (store.deal?.litCards ?? [])"
            :lit-selection="store.humanLightSelection"
            :lighting-mode="isLighting && !store.humanSubmittedLight"
            :show-turn-arrow="showTurnArrow('S')"
            :recommended-card="store.recommendedCard"
            :countdown="showLightCountdown ? store.lightCountdown : null"
            @card-click="(card) => onCardClick('S', card)"
            @card-confirm="(card) => onCardConfirm('S', card)"
            @card-dblclick="(card) => onCardDoubleClick('S', card)"
          />
        </div>
      </div>

      <div class="south-side south-right">
        <CollectedArea
          v-if="isPlaying || store.phase === 'scoring'"
          :cards="store.collectedCards('S')"
        />
      </div>

      <!-- 操作栏：亮牌阶段确认用；出牌完全通过点击/右键/双击手牌完成 -->
      <div v-if="showActionBar" class="action-bar lighting">
        <span class="action-selected">已选 {{ store.humanLightSelection.length }} 张</span>
        <el-button type="primary" size="small" @click="store.submitHumanLight()">
          {{ store.humanLightSelection.length > 0 ? '亮牌' : '不亮' }}
        </el-button>
      </div>
      <!-- 结算弹窗关闭后，主页面保留“下一副/进入下一局”入口 -->
      <div
        v-else-if="store.phase === 'scoring' && !store.dealResultOpen"
        class="action-bar scoring"
      >
        <span class="action-selected">本副结算完成</span>
        <el-button size="small" @click="store.openDealResult()">查看结算</el-button>
        <el-button type="primary" size="small" @click="store.advanceAfterDeal()">
          {{ store.nextStepLabel }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table {
  --table-pad: 14px;
  /* 与结算页统一：正分红、负分深绿、零分中性色 */
  --score-positive: #c0392b;
  --score-negative: #1d6b45;
  --score-zero: #6b7a70;
  position: relative;
  display: grid;
  grid-template-areas:
    'north north north'
    'west center east'
    'south south south';
  grid-template-columns: minmax(0, 1fr) clamp(300px, 24vw, 360px) minmax(0, 1fr);
  grid-template-rows: auto minmax(300px, 1fr) auto;
  gap: 8px 12px;
  min-height: clamp(650px, calc(100vh - 140px), 980px);
  overflow: hidden;
  background:
    radial-gradient(ellipse at 50% 42%, rgba(72, 167, 112, 0.36), transparent 58%),
    radial-gradient(circle at 50% 12%, #2d8a5d 0%, #1d6d49 42%, #12482f 100%);
  border-radius: 22px;
  padding: var(--table-pad);
  border: 3px solid #0b2f21;
  box-shadow:
    inset 0 0 0 2px rgba(255, 235, 180, 0.12),
    inset 0 0 90px rgba(0, 0, 0, 0.38),
    0 18px 40px rgba(0, 0, 0, 0.36);
}
.table::before {
  content: '';
  position: absolute;
  inset: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50% / 42%;
  pointer-events: none;
}
.seat,
.center {
  position: relative;
  z-index: 1;
}
.seat.active {
  z-index: 2;
}
.north {
  grid-area: north;
  justify-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.west {
  grid-area: west;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.east {
  grid-area: east;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
/* 西/东家的座位条放在手牌下方，避免被左上/右上信息面板遮住 */
.west .seat-profile,
.east .seat-profile {
  order: 3;
  margin-top: 2px;
}
.south-area {
  grid-area: south;
  display: grid;
  /* 三列都按内容宽度排布并整体居中：亮牌/收牌紧贴手牌两侧，
     不会因为中间被 1fr 撑开而跑到牌桌最边缘 */
  grid-template-columns: auto auto auto;
  grid-template-areas:
    'lit hand collected'
    '. actions .';
  align-items: center;
  justify-content: center;
  gap: 6px 12px;
  width: 100%;
  min-width: 0;
}
.south-side {
  display: flex;
  min-width: 0;
}
.south-left {
  grid-area: lit;
}
.south-right {
  grid-area: collected;
}
.south-main {
  grid-area: hand;
  justify-self: center;
  min-width: 0;
}
.south-main .seat,
.south-main .hand {
  max-width: 100%;
}
.south {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.south-area .action-bar {
  grid-area: actions;
  justify-self: center;
  width: auto;
  min-width: 0;
}
.seat-profile {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px;
  color: #eaf5ee;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.seat-name {
  color: inherit;
}
.team-chip {
  border-radius: 4px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 800;
  text-shadow: none;
}
.team-chip.a {
  background: #2f7d57;
  color: #f0fff6;
}
.team-chip.b {
  background: #8c5a2b;
  color: #fff7ea;
}
.seat-status {
  color: rgba(234, 245, 238, 0.8);
  font-size: 11px;
  font-weight: 600;
}
.seat.active .seat-profile {
  color: #ffe19a;
  text-shadow:
    0 0 10px rgba(255, 214, 102, 0.7),
    0 1px 3px rgba(0, 0, 0, 0.85);
}
.lit-note {
  color: rgba(234, 245, 238, 0.75);
  font-size: 11px;
}
.tag.mini {
  padding: 0 3px;
  font-size: 9px;
}

/* 信息面板 */
.info-panel,
.side-panel {
  position: absolute;
  top: calc(var(--table-pad) + 18px);
  z-index: 3;
  box-sizing: border-box;
  width: clamp(230px, 23%, 330px);
}
.info-panel {
  left: var(--table-pad);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 11px;
  border-radius: 5px;
  border: 1px solid rgba(80, 66, 26, 0.55);
  background: linear-gradient(180deg, rgba(255, 252, 232, 0.97), rgba(242, 232, 196, 0.96));
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
  color: #2f2a1a;
  font-size: 12px;
  line-height: 1.45;
}
.info-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 1px;
  padding-bottom: 3px;
  border-bottom: 1px solid rgba(107, 94, 51, 0.25);
  color: #5a4c20;
  font-size: 12px;
  font-weight: 800;
}
.info-round {
  color: #8a5a00;
}
.info-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.info-label {
  flex: none;
  width: 66px;
  color: #6b5e33;
  font-weight: 600;
}
.info-label::after {
  content: '：';
}
.info-value {
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
}
.info-value .sub {
  color: #8a7b4a;
  font-size: 11px;
  font-weight: 600;
}
.score-line {
  display: flex;
  gap: 10px;
}
.team-a {
  color: #1d6b45;
}
.team-b {
  color: #8a4b1d;
}
.lead-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  overflow: visible;
}
.lead-chip {
  border-radius: 4px;
  padding: 0 4px;
  background: rgba(184, 50, 50, 0.13);
  color: #a33a2a;
  font-size: 10px;
  font-weight: 700;
}
.lead-chip.led {
  background: rgba(47, 125, 87, 0.14);
  color: #2f7d57;
}

/* 右侧面板 */
.side-panel {
  right: var(--table-pad);
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 11px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: linear-gradient(180deg, rgba(7, 38, 25, 0.88), rgba(4, 24, 16, 0.82));
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.32);
  color: #eaf5ee;
  font-size: 11px;
  line-height: 1.45;
}
.side-panel h4 {
  margin: 0 0 1px;
  color: #ffe19a;
  font-size: 12px;
  letter-spacing: 0.04em;
}
.side-sub-title {
  margin-top: 4px !important;
}
.light-status-row,
.collect-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 0;
}
.light-seat,
.collect-seat {
  flex: 1;
  font-weight: 700;
}
.mini-team {
  margin-left: 3px;
  color: rgba(234, 245, 238, 0.55);
  font-size: 9px;
}
.light-state {
  color: rgba(234, 245, 238, 0.55);
  font-size: 11px;
}
.light-state.done {
  color: #9ef0bd;
}
.side-note {
  margin-top: 4px;
  padding-top: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(234, 245, 238, 0.72);
  font-size: 11px;
  line-height: 1.55;
}
.side-note strong {
  color: #ffe19a;
}
.hint-note {
  color: #9ef0bd;
}
.key-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px 8px;
}
.key-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.key-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  white-space: nowrap;
}
.key-state {
  flex: none;
  color: rgba(234, 245, 238, 0.55);
  font-size: 10px;
}
.key-state.lit {
  color: #ffe19a;
}
.dim-card {
  opacity: 0.35;
  filter: grayscale(0.6);
}
.collect-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px 10px;
}
.collect-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 0;
}
.collect-seat {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  white-space: nowrap;
}
.collect-points {
  flex: none;
  min-width: 30px;
  text-align: right;
  color: var(--score-positive);
  font-weight: 800;
}
.collect-points.score-neg {
  color: var(--score-negative);
}
.collect-points.score-zero {
  color: var(--score-zero);
}
.collect-count {
  flex: none;
  color: rgba(234, 245, 238, 0.5);
  font-size: 10px;
}

/* 中央区域 */
.center {
  grid-area: center;
  justify-self: center;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  max-width: 380px;
  min-height: 0;
}
.phase-kicker {
  color: rgba(255, 225, 154, 0.75);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
}
.center-note {
  margin: 0;
  color: rgba(234, 245, 238, 0.65);
  font-size: 11px;
  text-align: center;
}

/* 发牌 */
.dealing-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.deck-stack {
  position: relative;
  width: 96px;
  height: 134px;
  margin-bottom: 6px;
}
.deck-stack :deep(.playing-card) {
  position: absolute;
  inset: 0;
}
.deal-title {
  color: #ffe19a;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.deal-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  color: #eaf5ee;
  font-size: 12px;
  font-weight: 700;
}
.progress-track {
  width: 180px;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
}
.progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #9ef0bd, #ffd666);
  transition: width 0.08s linear;
}

/* 亮牌阶段 */
.lighting-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.big-countdown {
  color: #ffe19a;
  font-size: 58px;
  font-weight: 800;
  line-height: 1;
  text-shadow: 0 0 22px rgba(255, 214, 102, 0.55);
}
.big-countdown span {
  font-size: 22px;
  margin-left: 2px;
}
.light-team-scores {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  width: 100%;
  max-width: 300px;
}
.lts-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.42);
  /* 浅色底让深绿/深红分值保持与结算页一致的清晰度 */
  background: rgba(247, 247, 242, 0.94);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
.lts-item.team-a {
  border-top: 2px solid #6fd39c;
}
.lts-item.team-b {
  border-top: 2px solid #e0ad63;
}
.lts-name {
  color: #5c6c62;
  font-size: 10px;
  font-weight: 700;
}
.lts-value {
  font-size: 20px;
  font-weight: 900;
  line-height: 1.05;
}
.lts-note {
  grid-column: 1 / -1;
  color: rgba(234, 245, 238, 0.55);
  font-size: 10px;
  text-align: center;
}
.light-submit-count {
  color: #eaf5ee;
  font-size: 13px;
  font-weight: 700;
}
.light-time-note {
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(255, 214, 102, 0.16);
  border: 1px solid rgba(255, 214, 102, 0.4);
  color: #ffe19a;
  font-size: 11px;
  font-weight: 700;
}
.light-seat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  width: 100%;
  max-width: 300px;
}
.light-seat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 7px 6px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.2);
  color: #eaf5ee;
}
.light-seat-card.done {
  border-color: rgba(158, 240, 189, 0.55);
  background: rgba(47, 125, 87, 0.32);
}
.light-seat-card.me {
  box-shadow: inset 0 0 0 1px rgba(255, 214, 102, 0.45);
}
.ls-name {
  font-size: 13px;
  font-weight: 800;
}
.ls-state {
  color: rgba(234, 245, 238, 0.7);
  font-size: 10px;
}
.ls-count {
  color: #ffe19a;
  font-size: 10px;
  font-weight: 700;
}

/* 揭晓 */
.reveal-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.reveal-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}
.reveal-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.12);
  animation: reveal-pop 0.35s ease-out both;
}
.reveal-card.lit {
  border-color: rgba(255, 214, 102, 0.7);
  background: rgba(217, 163, 0, 0.16);
  box-shadow: 0 0 16px rgba(255, 214, 102, 0.18);
}
.reveal-card.auto {
  animation: reveal-pop 0.35s ease-out both, auto-glow 1.1s ease-in-out infinite alternate;
}
@keyframes reveal-pop {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes auto-glow {
  from {
    box-shadow: 0 0 10px rgba(255, 214, 102, 0.15);
  }
  to {
    box-shadow: 0 0 22px rgba(255, 214, 102, 0.55);
  }
}
.reveal-name {
  color: #ffe19a;
  font-size: 11px;
  font-weight: 800;
}
.reveal-by {
  color: #9ef0bd;
  font-size: 10px;
  font-weight: 700;
}
.reveal-by.muted {
  color: rgba(234, 245, 238, 0.45);
}
.reveal-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

/* 出牌区 */
.trick-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.trick-stack {
  position: relative;
  width: 280px;
  height: 280px;
}
.trick-slot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 108px;
  height: 151px;
  line-height: 0;
  transform: translate(-50%, -50%);
}
/* 中央出牌与手牌同步放大，四家牌面更容易区分 */
.trick-slot :deep(.playing-card) {
  --pc-label-size: 23px;
  --pc-corner-size: 19px;
  --pc-pip-size: 24px;
  --pc-court-size: 58px;
  --pc-back-spade-size: 38px;
  width: 108px;
  height: 151px;
}
.trick-slot.slot-W {
  transform: translate(calc(-50% - 74px), -50%);
}
.trick-slot.slot-E {
  transform: translate(calc(-50% + 74px), -50%);
}
.trick-slot.slot-N {
  transform: translate(-50%, calc(-50% - 56px));
}
.trick-slot.slot-S {
  transform: translate(-50%, calc(-50% + 56px));
}
.trick-slot.winner :deep(.playing-card) {
  outline: 3px solid #ffe19a;
  outline-offset: 2px;
  box-shadow: 0 0 18px rgba(255, 214, 102, 0.55);
}
.slot-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.22);
  color: rgba(234, 245, 238, 0.45);
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
}
.play-order {
  position: absolute;
  z-index: 2;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 999px;
  background: #ffe19a;
  color: #2c2200;
  font-size: 10px;
  font-weight: 800;
  line-height: 15px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
.slot-W .play-order {
  bottom: -6px;
  left: -6px;
}
.slot-E .play-order {
  top: -6px;
  right: -6px;
}
.slot-N .play-order {
  top: -6px;
  right: -6px;
}
.slot-S .play-order {
  bottom: -6px;
  left: -6px;
}
.auto-flag {
  position: absolute;
  top: -8px;
  left: -8px;
  z-index: 2;
  padding: 0 4px;
  border-radius: 3px;
  background: #b83232;
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  line-height: 15px;
}
.single-flag {
  background: #2f6f9f;
}
.trick-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 20px;
}
.trick-points {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.3);
  color: var(--score-positive);
  font-size: 11px;
  font-weight: 800;
}
.trick-points.score-neg {
  color: var(--score-negative);
}
.trick-points.score-zero {
  color: var(--score-zero);
}
.trick-winner-text {
  color: rgba(234, 245, 238, 0.8);
  font-size: 11px;
}

/* 操作栏 */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  width: min(100%, 980px);
  min-height: 42px;
  padding: 7px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: linear-gradient(180deg, rgba(6, 32, 21, 0.72), rgba(4, 24, 16, 0.55));
  color: #eaf5ee;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
}
.action-bar.my-turn {
  border-color: rgba(255, 214, 102, 0.6);
  box-shadow: 0 0 18px rgba(255, 214, 102, 0.22);
}
.action-bar.lighting {
  border-color: rgba(255, 214, 102, 0.35);
}
.action-title {
  color: #ffe19a;
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
}
.action-hint {
  color: rgba(234, 245, 238, 0.72);
  font-size: 11px;
  line-height: 1.4;
}
.action-selected {
  color: #9ef0bd;
  font-size: 12px;
  font-weight: 700;
}
.action-fallback {
  padding: 1px 7px;
  border-radius: 4px;
  background: rgba(184, 50, 50, 0.3);
  border: 1px solid rgba(255, 138, 122, 0.5);
  color: #ffb3a8;
  font-size: 11px;
  font-weight: 700;
}
.action-timer {
  min-width: 36px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.28);
  color: #ffe19a;
  font-size: 12px;
  font-weight: 800;
  text-align: center;
}
.thinking-dots {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}
.thinking-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffe19a;
  animation: dot-bounce 0.9s ease-in-out infinite;
}
.thinking-dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.thinking-dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes dot-bounce {
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

/* 发牌入场动画：牌从中央飞向座位 */
.seat :deep(.playing-card) {
  animation: deal-in 0.2s ease-out both;
}
.north :deep(.playing-card) {
  --deal-from: translateY(60px);
}
.south :deep(.playing-card) {
  --deal-from: translateY(-60px);
}
.west :deep(.playing-card) {
  --deal-from: translateX(70px);
}
.east :deep(.playing-card) {
  --deal-from: translateX(-70px);
}
@keyframes deal-in {
  from {
    opacity: 0;
    transform: var(--deal-from, translateY(20px)) scale(0.94);
  }
  to {
    opacity: 1;
    transform: translate(0, 0) scale(1);
  }
}

@media (max-width: 900px) {
  .table {
    --table-pad: 10px;
    grid-template-columns: minmax(0, 1fr) 300px minmax(0, 1fr);
    grid-template-rows: auto minmax(300px, 1fr) auto;
    min-height: 640px;
    padding: var(--table-pad);
    gap: 6px;
  }
  .center {
    max-width: 320px;
  }
  .info-panel,
  .side-panel {
    width: clamp(190px, 22%, 250px);
    font-size: 12px;
  }
}

@media (max-width: 880px) {
  .table {
    grid-template-areas:
      'north'
      'west'
      'center'
      'east'
      'south';
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    min-height: 0;
    border-radius: 16px;
  }
  .west,
  .east {
    align-self: auto;
    align-items: center;
  }
  .center {
    width: min(100%, 340px);
    max-width: 340px;
  }
  .info-panel,
  .side-panel {
    display: none;
  }
  .trick-stack {
    width: 250px;
    height: 250px;
  }
  .action-bar {
    width: 100%;
  }
}

/* 矮屏（常见 1280×800 / 1024×768 笔记本）：整体收紧，保证操作栏无需滚动即可见 */
@media (max-height: 860px) and (min-width: 881px) {
  .table {
    --table-pad: 10px;
    grid-template-rows: auto minmax(220px, 1fr) auto;
    gap: 4px 10px;
  }
  .seat-profile {
    font-size: 12px;
  }
  .trick-stack {
    width: 236px;
    height: 236px;
  }
  .trick-slot {
    width: 92px;
    height: 129px;
  }
  .trick-slot :deep(.playing-card) {
    --pc-label-size: 20px;
    --pc-corner-size: 15px;
    --pc-pip-size: 20px;
    --pc-court-size: 48px;
    --pc-back-spade-size: 31px;
    width: 92px;
    height: 129px;
  }
  .trick-slot.slot-W {
    transform: translate(calc(-50% - 62px), -50%);
  }
  .trick-slot.slot-E {
    transform: translate(calc(-50% + 62px), -50%);
  }
  .trick-slot.slot-N {
    transform: translate(-50%, calc(-50% - 48px));
  }
  .trick-slot.slot-S {
    transform: translate(-50%, calc(-50% + 48px));
  }
  .action-bar {
    min-height: 38px;
    padding: 4px 12px;
  }
  .action-title {
    font-size: 13px;
  }
  .big-countdown {
    font-size: 44px;
  }
  .big-countdown span {
    font-size: 18px;
  }
  .light-seat-grid {
    max-width: 260px;
  }
  .light-seat-card {
    padding: 4px 5px;
  }
}


</style>

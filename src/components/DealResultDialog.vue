<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../store/game';
import { HEART_A, KEY_CARD_NAMES, KEY_CARD_SHORT, KEY_CARDS, PIG, SHEEP, TRANSFORMER, getSuit, isScoringCard } from '../models/card';
import {
  ALL_POSITIONS,
  endReasonText,
  formatSigned,
  otherTeam,
  resultText,
  scoreSignClass,
  seatName,
  teamName,
  teamOf,
  teamShort,
  type Position,
  type RoundRecord,
  type Team,
} from '../models/game';
import { collectedSummary } from '../core/scoring';
import { resolveMatch } from '../core/rules';
import Hand from './Hand.vue';
import PlayingCard from './PlayingCard.vue';

const store = useGameStore();

const positions: Position[] = ALL_POSITIONS;

const score = computed(() => store.deal?.score ?? null);
const result = computed(() => store.round.result);

const TEAMS: Team[] = ['A', 'B'];
/** 每队两名选手：A队=南、北；B队=东、西 */
const TEAM_POSITIONS: Record<Team, Position[]> = { A: ['S', 'N'], B: ['E', 'W'] };

function teamPositions(team: Team): Position[] {
  return TEAM_POSITIONS[team];
}
function teamRoundScore(team: Team): number {
  // 本局小分在 endDeal 结算时已累加本副，直接取用即为“含本副”的累积值
  return store.round.smallScores[team];
}
function teamDealScore(team: Team): number {
  // 与栏内展示的两名选手本副得分保持一致，避免展示值与总和出现偏差
  return teamPositions(team).reduce(
    (sum, pos) => sum + (score.value?.breakdowns[pos].final ?? 0),
    0,
  );
}

/** 本副四张关键牌的亮牌状态：结算页用牌面 + 亮牌者醒目展示 */
function isLit(card: number): boolean {
  return score.value?.litCards.includes(card) ?? false;
}
function isAutoLit(card: number): boolean {
  return score.value?.autoLitCards.includes(card) ?? false;
}
function litSeat(card: number): string {
  const pos = score.value?.litBy[card];
  return pos ? seatName(pos) : '';
}
const litCount = computed(() => score.value?.litCards.length ?? 0);

const slamSeat = computed(() => (score.value?.slam.position ? seatName(score.value.slam.position) : ''));
const slamTeam = computed(() => (score.value?.slam.team ? teamName(score.value.slam.team) : ''));
const slamOpponent = computed(() => (score.value?.slam.team ? teamName(otherTeam(score.value.slam.team)) : ''));

const nextPreview = computed(() => {
  if (!result.value) return null;
  const record: RoundRecord = {
    roundNumber: store.round.number,
    isExtra: store.round.isExtra,
    dealsPlayed: store.round.dealsPlayed,
    smallScores: { ...store.round.smallScores },
    newPigHeads: { ...result.value.newPigHeads },
    winner: result.value.winner,
    loser: result.value.loser,
    result: result.value.result,
    endReason: result.value.endReason,
    slam: result.value.slam,
    totalPigHeadsAfter: {
      A: store.match.totalPigHeads.A + result.value.newPigHeads.A,
      B: store.match.totalPigHeads.B + result.value.newPigHeads.B,
    },
    note: result.value.reason,
  };
  const rounds = [...store.match.rounds, record];
  const totals = {
    A: store.match.totalPigHeads.A + result.value.newPigHeads.A,
    B: store.match.totalPigHeads.B + result.value.newPigHeads.B,
  };
  return resolveMatch(store.match.format, totals, rounds);
});

function isPigRow(pos: Position): boolean {
  return score.value?.breakdowns[pos].collected.includes(PIG) ?? false;
}
function isSheepRow(pos: Position): boolean {
  return score.value?.breakdowns[pos].collected.includes(SHEEP) ?? false;
}
/** 明细里展示“累计后”的分数，而不是单次调整量：亮猪 -200、窝猪 -400 */
function pigLitScore(pos: Position): number {
  const breakdown = score.value?.breakdowns[pos];
  return breakdown ? breakdown.pigBase + breakdown.pigLitAdj : 0;
}
function pigOwnScore(pos: Position): number {
  const breakdown = score.value?.breakdowns[pos];
  return breakdown ? breakdown.pigBase + breakdown.pigLitAdj + breakdown.ownPigAdj : 0;
}
function sheepLitScore(pos: Position): number {
  const breakdown = score.value?.breakdowns[pos];
  return breakdown ? breakdown.sheepBase + breakdown.sheepLitAdj : 0;
}
function isTransformerRow(pos: Position): boolean {
  return score.value?.breakdowns[pos].hasTransformer ?? false;
}
/** 变压器明细直接展示“修正后总分 × 倍数 = 最终分”，不再单列“变压器之前”的小计 */
function transformerDetail(pos: Position): string {
  const breakdown = score.value?.breakdowns[pos];
  if (!breakdown) return '';
  if (breakdown.transformerSolo) return `独拿 ${formatSigned(breakdown.final)}`;
  const multiplier = breakdown.transformerLit ? 4 : 2;
  return `${formatSigned(breakdown.subtotal)} × ${multiplier} = ${formatSigned(breakdown.final)}`;
}
function hasHearts(pos: Position): boolean {
  return score.value?.breakdowns[pos].collected.some((card) => getSuit(card) === 2) ?? false;
}

function collectedCards(pos: Position): number[] {
  // 结算页只展示参与计分的牌（猪、羊、变压器、红桃），隐藏无关垫牌
  return store.collectedCards(pos).filter(isScoringCard);
}

function summary(pos: Position) {
  return collectedSummary(store.deal?.collected[pos] ?? []);
}

function resultClass(): string {
  if (!result.value) return '';
  return result.value.result === 'DRAW' ? 'draw' : 'decisive';
}
</script>

<template>
  <el-dialog
    :model-value="store.dealResultOpen"
    :show-close="true"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    width="min(980px, 94vw)"
    align-center
    class="deal-result-dialog"
    title=""
    @close="store.closeDealResult()"
  >
    <template #header>
      <div class="dr-header">
        <div>
          <div class="dr-kicker">DEAL RESULT</div>
          <h2>
            第 {{ store.round.number }} 局 · 第 {{ store.deal?.index ?? 1 }} 副结算
            <span v-if="store.round.isExtra" class="tag tag-gold">加赛</span>
          </h2>
        </div>
        <div class="dr-team-scores">
          <div class="dr-team a">
            <span class="dr-team-name">A队 · 南北 · 本局总分（含本副）</span>
            <span class="dr-team-score" :class="scoreSignClass(teamRoundScore('A'))">
              {{ formatSigned(teamRoundScore('A')) }}
            </span>
            <span class="dr-team-delta">
              本副
              <span :class="scoreSignClass(teamDealScore('A'))">{{ formatSigned(teamDealScore('A')) }}</span>
            </span>
          </div>
          <div class="dr-team b">
            <span class="dr-team-name">B队 · 东西 · 本局总分（含本副）</span>
            <span class="dr-team-score" :class="scoreSignClass(teamRoundScore('B'))">
              {{ formatSigned(teamRoundScore('B')) }}
            </span>
            <span class="dr-team-delta">
              本副
              <span :class="scoreSignClass(teamDealScore('B'))">{{ formatSigned(teamDealScore('B')) }}</span>
            </span>
          </div>
        </div>
      </div>
    </template>

    <div v-if="score" class="dr-body">
      <!-- 满贯 -->
      <div v-if="score.slam.triggered" class="slam-banner">
        <div class="slam-icon">满</div>
        <div class="slam-text">
          <strong>满贯！{{ slamSeat }}集齐猪、羊、变压器与全部 13 张红桃</strong>
          <span>
            {{ slamTeam }}立即赢下本局；该副
            {{ score.slam.allKeyCardsLit ? '四张全亮' : '非全亮' }}，
            {{ slamOpponent }}被画 {{ score.slam.pigHeads }} 头。
            本副不生成正式个人分，下方为模拟展示分。
          </span>
        </div>
        <span class="tag tag-gold">非正式展示分</span>
      </div>

      <div v-else-if="!score.official" class="slam-banner">
        <div class="slam-icon">满</div>
        <div class="slam-text"><strong>满贯触发</strong><span>本副普通分不参与小分累计。</span></div>
      </div>

      <!-- 提前结束：说明为何未打满 13 墩 -->
      <div v-if="store.earlyConclusionText" class="early-banner">
        <div class="early-icon">止</div>
        <div class="early-text">
          <strong>本副提前结束</strong>
          <span>{{ store.earlyConclusionText }}</span>
        </div>
      </div>

      <!-- 本副亮牌：醒目展示四张关键牌谁亮/未亮 -->
      <div class="dr-section-title">
        本副亮牌
        <span class="dl-count">{{ litCount }}/4</span>
        <span v-if="score.slam.allKeyCardsLit" class="tag tag-gold mini">全亮</span>
      </div>
      <div class="deal-lights">
        <div
          v-for="card in KEY_CARDS"
          :key="`dl-${card}`"
          class="dl-item"
          :class="{ lit: isLit(card), auto: isAutoLit(card) }"
        >
          <PlayingCard :card="card" size="md" />
          <div class="dl-meta">
            <span class="dl-name">{{ KEY_CARD_SHORT[card] }} · {{ KEY_CARD_NAMES[card] }}</span>
            <span v-if="isLit(card)" class="dl-seat">{{ litSeat(card) }} 亮</span>
            <span v-else class="dl-unlit">未亮</span>
            <span v-if="card === HEART_A && isLit(card)" class="dl-effect">全场红桃 ×2</span>
            <span v-if="isAutoLit(card)" class="dl-auto">自动</span>
          </div>
        </div>
      </div>

      <!-- 南北队（左栏） / 东西队（右栏）分数：只保留座位与本副分数 -->
      <div class="dr-section-title">本副各选手得分</div>
      <div class="team-summary">
        <div
          v-for="team in TEAMS"
          :key="`ts-${team}`"
          class="ts-col"
          :class="`team-${team.toLowerCase()}`"
        >
          <div class="ts-head">
            <span class="ts-team">{{ teamName(team) }}</span>
            <span class="tag" :class="team === 'A' ? 'tag-green' : 'tag-gold'">{{ teamShort(team) }}</span>
          </div>

          <div v-for="pos in teamPositions(team)" :key="`ts-${team}-${pos}`" class="ts-row">
            <span class="ts-label">{{ seatName(pos) }}</span>
            <span class="ts-value" :class="scoreSignClass(score.breakdowns[pos].final)">
              {{ formatSigned(score.breakdowns[pos].final) }}
            </span>
          </div>
        </div>
      </div>

      <!-- 四人计分明细：南北队左栏、东西队右栏 -->
      <div class="dr-section-title">个人计分明细（红桃 / 羊 / 猪 / 变压器）</div>
      <div class="bd-grid">
        <div
          v-for="team in TEAMS"
          :key="`bd-col-${team}`"
          class="bd-col"
          :class="`team-${team.toLowerCase()}`"
        >
          <div class="bd-col-head">
            <span class="bd-col-team">{{ teamName(team) }}计分明细</span>
            <span class="bd-col-score" :class="scoreSignClass(teamDealScore(team))">
              {{ formatSigned(teamDealScore(team)) }}
            </span>
          </div>

          <div
            v-for="pos in teamPositions(team)"
            :key="`bd-${pos}`"
            class="bd-card"
            :class="`team-${teamOf(pos).toLowerCase()}`"
          >
            <div class="bd-head">
              <div>
                <span class="bd-seat">{{ seatName(pos) }}</span>
                <span class="tag" :class="teamOf(pos) === 'A' ? 'tag-green' : 'tag-gold'">{{ teamShort(teamOf(pos)) }}</span>
              </div>
              <span class="bd-final" :class="scoreSignClass(score.breakdowns[pos].final)">
                {{ formatSigned(score.breakdowns[pos].final) }}
              </span>
            </div>

            <div class="bd-tags">
              <span v-if="summary(pos).pig" class="tag tag-red">猪</span>
              <span v-if="summary(pos).sheep" class="tag tag-gold">羊</span>
              <span v-if="summary(pos).transformer" class="tag tag-dark">变压器</span>
              <span v-if="summary(pos).hearts > 0" class="tag tag-gray">红桃 {{ summary(pos).hearts }}</span>
              <span v-if="summary(pos).allRed" class="tag tag-gold">全红</span>
              <span v-if="score.breakdowns[pos].ownPigExempt" class="tag tag-green">免窝猪</span>
              <span v-if="score.breakdowns[pos].transformerSolo" class="tag tag-green">独拿变压器</span>
            </div>

            <div class="bd-rows">
              <div v-if="hasHearts(pos)" class="bd-row">
                <span class="bd-label">红桃</span>
                <span class="bd-detail">
                  {{ score.breakdowns[pos].heartsBase }}
                  <template v-if="score.breakdowns[pos].heartALit"> · 亮♥A 全场×2</template>
                  <template v-if="score.breakdowns[pos].allRed"> · 全红反转</template>
                </span>
                <span class="bd-value" :class="scoreSignClass(score.breakdowns[pos].heartsTotal)">
                  {{ score.breakdowns[pos].heartsTotal }}
                </span>
              </div>
              <div v-if="isSheepRow(pos)" class="bd-row">
                <span class="bd-label">羊</span>
                <span class="bd-detail">
                  {{ score.breakdowns[pos].sheepBase }}
                  <template v-if="score.breakdowns[pos].sheepLitAdj"> 亮羊 {{ formatSigned(sheepLitScore(pos)) }}</template>
                </span>
                <span class="bd-value" :class="scoreSignClass(score.breakdowns[pos].sheepTotal)">
                  {{ score.breakdowns[pos].sheepTotal }}
                </span>
              </div>
              <div v-if="isPigRow(pos)" class="bd-row">
                <span class="bd-label">猪</span>
                <span class="bd-detail">
                  {{ score.breakdowns[pos].pigBase }}
                  <template v-if="score.breakdowns[pos].pigLitAdj"> 亮猪 {{ formatSigned(pigLitScore(pos)) }}</template>
                  <template v-if="score.breakdowns[pos].ownPigAdj"> 窝猪 {{ formatSigned(pigOwnScore(pos)) }}</template>
                </span>
                <span class="bd-value" :class="scoreSignClass(score.breakdowns[pos].pigTotal)">
                  {{ score.breakdowns[pos].pigTotal }}
                </span>
              </div>
              <div v-if="isTransformerRow(pos)" class="bd-row transformer-row">
                <span class="bd-label">变压器</span>
                <span class="bd-detail">{{ transformerDetail(pos) }}</span>
                <span class="bd-value" :class="scoreSignClass(score.breakdowns[pos].transformerAdj)">
                  {{ formatSigned(score.breakdowns[pos].transformerAdj) }}
                </span>
              </div>
            </div>

            <div class="bd-collected">
              <Hand :cards="collectedCards(pos)" :position="pos" compact />
            </div>

            <ul v-if="score.breakdowns[pos].notes.length" class="bd-notes">
              <li v-for="(note, index) in score.breakdowns[pos].notes" :key="index">{{ note }}</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- 本局小分 / 猪头 -->
      <div class="score-strip">
        <div class="strip-item">
          <span class="strip-label">本局已打副数</span>
          <span class="strip-value">{{ store.round.dealsPlayed }} / {{ store.config.dealLimit }}</span>
        </div>
        <div class="strip-item">
          <span class="strip-label">亮牌</span>
          <span class="strip-value">
            {{ score.litCards.length }}/4
            <span v-if="score.slam.allKeyCardsLit" class="tag tag-gold mini">全亮</span>
            <span v-if="score.autoLitCards.length" class="tag tag-gray mini">含自动亮</span>
          </span>
        </div>
      </div>

      <!-- 本局结束 / 画猪头 -->
      <div v-if="result" class="round-banner" :class="resultClass()">
        <div class="rb-head">
          <span class="rb-title">本局结束 · {{ resultText(result.result) }}</span>
          <span class="tag tag-dark">{{ endReasonText(result.endReason) }}</span>
        </div>
        <div class="rb-heads">
          <span>A队 新增猪头 <strong>+{{ result.newPigHeads.A }}</strong></span>
          <span>B队 新增猪头 <strong>+{{ result.newPigHeads.B }}</strong></span>
          <span class="rb-total">
            结算后总猪头 A {{ store.match.totalPigHeads.A + result.newPigHeads.A }} / B
            {{ store.match.totalPigHeads.B + result.newPigHeads.B }}
          </span>
        </div>
        <p class="rb-reason">{{ result.reason }}</p>
        <p v-if="nextPreview?.finished" class="rb-outcome">
          盘终：{{ nextPreview.winner === 'A' ? 'A队（南北）获胜' : nextPreview.winner === 'B' ? 'B队（东西）获胜' : '双方判和' }}
          · {{ nextPreview.reason }}
        </p>
      </div>

      <div v-else class="continue-note">
        本副未触发画猪头，继续下一副；下一副由本副拿到 ♠Q 的玩家领出。
        <span v-if="store.deal?.pigCollector">（{{ seatName(store.deal.pigCollector) }}拿到猪）</span>
      </div>
    </div>

    <template #footer>
      <div class="dr-footer">
        <span class="dr-footer-note">
          <template v-if="result">本局结束，小分清零后进入下一局。</template>
          <template v-else>小分继续累计；下一副领出权归拿到 ♠Q 的玩家。</template>
        </span>
        <div class="dr-footer-actions">
          <el-button @click="store.closeDealResult()">关闭</el-button>
          <el-button type="primary" size="large" @click="store.advanceAfterDeal()">
            {{ store.nextStepLabel || '下一副' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.dr-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-right: 8px;
}
.dr-kicker {
  color: #8a7b4a;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
}
.dr-header h2 {
  margin: 2px 0 0;
  color: #23382c;
  font-size: 20px;
}
.dr-team-scores {
  display: flex;
  gap: 10px;
}
.dr-team {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 96px;
  padding: 5px 12px;
  border-radius: 8px;
  background: #f1f4ee;
  border: 1px solid #d9e2d6;
}
.dr-team.a {
  border-left: 4px solid #2f7d57;
}
.dr-team.b {
  border-left: 4px solid #b57a2a;
}
.dr-team-name {
  color: #6b7a70;
  font-size: 10px;
  font-weight: 700;
}
.dr-team-score {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.1;
}
.dr-team-delta {
  margin-top: 8px;
  color: #7a8a80;
  font-size: 10px;
  font-weight: 700;
}

.dr-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 68vh;
  overflow-y: auto;
  padding-right: 4px;
}

.slam-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: linear-gradient(120deg, #fff5d6, #ffe8a3);
  border: 1px solid #e5bf52;
  color: #4d3b00;
}
.slam-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 50%;
  background: #d9a300;
  color: #fff;
  font-size: 20px;
  font-weight: 900;
}
.slam-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
}
.slam-text strong {
  font-size: 14px;
}

.early-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: #f1f4ee;
  border: 1px solid #c9d6c4;
  color: #2f4438;
}
.early-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 50%;
  background: #5f7a68;
  color: #fff;
  font-size: 18px;
  font-weight: 900;
}
.early-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 1.5;
}
.early-text strong {
  font-size: 14px;
}

.dr-section-title {
  margin: 2px 0 -4px;
  color: #5a6a60;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.dl-count {
  margin-left: 4px;
  color: #8a7b4a;
  font-size: 11px;
}

/* 本副亮牌：四张关键牌的亮/未亮状态 */
.deal-lights {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.dl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f1f4ee;
  border: 1px solid #d9e2d6;
  opacity: 0.62;
}
.dl-item.lit {
  opacity: 1;
  background: linear-gradient(120deg, #fff9e6, #fff3c9);
  border-color: #e5bf52;
  box-shadow:
    0 0 0 1px rgba(229, 191, 82, 0.35),
    0 4px 10px rgba(160, 120, 20, 0.12);
}
.dl-item.lit :deep(.playing-card) {
  box-shadow:
    0 0 0 2px rgba(255, 214, 102, 0.95),
    0 0 12px rgba(255, 214, 102, 0.5);
}
.dl-item:not(.lit) :deep(.playing-card) {
  filter: grayscale(0.85) brightness(0.9);
}
.dl-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dl-name {
  color: #23382c;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.dl-item:not(.lit) .dl-name {
  color: #7a8a80;
}
.dl-seat {
  color: #8a6a00;
  font-size: 11px;
  font-weight: 800;
}
.dl-unlit {
  color: #9aa89f;
  font-size: 11px;
  font-weight: 700;
}
.dl-effect {
  color: #b83232;
  font-size: 10px;
  font-weight: 800;
}
.dl-auto {
  align-self: flex-start;
  padding: 0 4px;
  border-radius: 999px;
  background: #e8dfc4;
  color: #7a5a00;
  font-size: 9px;
  font-weight: 800;
}

/* 南北队（左栏） / 东西队（右栏）分数 */
.team-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.ts-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fbfcf8;
  border: 1px solid #dde5da;
}
.ts-col.team-a {
  border-top: 3px solid #2f7d57;
}
.ts-col.team-b {
  border-top: 3px solid #b57a2a;
}
.ts-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 2px;
  padding-bottom: 5px;
  border-bottom: 1px solid #e6ece3;
}
.ts-team {
  color: #23382c;
  font-size: 15px;
  font-weight: 800;
}
.ts-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 0;
  color: #4f6057;
  font-size: 12px;
}
.ts-label {
  min-width: 0;
  color: #23382c;
  font-size: 14px;
  font-weight: 700;
}
.ts-value {
  flex: none;
  font-size: 17px;
  font-weight: 800;
}

.score-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.strip-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border-radius: 8px;
  background: #f4f6f1;
  border: 1px solid #dde5da;
}
.strip-label {
  color: #7a8a80;
  font-size: 10px;
  font-weight: 700;
}
.strip-value {
  color: #263d2f;
  font-size: 13px;
  font-weight: 800;
}
.tag.mini {
  padding: 0 3px;
  font-size: 9px;
}

.bd-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.bd-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fbfcf8;
  border: 1px solid #dde5da;
}
.bd-card.team-a {
  border-top: 3px solid #2f7d57;
}
.bd-card.team-b {
  border-top: 3px solid #b57a2a;
}
.bd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bd-seat {
  margin-right: 6px;
  color: #23382c;
  font-size: 16px;
  font-weight: 800;
}
.bd-final {
  font-size: 24px;
  font-weight: 900;
  line-height: 1;
}
.bd-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  min-height: 18px;
}
.bd-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bd-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  color: #4f6057;
}
.bd-row.transformer-row {
  padding-top: 2px;
  border-top: 1px dashed #d5ded2;
  color: #2d4638;
  font-weight: 700;
}
.bd-label {
  width: 40px;
  flex: none;
  font-weight: 800;
  color: #3a4a40;
}
.bd-detail {
  flex: 1;
  min-width: 0;
}
.bd-value {
  font-weight: 800;
}
.bd-collected {
  padding: 4px 0;
  border-top: 1px dashed #e1e8de;
  border-bottom: 1px dashed #e1e8de;
  overflow: hidden;
}
/* 收牌较多时允许换行，避免末尾的牌被裁掉 */
.bd-collected :deep(.hand-row) {
  flex-wrap: wrap;
  row-gap: 3px;
}
.bd-notes {
  margin: 0;
  padding-left: 15px;
  color: #6b7a70;
  font-size: 10px;
  line-height: 1.5;
}
.bd-notes li {
  margin: 1px 0;
}

.round-banner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  border-radius: 10px;
  background: #f2f7f1;
  border: 1px solid #cfe0cb;
}
.round-banner.decisive {
  background: #fff8e8;
  border-color: #e8cc85;
}
.round-banner.draw {
  background: #f1f4f7;
  border-color: #cbd5df;
}
.rb-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rb-title {
  color: #23382c;
  font-size: 15px;
  font-weight: 900;
}
.rb-heads {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  color: #3d5146;
  font-size: 12px;
}
.rb-heads strong {
  color: #b83232;
  font-size: 15px;
}
.rb-total {
  color: #6b7a70;
}
.rb-reason {
  margin: 2px 0 0;
  color: #5c6c62;
  font-size: 11px;
  line-height: 1.55;
}
.rb-outcome {
  margin: 4px 0 0;
  padding-top: 5px;
  border-top: 1px dashed #d5c18b;
  color: #7a5a00;
  font-size: 12px;
  font-weight: 700;
}
.continue-note {
  padding: 8px 12px;
  border-radius: 8px;
  background: #f4f6f1;
  color: #5c6c62;
  font-size: 12px;
}
.dr-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dr-footer-note {
  color: #7a8a80;
  font-size: 11px;
}
.dr-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 760px) {
  .score-strip {
    grid-template-columns: 1fr 1fr;
  }
  .team-summary {
    grid-template-columns: minmax(0, 1fr);
  }
  .deal-lights {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .bd-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .dr-header {
    align-items: flex-start;
  }
  .dr-team-scores {
    width: 100%;
  }
  .dr-team {
    flex: 1;
    align-items: flex-start;
  }
}
</style>

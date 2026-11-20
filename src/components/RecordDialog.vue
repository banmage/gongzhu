<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore } from '../store/game';
import {
  ALL_POSITIONS,
  EVENT_TYPE_TEXT,
  formatSigned,
  seatName,
  teamOf,
  type GameEventType,
} from '../models/game';
import { KEY_CARD_NAMES, cardLabel } from '../models/card';
import PlayingCard from './PlayingCard.vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const store = useGameStore();
const activeTab = ref<'events' | 'replay'>('events');
const selectedDeal = ref(0);
const trickIndex = ref(0);
const showAllEvents = ref(false);

/** 关键事件（默认隐藏逐张出牌与逐墩事件，避免长盘记录过长） */
const visibleEvents = computed(() => {
  const list = showAllEvents.value
    ? store.events
    : store.events.filter(
        (event) => event.type !== 'CARD_PLAYED' && event.type !== 'TRICK_COMPLETED',
      );
  return list.slice(-500);
});

watch(
  () => store.dealHistory.length,
  (length) => {
    if (length > 0) selectedDeal.value = length - 1;
  },
);

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return;
    activeTab.value = 'events';
    if (store.dealHistory.length > 0) selectedDeal.value = store.dealHistory.length - 1;
    trickIndex.value = 0;
  },
);

watch(
  () => selectedDeal.value,
  () => {
    trickIndex.value = 0;
  },
);

const currentDeal = computed(() => store.dealHistory[selectedDeal.value] ?? null);
const currentTrick = computed(() => currentDeal.value?.tricks[trickIndex.value] ?? null);

const dealOptions = computed(() =>
  store.dealHistory.map((record, index) => ({
    value: index,
    label: `第 ${record.roundNumber} 局 · 第 ${record.index} 副（种子 #${record.seed}）`,
  })),
);

const eventTagClass: Record<GameEventType, string> = {
  MATCH_STARTED: 'tag-green',
  DEAL_CREATED: 'tag-gray',
  PLAYER_LIGHT_SUBMITTED: 'tag-gray',
  AUTO_LIGHT_TRIGGERED: 'tag-gold',
  LIGHT_REVEALED: 'tag-gold',
  CARD_PLAYED: 'tag-green',
  TIMEOUT_AUTO_PLAY: 'tag-red',
  AI_TAKEOVER_STARTED: 'tag-dark',
  TRICK_COMPLETED: 'tag-gray',
  SCORE_CALCULATED: 'tag-green',
  PIG_HEAD_ASSIGNED: 'tag-red',
  ROUND_COMPLETED: 'tag-gold',
  MATCH_COMPLETED: 'tag-gold',
};

function close(): void {
  emit('update:modelValue', false);
}

function prevTrick(): void {
  if (trickIndex.value > 0) trickIndex.value -= 1;
}
function nextTrick(): void {
  const max = (currentDeal.value?.tricks.length ?? 1) - 1;
  if (trickIndex.value < max) trickIndex.value += 1;
}

function playFor(position: (typeof ALL_POSITIONS)[number]) {
  return currentTrick.value?.plays.find((play) => play.position === position) ?? null;
}

function collectedPoints(position: (typeof ALL_POSITIONS)[number]): number {
  return currentDeal.value?.score?.breakdowns[position].final ?? 0;
}

function exportJson(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    match: store.match,
    currentAudit: store.auditInfo,
    events: store.events,
    deals: store.dealHistory,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gongzhu-audit-seed-${store.match.seed}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="min(980px, 94vw)"
    align-center
    class="record-dialog"
    title="对局记录 · 审计与复盘"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="record-body">
      <div class="audit-strip">
        <span>发牌种子 <strong>#{{ store.match.seed }}</strong></span>
        <span v-if="store.auditInfo">洗牌 <strong>{{ store.auditInfo.algorithmVersion }}</strong></span>
        <span v-if="store.auditInfo">RNG <strong>{{ store.auditInfo.rngVersion }}</strong></span>
        <span v-if="store.auditInfo">发牌哈希 <strong>{{ store.auditInfo.dealHash }}</strong></span>
        <span>事件 <strong>{{ store.events.length }}</strong> 条</span>
        <span>已记录 <strong>{{ store.dealHistory.length }}</strong> 副</span>
        <el-button size="small" @click="exportJson">导出审计 JSON</el-button>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="事件记录" name="events">
          <div class="event-toolbar">
            <span class="event-toolbar-note">
              默认仅显示关键事件；亮牌提交后会记录具体牌种，暗手牌始终不记录。
            </span>
            <label class="event-toggle">
              <el-switch v-model="showAllEvents" size="small" />
              <span>显示逐张出牌 / 逐墩事件</span>
            </label>
            <span v-if="visibleEvents.length < store.events.length" class="event-limit">
              当前显示最近 {{ visibleEvents.length }} 条（共 {{ store.events.length }} 条）
            </span>
          </div>
          <div class="event-list">
            <div v-for="event in visibleEvents" :key="event.seq" class="event-row">
              <span class="event-seq">#{{ event.seq }}</span>
              <span class="tag" :class="eventTagClass[event.type]">{{ EVENT_TYPE_TEXT[event.type] }}</span>
              <span class="event-where">
                第 {{ event.roundNumber }} 局<template v-if="event.dealIndex"> · 第 {{ event.dealIndex }} 副</template>
              </span>
              <span class="event-detail">{{ event.detail }}</span>
              <span class="event-time">{{ new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
            </div>
            <p v-if="visibleEvents.length === 0" class="empty-note">暂无事件记录，开始对局后会自动写入。</p>
          </div>
        </el-tab-pane>

        <el-tab-pane label="复盘" name="replay">
          <div v-if="store.dealHistory.length === 0" class="empty-note">
            暂无已完成的副牌。完成一副牌后，这里会保留发牌种子、亮牌、13 墩出牌与结算明细，可按墩回看。
          </div>

          <template v-else>
            <div class="replay-toolbar">
              <el-select v-model="selectedDeal" size="small" style="width: 280px">
                <el-option
                  v-for="option in dealOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <span v-if="currentDeal" class="replay-meta">
                领出 {{ seatName(currentDeal.leader) }} · 种子 #{{ currentDeal.seed }}
              </span>
            </div>

            <div v-if="currentDeal" class="replay-summary">
              <div class="summary-block">
                <span class="summary-label">亮牌</span>
                <span v-if="currentDeal.litCards.length === 0" class="summary-value muted">无人亮牌</span>
                <span v-else class="summary-value">
                  <span v-for="card in currentDeal.litCards" :key="`rlit-${card}`" class="lit-chip">
                    {{ cardLabel(card) }} {{ KEY_CARD_NAMES[card] }} · {{ seatName(currentDeal.litBy[card]) }}
                    <span v-if="currentDeal.autoLitCards.includes(card)" class="tag tag-gold mini">自动</span>
                  </span>
                </span>
              </div>
              <div class="summary-block">
                <span class="summary-label">团队本副</span>
                <span class="summary-value">
                  A {{ formatSigned(currentDeal.score?.teamScores.A ?? 0) }} /
                  B {{ formatSigned(currentDeal.score?.teamScores.B ?? 0) }}
                  <span v-if="currentDeal.score?.slam.triggered" class="tag tag-gold mini">满贯 · 模拟分</span>
                </span>
              </div>
              <div class="summary-block">
                <span class="summary-label">个人分</span>
                <span class="summary-value">
                  <span v-for="pos in ALL_POSITIONS" :key="`rscore-${pos}`" class="person-score">
                    {{ seatName(pos) }} {{ formatSigned(collectedPoints(pos)) }}
                  </span>
                </span>
              </div>
              <div class="summary-block">
                <span class="summary-label">猪归属</span>
                <span class="summary-value">
                  {{ currentDeal.pigCollector ? `${seatName(currentDeal.pigCollector)}（${teamOf(currentDeal.pigCollector) === 'A' ? 'A队' : 'B队'}）` : '—' }}
                </span>
              </div>
            </div>

            <div v-if="currentTrick" class="trick-replay">
              <div class="trick-head">
                <span class="trick-title">第 {{ trickIndex + 1 }} / {{ currentDeal?.tricks.length }} 墩</span>
                <span v-if="currentTrick.winner" class="trick-winner">
                  {{ seatName(currentTrick.winner) }}赢墩
                  <template v-if="currentTrick.points !== 0"> · {{ formatSigned(currentTrick.points) }} 分</template>
                </span>
                <span class="trick-nav">
                  <el-button size="small" :disabled="trickIndex === 0" @click="prevTrick">上一墩</el-button>
                  <el-button
                    size="small"
                    :disabled="trickIndex >= (currentDeal?.tricks.length ?? 1) - 1"
                    @click="nextTrick"
                  >下一墩</el-button>
                </span>
              </div>

              <div class="trick-plays">
                <div v-for="pos in ALL_POSITIONS" :key="`rplay-${pos}`" class="trick-play">
                  <span class="play-seat">{{ seatName(pos) }}<span class="mini-team">{{ teamOf(pos) }}</span></span>
                  <template v-if="playFor(pos)">
                    <PlayingCard :card="playFor(pos)!.card" size="lg" />
                    <span class="play-order-text">
                      第 {{ currentTrick.plays.findIndex((p) => p.position === pos) + 1 }} 张
                      <span v-if="playFor(pos)!.auto" class="tag tag-red mini">超时</span>
                      <span v-else-if="playFor(pos)!.single" class="tag tag-gray mini">唯一</span>
                    </span>
                  </template>
                  <span v-else class="play-empty">未出牌</span>
                </div>
              </div>

              <div class="trick-collected">
                <span class="summary-label">本副收牌</span>
                <div v-for="pos in ALL_POSITIONS" :key="`rcollect-${pos}`" class="collected-line">
                  <span class="collected-seat">{{ seatName(pos) }} · {{ teamOf(pos) }}队</span>
                  <span class="collected-cards">
                    {{ (currentDeal?.collected[pos] ?? []).map((card) => cardLabel(card)).join(' ') || '无' }}
                  </span>
                </div>
              </div>
            </div>
          </template>
        </el-tab-pane>
      </el-tabs>
    </div>

    <template #footer>
      <div class="record-footer">
        <span class="footer-note">
          记录仅包含公开信息与结算后信息；亮牌提交后记录具体牌种，其他玩家暗手牌不记录。
        </span>
        <el-button type="primary" @click="close">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.record-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 70vh;
  overflow-y: auto;
  padding-right: 4px;
}
.audit-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f4f6f1;
  color: #6b7a70;
  font-size: 11px;
}
.audit-strip strong {
  color: #23382c;
  word-break: break-all;
}
.audit-strip .el-button {
  margin-left: auto;
}
.event-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 48vh;
  overflow-y: auto;
  border: 1px solid #e2e9df;
  border-radius: 8px;
  padding: 6px;
  background: #fbfcf8;
}
.event-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  color: #7a8a80;
  font-size: 10px;
}
.event-toolbar-note {
  flex: 1;
  min-width: 180px;
}
.event-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #5c6c62;
  font-weight: 700;
  cursor: pointer;
}
.event-limit {
  color: #a4b0a8;
}
.event-row {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 3px 5px;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1.5;
}
.event-row:nth-child(even) {
  background: #f4f6f1;
}
.event-seq {
  width: 34px;
  flex: none;
  color: #9aa89f;
  font-weight: 700;
}
.event-where {
  flex: none;
  color: #8a9a90;
  font-size: 10px;
}
.event-detail {
  flex: 1;
  min-width: 0;
  color: #3d5146;
}
.event-time {
  flex: none;
  color: #a4b0a8;
  font-size: 10px;
}
.empty-note {
  margin: 12px 0;
  padding: 14px;
  border-radius: 8px;
  background: #f4f6f1;
  color: #7a8a80;
  font-size: 12px;
  text-align: center;
}
.replay-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.replay-meta {
  color: #7a8a80;
  font-size: 11px;
}
.replay-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f4f6f1;
  margin-bottom: 8px;
}
.summary-block {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
}
.summary-label {
  flex: none;
  color: #7a8a80;
  font-weight: 700;
}
.summary-value {
  color: #2d4638;
  font-weight: 700;
}
.summary-value.muted {
  color: #9aa89f;
  font-weight: 500;
}
.lit-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin: 1px 6px 1px 0;
  padding: 0 6px;
  border-radius: 999px;
  background: #eaf1e6;
  border: 1px solid #d8e2d3;
}
.tag.mini {
  padding: 0 3px;
  font-size: 9px;
}
.person-score {
  margin-right: 10px;
}
.trick-replay {
  border: 1px solid #e2e9df;
  border-radius: 10px;
  padding: 10px 12px;
  background: #fbfcf8;
}
.trick-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 6px;
  border-bottom: 1px dashed #dde5da;
}
.trick-title {
  color: #23382c;
  font-size: 14px;
  font-weight: 800;
}
.trick-winner {
  color: #8a5a00;
  font-size: 12px;
  font-weight: 700;
}
.trick-nav {
  margin-left: auto;
}
.trick-plays {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 0;
}
.trick-play {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px;
  border-radius: 8px;
  background: #f4f6f1;
  border: 1px solid #e2e9df;
}
.play-seat {
  color: #3d5146;
  font-size: 11px;
  font-weight: 800;
}
.mini-team {
  margin-left: 2px;
  color: #9aa89f;
  font-size: 9px;
}
.play-order-text {
  color: #7a8a80;
  font-size: 10px;
}
.play-empty {
  color: #b0bcb4;
  font-size: 11px;
}
.trick-collected {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 6px;
  border-top: 1px dashed #dde5da;
}
.collected-line {
  display: flex;
  gap: 8px;
  font-size: 10px;
}
.collected-seat {
  width: 72px;
  flex: none;
  color: #7a8a80;
  font-weight: 700;
}
.collected-cards {
  color: #3d5146;
  word-break: break-all;
}
.record-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.footer-note {
  color: #8a9a90;
  font-size: 10px;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGameStore } from './store/game';
import StartScreen from './components/StartScreen.vue';
import Table from './components/Table.vue';
import DealResultDialog from './components/DealResultDialog.vue';
import MatchResultDialog from './components/MatchResultDialog.vue';
import RulesDialog from './components/RulesDialog.vue';
import RecordDialog from './components/RecordDialog.vue';

const store = useGameStore();
const rulesVisible = ref(false);
const recordVisible = ref(false);

const phaseLabel = computed(
  () =>
    ({
      idle: '待开始',
      dealing: '发牌中',
      lighting: '亮牌阶段',
      revealing: '亮牌揭晓',
      playing: '出牌阶段',
      scoring: '本副结算',
      matchEnd: '盘终结算',
    })[store.phase] ?? store.phase,
);

function onNewMatch(): void {
  store.returnToIdle();
}

function onAutoPilot(value: boolean): void {
  store.setAutoPilot(value);
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1><span class="suit-symbol">♠</span> 拱猪 · 对家双人队赛 <span class="suit-symbol red">♥</span></h1>
      <div class="status">
        <strong>{{ phaseLabel }}</strong>
        <span class="status-sep">·</span>
        {{ store.message }}
      </div>

      <!-- 亮牌读秒显示在南家可亮牌中央，顶栏只保留出牌读秒 -->
      <span
        v-if="store.phase !== 'lighting' && store.countdownText !== '—'"
        class="header-timer"
        aria-live="off"
      >
        {{ store.countdownText }}
      </span>

      <label class="pilot-switch" title="开启后南家也由基础策略 AI 操作，用于全机器演示">
        <el-switch :model-value="store.autoPilot" size="small" @update:model-value="onAutoPilot" />
        <span>托管南家</span>
      </label>

      <el-button :disabled="store.phase === 'idle'" @click="recordVisible = true">记录</el-button>
      <el-button @click="rulesVisible = true">规则</el-button>
      <el-button type="primary" @click="onNewMatch">返回首页</el-button>
    </header>

    <main class="app-body">
      <StartScreen v-if="store.phase === 'idle'" @rules="rulesVisible = true" />
      <Table v-else />
    </main>

    <DealResultDialog />
    <MatchResultDialog />
    <RulesDialog v-model="rulesVisible" />
    <RecordDialog v-model="recordVisible" />
  </div>
</template>

<style scoped>
.app-header h1 .red {
  color: #ff7b6b;
}
.status-sep {
  margin: 0 3px;
  color: rgba(234, 245, 238, 0.5);
}
/* 读秒放在顶栏，不占用牌桌幅面 */
.header-timer {
  flex: none;
  min-width: 42px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 214, 102, 0.16);
  border: 1px solid rgba(255, 214, 102, 0.45);
  color: #ffe19a;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  text-align: center;
}
.pilot-switch {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 0 6px;
  color: rgba(234, 245, 238, 0.85);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
</style>

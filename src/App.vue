<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatSigned, scoreSignClass } from './models/game';
import { useGameStore } from './store/game';
import StartScreen from './components/StartScreen.vue';
import Table from './components/Table.vue';
import DealResultDialog from './components/DealResultDialog.vue';
import MatchResultDialog from './components/MatchResultDialog.vue';
import RulesDialog from './components/RulesDialog.vue';
import LightRuleDialog from './components/LightRuleDialog.vue';
import RecordDialog from './components/RecordDialog.vue';

const store = useGameStore();
const rulesVisible = ref(false);
const lightRulesVisible = ref(false);
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

      <!-- 第一行紧跟标题显示两队本局实际累积分值 -->
      <div v-if="store.phase !== 'idle'" class="header-scores" aria-label="两队本局累积分值">
        <span class="hs-item team-a">
          <span class="hs-name">南北 A</span>
          <span class="hs-value" :class="scoreSignClass(store.round.smallScores.A)">
            {{ formatSigned(store.round.smallScores.A) }}
          </span>
        </span>
        <span class="hs-divider">/</span>
        <span class="hs-item team-b">
          <span class="hs-name">东西 B</span>
          <span class="hs-value" :class="scoreSignClass(store.round.smallScores.B)">
            {{ formatSigned(store.round.smallScores.B) }}
          </span>
        </span>
      </div>

      <div class="status">
        <strong>{{ phaseLabel }}</strong>
        <span class="status-sep">·</span>
        {{ store.message }}
      </div>

      <label class="pilot-switch" title="开启后南家也由概率团队策略 AI 操作，用于全机器演示">
        <el-switch :model-value="store.autoPilot" size="small" @update:model-value="onAutoPilot" />
        <span>托管南家</span>
      </label>

      <el-button :disabled="store.phase === 'idle'" @click="recordVisible = true">记录</el-button>
      <el-button @click="lightRulesVisible = true">亮牌规则</el-button>
      <el-button @click="rulesVisible = true">规则</el-button>
      <el-button type="primary" @click="onNewMatch">返回首页</el-button>
    </header>

    <main class="app-body">
      <StartScreen v-if="store.phase === 'idle'" @rules="rulesVisible = true" @light-rules="lightRulesVisible = true" />
      <Table v-else />
    </main>

    <DealResultDialog />
    <MatchResultDialog />
    <RulesDialog v-model="rulesVisible" />
    <LightRuleDialog v-model="lightRulesVisible" />
    <RecordDialog v-model="recordVisible" />
  </div>
</template>

<style scoped>
.app-header h1 .red {
  color: #ff7b6b;
}
.header-scores {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(247, 247, 242, 0.96);
  color: #23382c;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}
.hs-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
}
.hs-name {
  color: #5c6c62;
  font-size: 10px;
  font-weight: 700;
}
.hs-value {
  font-size: 15px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.hs-divider {
  color: #a4b0a8;
  font-weight: 700;
}
.status-sep {
  margin: 0 3px;
  color: rgba(234, 245, 238, 0.5);
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

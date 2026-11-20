<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../store/game';
import {
  endReasonText,
  formatSigned,
  resultText,
  teamName,
  type TeamOrNone,
} from '../models/game';

const store = useGameStore();

const winnerText = computed(() => {
  const winner = store.match.winner as TeamOrNone | null;
  if (winner === 'A') return 'A队（南北）获胜';
  if (winner === 'B') return 'B队（东西）获胜';
  if (winner === 'NONE') return '双方判和';
  return '盘终';
});

const winnerClass = computed(() => {
  if (store.match.winner === 'A') return 'a';
  if (store.match.winner === 'B') return 'b';
  return 'draw';
});

function onRestart(): void {
  store.startMatch(store.match.format);
}

function onLobby(): void {
  store.returnToIdle();
}
</script>

<template>
  <el-dialog
    :model-value="store.matchResultVisible"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    width="min(900px, 94vw)"
    align-center
    class="match-result-dialog"
    title=""
  >
    <template #header>
      <div class="mr-header">
        <div>
          <div class="mr-kicker">MATCH RESULT · {{ store.match.format }}局制</div>
          <h2>盘终结算</h2>
        </div>
        <div class="mr-total">
          <div class="mr-total-item a">
            <span>A队 · 南北</span>
            <strong>{{ store.match.totalPigHeads.A }}</strong>
            <em>头</em>
          </div>
          <div class="mr-total-item b">
            <span>B队 · 东西</span>
            <strong>{{ store.match.totalPigHeads.B }}</strong>
            <em>头</em>
          </div>
        </div>
      </div>
    </template>

    <div class="mr-body">
      <div class="winner-banner" :class="winnerClass">
        <div class="winner-medal">{{ store.match.winner === 'NONE' ? '和' : '胜' }}</div>
        <div class="winner-text">
          <strong>{{ winnerText }}</strong>
          <span>{{ store.match.reason }}</span>
        </div>
      </div>

      <div class="mr-table-wrap">
        <table class="mr-table">
          <thead>
            <tr>
              <th>局</th>
              <th>副数</th>
              <th>本局小分 A / B</th>
              <th>新增猪头 A / B</th>
              <th>本局结果</th>
              <th>结束原因</th>
              <th>累计猪头 A / B</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in store.match.rounds" :key="record.roundNumber">
              <td>
                <span class="round-no">{{ record.roundNumber }}</span>
                <span v-if="record.isExtra" class="tag tag-gold mini">加赛</span>
              </td>
              <td>{{ record.dealsPlayed }}</td>
              <td>
                <span class="team-a">{{ formatSigned(record.smallScores.A) }}</span>
                /
                <span class="team-b">{{ formatSigned(record.smallScores.B) }}</span>
              </td>
              <td>
                <span class="pig-a">+{{ record.newPigHeads.A }}</span>
                /
                <span class="pig-b">+{{ record.newPigHeads.B }}</span>
              </td>
              <td>
                <span class="result-pill" :class="record.result.toLowerCase()">
                  {{ resultText(record.result) }}
                </span>
              </td>
              <td class="reason-cell">{{ endReasonText(record.endReason) }}</td>
              <td>
                {{ record.totalPigHeadsAfter.A }} / {{ record.totalPigHeadsAfter.B }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mr-audit">
        <span>发牌审计：种子 #{{ store.match.seed }}</span>
        <span v-if="store.auditInfo">算法 {{ store.auditInfo.algorithmVersion }} · 发牌哈希 {{ store.auditInfo.dealHash }}</span>
        <span>每副牌支持按种子重放验证</span>
      </div>

      <div class="mr-reasons">
        <h4>本盘裁决依据</h4>
        <p>{{ store.match.reason }}</p>
        <p class="mr-hint">
          说明：最终胜负以总猪头数少者为准；6.4 小分裁决与 8 局制回溯仅用于记录本局胜负及同猪头时的盘终裁决。
        </p>
      </div>
    </div>

    <template #footer>
      <div class="mr-footer">
        <span class="mr-footer-note">{{ teamName('A') }} vs {{ teamName('B') }}</span>
        <div>
          <el-button @click="onLobby">返回首页</el-button>
          <el-button type="primary" size="large" @click="onRestart">再来一盘</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.mr-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-right: 8px;
}
.mr-kicker {
  color: #8a7b4a;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
}
.mr-header h2 {
  margin: 2px 0 0;
  color: #23382c;
  font-size: 22px;
}
.mr-total {
  display: flex;
  gap: 10px;
}
.mr-total-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 8px;
  background: #f1f4ee;
  border: 1px solid #d9e2d6;
  color: #5c6c62;
  font-size: 11px;
  font-weight: 700;
}
.mr-total-item.a {
  border-left: 4px solid #2f7d57;
}
.mr-total-item.b {
  border-left: 4px solid #b57a2a;
}
.mr-total-item strong {
  color: #1d3b2a;
  font-size: 26px;
  font-weight: 900;
  line-height: 1;
}
.mr-total-item em {
  font-style: normal;
  font-size: 10px;
}

.mr-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 68vh;
  overflow-y: auto;
  padding-right: 4px;
}
.winner-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: 12px;
  background: linear-gradient(120deg, #e9f7ee, #d9f0e2);
  border: 1px solid #a9d6ba;
}
.winner-banner.b {
  background: linear-gradient(120deg, #fff6e5, #ffedc8);
  border-color: #e2c27f;
}
.winner-banner.draw {
  background: linear-gradient(120deg, #f1f4f7, #e4e9ef);
  border-color: #c7d1dc;
}
.winner-medal {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 50%;
  background: #2f7d57;
  color: #fff;
  font-size: 22px;
  font-weight: 900;
}
.winner-banner.b .winner-medal {
  background: #b57a2a;
}
.winner-banner.draw .winner-medal {
  background: #6b7a80;
}
.winner-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.winner-text strong {
  color: #1d3b2a;
  font-size: 20px;
  font-weight: 900;
}
.winner-text span {
  color: #4f6057;
  font-size: 12px;
  line-height: 1.55;
}

.mr-table-wrap {
  overflow-x: auto;
  border: 1px solid #dde5da;
  border-radius: 10px;
}
.mr-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  white-space: nowrap;
}
.mr-table th {
  padding: 8px 10px;
  background: #f1f4ee;
  color: #5c6c62;
  font-size: 10px;
  font-weight: 800;
  text-align: left;
}
.mr-table td {
  padding: 8px 10px;
  border-top: 1px solid #e6ece3;
  color: #3d5146;
}
.mr-table tr:nth-child(even) td {
  background: #fbfcf8;
}
.round-no {
  display: inline-block;
  min-width: 20px;
  font-weight: 800;
  color: #23382c;
}
.tag.mini {
  margin-left: 3px;
  padding: 0 3px;
  font-size: 9px;
}
.team-a {
  color: #1d6b45;
  font-weight: 800;
}
.team-b {
  color: #8a4b1d;
  font-weight: 800;
}
.pig-a {
  color: #b83232;
  font-weight: 800;
}
.pig-b {
  color: #b83232;
  font-weight: 800;
}
.result-pill {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
}
.result-pill.a_win {
  background: #e3f4ea;
  color: #1d6b45;
}
.result-pill.b_win {
  background: #fff0d8;
  color: #8a4b1d;
}
.result-pill.draw {
  background: #eef1f5;
  color: #5c6c72;
}
.reason-cell {
  color: #6b7a70;
}
.mr-audit {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f4f6f1;
  color: #7a8a80;
  font-size: 10px;
}
.mr-reasons h4 {
  margin: 0 0 4px;
  color: #3a4a40;
  font-size: 13px;
}
.mr-reasons p {
  margin: 0 0 4px;
  color: #4f6057;
  font-size: 12px;
  line-height: 1.6;
}
.mr-hint {
  color: #7a8a80 !important;
  font-size: 11px !important;
}
.mr-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.mr-footer-note {
  color: #7a8a80;
  font-size: 11px;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGameStore } from '../store/game';
import { HEART_A, PIG, SHEEP, TRANSFORMER, cardLabel } from '../models/card';
import type { MatchFormat } from '../models/game';
import PlayingCard from './PlayingCard.vue';

const emit = defineEmits<{ (e: 'rules'): void; (e: 'light-rules'): void }>();
const store = useGameStore();

const format = ref<MatchFormat>(5);
const seedText = ref('');
const error = ref('');

const keyCards = [PIG, SHEEP, TRANSFORMER, HEART_A];

/** 勾选“无读秒”时把时限设为 0；取消时恢复常用默认值 */
const lightNoCountdown = computed({
  get: () => store.config.lightSeconds <= 0,
  set: (value: boolean) => {
    store.config.lightSeconds = value ? 0 : 30;
  },
});
const playNoCountdown = computed({
  get: () => store.config.playSeconds <= 0,
  set: (value: boolean) => {
    store.config.playSeconds = value ? 0 : 20;
  },
});

function start(): void {
  const raw = seedText.value.trim();
  let seed: number | undefined;
  if (raw) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      error.value = '种子必须是非负整数（用于复现发牌）';
      return;
    }
    seed = parsed >>> 0;
  }
  error.value = '';
  store.startMatch(format.value, seed);
}
</script>

<template>
  <div class="start-screen">
    <div class="start-hero">
      <div class="hero-copy">
        <div class="hero-kicker">中华拱猪 · 2v2 对家双人队赛</div>
        <h1>
          <span class="suit-symbol black">♠</span>拱猪
          <span class="hero-sub">对家赛</span>
        </h1>
        <p class="hero-desc">
          南北一队 vs 东西一队，固定对家。亮牌 → 统一揭晓 → 13 墩出牌 → 结算画猪头。
          小分只决定画头，最终比较总猪头，少者获胜。
        </p>
        <div class="hero-tags">
          <span class="tag tag-gold">亮牌公开</span>
          <span class="tag tag-gold">第四张可配置自动亮</span>
          <span class="tag tag-green">首轮限制</span>
          <span class="tag tag-green">满贯 / 全红 / 窝猪</span>
          <span class="tag tag-dark">可复现发牌审计</span>
        </div>
        <div class="hero-actions">
          <el-button type="primary" size="large" @click="start">开始对局</el-button>
          <el-button size="large" @click="emit('rules')">查看规则</el-button>
          <el-button size="large" @click="emit('light-rules')">亮牌规则管理</el-button>
        </div>
      </div>

      <div class="hero-table" aria-hidden="true">
        <div class="mini-seat north">北 · A队</div>
        <div class="mini-seat west">西 · B队</div>
        <div class="mini-seat east">东 · B队</div>
        <div class="mini-seat south">南 · 你 · A队</div>
        <div class="mini-center">
          <div class="mini-key-cards">
            <span v-for="card in keyCards" :key="card" class="mini-key">
              <PlayingCard :card="card" size="sm" />
              <em>{{ cardLabel(card) }}</em>
            </span>
          </div>
          <div class="mini-center-label">四张可亮牌</div>
        </div>
      </div>
    </div>

    <div class="start-grid">
      <section class="start-card format-card">
        <h2>选择赛制</h2>
        <button
          type="button"
          class="format-option"
          :class="{ selected: format === 5 }"
          @click="format = 5"
        >
          <span class="format-name">5 局制</span>
          <span class="format-desc">固定 5 局；总猪头相同进入突然死亡加赛，每加赛 1 局比较总猪头。</span>
          <span class="format-badge">推荐</span>
        </button>
        <button
          type="button"
          class="format-option"
          :class="{ selected: format === 8 }"
          @click="format = 8"
        >
          <span class="format-name">固定 8 局制</span>
          <span class="format-desc">固定 8 局；总猪头相同按最后一局输者负，必要时向前回溯。</span>
        </button>

        <label class="seed-field">
          <span>发牌种子（可选）</span>
          <input v-model="seedText" type="text" inputmode="numeric" placeholder="留空则随机" />
        </label>
        <p v-if="error" class="seed-error">{{ error }}</p>
        <p class="seed-hint">填写相同种子可复现同一副牌，用于复盘与审计验证。</p>

        <div class="settings-block">
          <div class="settings-title">对局参数</div>
          <div class="settings-grid">
            <div class="setting-item">
              <span>亮牌读秒（秒）</span>
              <div class="time-control">
                <input
                  v-model.number="store.config.lightSeconds"
                  type="number"
                  min="5"
                  max="60"
                  :disabled="lightNoCountdown"
                />
                <label class="no-countdown">
                  <input v-model="lightNoCountdown" type="checkbox" />
                  无读秒
                </label>
              </div>
            </div>
            <div class="setting-item">
              <span>出牌读秒（秒）</span>
              <div class="time-control">
                <input
                  v-model.number="store.config.playSeconds"
                  type="number"
                  min="5"
                  max="60"
                  :disabled="playNoCountdown"
                />
                <label class="no-countdown">
                  <input v-model="playNoCountdown" type="checkbox" />
                  无读秒
                </label>
              </div>
            </div>
            <label class="setting-item">
              <span>单局副数上限</span>
              <input v-model.number="store.config.dealLimit" type="number" min="1" max="60" />
            </label>
            <label class="setting-item">
              <span>已亮 3 张后的第 4 张</span>
              <select v-model="store.config.autoLightLastOne" class="setting-select">
                <option :value="true">自动亮</option>
                <option :value="false">不自动亮（手动）</option>
              </select>
            </label>
          </div>
          <p class="settings-note">
            读秒可设为 5–60 秒，或勾选“无读秒”关闭倒计时。第四张自动亮可选择开启或关闭。修改后仅影响新开的对局。
          </p>
        </div>
      </section>

      <section class="start-card seat-card">
        <h2>座位与队伍</h2>
        <div class="seat-list">
          <div class="seat-line a">
            <span class="seat-avatar">南</span>
            <span class="seat-info"><strong>南家（你）</strong><small>A队 · 人类玩家</small></span>
          </div>
          <div class="seat-line a">
            <span class="seat-avatar">北</span>
            <span class="seat-info"><strong>北家</strong><small>A队 · 概率团队 AI</small></span>
          </div>
          <div class="seat-line b">
            <span class="seat-avatar">东</span>
            <span class="seat-info"><strong>东家</strong><small>B队 · 概率团队 AI</small></span>
          </div>
          <div class="seat-line b">
            <span class="seat-avatar">西</span>
            <span class="seat-info"><strong>西家</strong><small>B队 · 概率团队 AI</small></span>
          </div>
        </div>
        <p class="seat-note">出牌顺序逆时针：南 → 东 → 北 → 西。可在对局中开启“托管南家”做全机器演示。</p>
      </section>

      <section class="start-card flow-card">
        <h2>一副牌的流程</h2>
        <ol class="flow-list">
          <li><span>1</span><div><strong>发牌</strong>每人 13 张；每局第一副持 ♠3 者领出，首引花色不限。</div></li>
          <li><span>2</span><div><strong>亮牌</strong>选择亮 ♠Q / ♦J / ♣10 / ♥A；系统按当前亮牌规则推荐，管理员可热更新规则。</div></li>
          <li><span>3</span><div><strong>揭晓</strong>全员提交后统一公开；开启自动亮时，已亮 3 张后自动亮最后一张。</div></li>
          <li><span>4</span><div><strong>出牌</strong>13 墩，有领出花色必须跟牌；受首轮限制的亮牌不能出。</div></li>
          <li><span>5</span><div><strong>结算</strong>个人分 → 团队小分 → 画猪头；满贯立即赢下本局。</div></li>
        </ol>
      </section>
    </div>

    <div class="start-footer">
      <span>本游戏按《中式拱猪_对家双人队赛_SRS_V3.1》实现；⚠️ 临时默认项已按 V3.1 默认值启用。</span>
      <span>
        亮牌规则 {{ store.lightRuleRuntime.config.meta.version }} ·
        {{ store.lightRuleRuntime.source === 'builtin' ? '内置默认' : '管理员自定义' }} ·
        发牌审计：算法版本 + 随机种子 + 发牌哈希
      </span>
    </div>
  </div>
</template>

<style scoped>
.start-screen {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 1180px;
  margin: 0 auto;
}

.start-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(300px, 0.85fr);
  gap: 20px;
  align-items: center;
  padding: 28px 32px;
  border-radius: 20px;
  background:
    radial-gradient(ellipse at 70% 40%, rgba(72, 167, 112, 0.45), transparent 62%),
    radial-gradient(circle at 30% 0%, #2d8a5d 0%, #1d6d49 45%, #0e3a26 100%);
  border: 3px solid #0b2f21;
  box-shadow:
    inset 0 0 0 2px rgba(255, 235, 180, 0.12),
    inset 0 0 90px rgba(0, 0, 0, 0.38),
    0 18px 40px rgba(0, 0, 0, 0.36);
  color: #eaf5ee;
  overflow: hidden;
}
.start-hero::before {
  content: '';
  position: absolute;
  inset: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50% / 42%;
  pointer-events: none;
}
.hero-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hero-kicker {
  color: #ffe19a;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
}
.hero-copy h1 {
  margin: 0;
  font-size: clamp(40px, 6vw, 64px);
  line-height: 1;
  letter-spacing: 0.03em;
  text-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
}
.hero-copy h1 .black {
  color: #eaf5ee;
}
.hero-sub {
  color: #ffe19a;
  font-size: 0.42em;
  letter-spacing: 0.12em;
  vertical-align: middle;
}
.hero-desc {
  max-width: 560px;
  margin: 0;
  color: rgba(234, 245, 238, 0.82);
  font-size: 13px;
  line-height: 1.75;
}
.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}
.hero-actions .el-button {
  border-radius: 999px;
  font-weight: 700;
}

.hero-table {
  position: relative;
  z-index: 1;
  min-height: 280px;
  border-radius: 16px;
  background: rgba(4, 30, 19, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.25);
}
.mini-seat {
  position: absolute;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.28);
  color: #eaf5ee;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.mini-seat.north {
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
}
.mini-seat.south {
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  color: #ffe19a;
}
.mini-seat.west {
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
}
.mini-seat.east {
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
}
.mini-center {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.mini-key-cards {
  display: flex;
  gap: 5px;
}
.mini-key {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 214, 102, 0.3);
}
.mini-key em {
  color: #ffe19a;
  font-size: 9px;
  font-style: normal;
  font-weight: 800;
}
.mini-center-label {
  color: rgba(234, 245, 238, 0.6);
  font-size: 10px;
}

.start-grid {
  display: grid;
  grid-template-columns: 1.05fr 0.9fr 0.95fr;
  gap: 12px;
}
.start-card {
  padding: 16px 18px;
  border-radius: 14px;
  background: #fbfcf8;
  border: 1px solid #dde5da;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.16);
}
.start-card h2 {
  margin: 0 0 10px;
  color: #23382c;
  font-size: 15px;
  border-left: 3px solid #2f7d57;
  padding-left: 8px;
}
.format-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  margin-bottom: 8px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid #d9e2d6;
  background: #f4f6f1;
  color: #3d5146;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.format-option:hover {
  border-color: #9cbfa8;
}
.format-option.selected {
  background: #eaf5ee;
  border-color: #2f7d57;
  box-shadow: inset 0 0 0 1px rgba(47, 125, 87, 0.35);
}
.format-name {
  color: #23382c;
  font-size: 14px;
  font-weight: 800;
}
.format-desc {
  color: #6b7a70;
  font-size: 11px;
  line-height: 1.5;
}
.format-badge {
  position: absolute;
  top: 8px;
  right: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #d9a300;
  color: #2c2200;
  font-size: 9px;
  font-weight: 800;
}
.seed-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  color: #5c6c62;
  font-size: 11px;
  font-weight: 700;
}
.seed-field input {
  padding: 7px 9px;
  border-radius: 7px;
  border: 1px solid #cfdacb;
  background: #fff;
  color: #23382c;
  font-size: 12px;
  outline: none;
}
.seed-field input:focus {
  border-color: #2f7d57;
  box-shadow: 0 0 0 2px rgba(47, 125, 87, 0.15);
}
.seed-hint,
.seed-error {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.5;
}
.seed-hint {
  color: #8a9a90;
}
.seed-error {
  color: #b83232;
}

.settings-block {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed #dde5da;
}
.settings-title {
  margin-bottom: 6px;
  color: #5c6c62;
  font-size: 11px;
  font-weight: 800;
}
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}
.setting-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: #6b7a70;
  font-size: 10px;
  font-weight: 700;
}
.setting-item input {
  width: 100%;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid #cfdacb;
  background: #fff;
  color: #23382c;
  font-size: 11px;
  outline: none;
}
.setting-item input:focus {
  border-color: #2f7d57;
  box-shadow: 0 0 0 2px rgba(47, 125, 87, 0.15);
}
.setting-item input:disabled {
  background: #eef1ea;
  color: #9aa89f;
}
.time-control {
  display: flex;
  align-items: center;
  gap: 6px;
}
.time-control input[type='number'] {
  flex: 1;
  min-width: 0;
}
.no-countdown {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: none;
  color: #6b7a70;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.no-countdown input {
  width: auto;
  margin: 0;
  padding: 0;
}
.setting-select {
  width: 100%;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid #cfdacb;
  background: #fff;
  color: #23382c;
  font-size: 11px;
  outline: none;
}
.setting-select:focus {
  border-color: #2f7d57;
  box-shadow: 0 0 0 2px rgba(47, 125, 87, 0.15);
}
.settings-note {
  margin: 6px 0 0;
  color: #9aa89f;
  font-size: 10px;
  line-height: 1.5;
}

.seat-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.seat-line {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 9px;
  border-radius: 8px;
  background: #f4f6f1;
  border-left: 4px solid #2f7d57;
}
.seat-line.b {
  border-left-color: #b57a2a;
}
.seat-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 50%;
  background: #2f7d57;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
}
.seat-line.b .seat-avatar {
  background: #b57a2a;
}
.seat-info {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.seat-info strong {
  color: #23382c;
  font-size: 12px;
}
.seat-info small {
  color: #7a8a80;
  font-size: 10px;
}
.seat-note {
  margin: 8px 0 0;
  color: #7a8a80;
  font-size: 10px;
  line-height: 1.55;
}

.flow-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.flow-list li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.flow-list li > span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 50%;
  background: #eaf5ee;
  color: #1d6b45;
  font-size: 10px;
  font-weight: 900;
}
.flow-list div {
  color: #6b7a70;
  font-size: 11px;
  line-height: 1.55;
}
.flow-list strong {
  display: block;
  color: #23382c;
  font-size: 12px;
}

.start-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 4px;
  color: rgba(234, 245, 238, 0.55);
  font-size: 10px;
}

@media (max-width: 980px) {
  .start-hero {
    grid-template-columns: 1fr;
  }
  .hero-table {
    min-height: 240px;
  }
  .start-grid {
    grid-template-columns: 1fr 1fr;
  }
  .flow-card {
    grid-column: 1 / -1;
  }
}
@media (max-width: 680px) {
  .start-hero {
    padding: 20px;
  }
  .start-grid {
    grid-template-columns: 1fr;
  }
}
</style>

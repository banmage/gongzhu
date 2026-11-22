<script setup lang="ts">
import PlayingCard from './PlayingCard.vue';

const props = withDefaults(
  defineProps<{
    cards: number[];
    /** 已打出的亮牌：保留牌面但半透明降亮，表示亮牌已经离手 */
    playedCards?: number[];
    /** 系统自动亮出的最后一张关键牌：用半明半暗的交叉纹路单独标记 */
    autoCards?: number[];
    /** row：横向小牌列；column：竖向叠放，用于南家左侧窄条 */
    variant?: 'row' | 'column';
  }>(),
  {
    playedCards: () => [],
    autoCards: () => [],
    variant: 'row',
  },
);

function isAuto(card: number): boolean {
  return props.autoCards.includes(card);
}
</script>

<template>
  <div v-if="cards.length > 0" class="lit-cards" :class="variant">
    <div
      v-for="card in cards"
      :key="`lit-${card}`"
      class="lit-card"
      :class="{ 'lit-auto': isAuto(card) }"
    >
      <PlayingCard
        :card="card"
        size="md"
        :class="{ 'lit-played': playedCards.includes(card) }"
      />
      <span v-if="isAuto(card)" class="lit-auto-tag">自动</span>
    </div>
  </div>
</template>

<style scoped>
/* 亮牌直接以正面牌面公开，金色光晕表示“已亮”；自动亮另加明暗分割与小标签。 */
.lit-cards {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  max-width: 100%;
  pointer-events: none;
}
.lit-cards.column {
  flex-direction: column;
  align-items: center;
  gap: 0;
}
.lit-card {
  position: relative;
  display: flex;
  flex: none;
}
.lit-cards :deep(.playing-card) {
  flex: none;
  width: 54px;
  height: 76px;
  border-radius: 6px;
  filter: brightness(1.06) saturate(1.08);
  box-shadow:
    0 0 0 2px rgba(255, 214, 102, 0.95),
    0 0 14px rgba(255, 214, 102, 0.55),
    0 2px 6px rgba(0, 0, 0, 0.35);
}
/* 亮牌被打出后仍留在座位旁，但半透明降亮，和未打出的亮牌区分 */
.lit-cards :deep(.playing-card.lit-played) {
  opacity: 0.38;
  filter: grayscale(0.7) brightness(0.72);
  box-shadow:
    0 0 0 1px rgba(255, 214, 102, 0.35),
    0 2px 5px rgba(0, 0, 0, 0.25);
}
/* 自动亮的最后一张牌：左上保持明亮，右下覆盖暗色斜纹，并用金色分割线强调。
   与普通亮牌整张高亮不同，即使不读文字也能一眼分辨。 */
.lit-cards .lit-card.lit-auto :deep(.playing-card)::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  background:
    linear-gradient(
      135deg,
      transparent 0 48.4%,
      rgba(255, 214, 102, 0.95) 48.4% 51.6%,
      transparent 51.6% 100%
    ),
    linear-gradient(135deg, transparent 0 50%, rgba(4, 16, 10, 0.6) 50% 100%);
}
.lit-auto-tag {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 5;
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(12, 28, 18, 0.82);
  color: #ffe19a;
  font-size: 9px;
  font-weight: 800;
  line-height: 14px;
  pointer-events: none;
}
/* 南家左侧的亮牌与加大的手牌保持相近比例，但仍小一号 */
.lit-cards.column :deep(.playing-card) {
  width: 60px;
  height: 82px;
  border-radius: 7px;
}
.lit-cards.column .lit-card + .lit-card {
  margin-top: -58px;
}
</style>

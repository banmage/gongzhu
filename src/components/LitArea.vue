<script setup lang="ts">
import PlayingCard from './PlayingCard.vue';

withDefaults(
  defineProps<{
    cards: number[];
    /** 已打出的亮牌：保留牌面但半透明降亮，表示亮牌已经离手 */
    playedCards?: number[];
    /** row：横向小牌列；column：竖向叠放，用于南家左侧窄条 */
    variant?: 'row' | 'column';
  }>(),
  {
    playedCards: () => [],
    variant: 'row',
  },
);
</script>

<template>
  <div v-if="cards.length > 0" class="lit-cards" :class="variant">
    <PlayingCard
      v-for="card in cards"
      :key="`lit-${card}`"
      :card="card"
      size="md"
      :class="{ 'lit-played': playedCards.includes(card) }"
    />
  </div>
</template>

<style scoped>
/* 亮牌直接以正面牌面公开，金色光晕表示“已亮”，不再使用文字标签。 */
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
.lit-cards.column :deep(.playing-card + .playing-card) {
  margin-top: -54px;
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
/* 南家左侧的亮牌与加大的手牌保持相近比例，但仍小一号 */
.lit-cards.column :deep(.playing-card) {
  width: 60px;
  height: 82px;
  border-radius: 7px;
}
</style>

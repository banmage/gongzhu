<script setup lang="ts">
import { computed } from 'vue';
import { isScoringCard } from '../models/card';
import { sortHand } from '../core/rules';
import PlayingCard from './PlayingCard.vue';

const props = defineProps<{
  cards: number[];
}>();

/** 只展示计分牌（红桃、猪、羊、变压器），按牌面排序，便于一眼看清得失 */
const scoringCards = computed(() => sortHand(props.cards.filter(isScoringCard)));

/** 牌少时展开、牌多时收紧，既保证可辨认，又不至于横向撑出座位 */
const spreadStep = computed(() => {
  const n = scoringCards.value.length;
  if (n <= 2) return 44;
  if (n <= 5) return 32;
  if (n <= 9) return 24;
  return 18;
});
</script>

<template>
  <div
    v-if="scoringCards.length > 0"
    class="collected-cards"
    :style="{ '--collected-step': `${spreadStep}px` }"
  >
    <PlayingCard
      v-for="card in scoringCards"
      :key="`collected-${card}`"
      :card="card"
      size="md"
    />
  </div>
</template>

<style scoped>
/* 直接以牌面展示已收计分牌，不加外框和文字，叠放成小牌扇。 */
.collected-cards {
  display: flex;
  align-items: flex-end;
  max-width: 100%;
  padding: 0 2px;
  pointer-events: none;
}
.collected-cards :deep(.playing-card) {
  flex: none;
  width: 66px;
  height: 93px;
  border-radius: 7px;
  box-shadow:
    0 2px 5px rgba(0, 0, 0, 0.3),
    inset 0 0 0 1px rgba(255, 255, 255, 0.85);
}
.collected-cards :deep(.playing-card + .playing-card) {
  margin-left: calc(var(--collected-step, 24px) - 66px);
}
</style>

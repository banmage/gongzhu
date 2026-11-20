<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { KEY_CARD_SHORT, cardLabel, getSuit, isKeyCard, type SuitIndex } from '../models/card';
import { sortHand } from '../core/rules';
import type { Position } from '../models/game';
import PlayingCard from './PlayingCard.vue';
import TurnArrow from './TurnArrow.vue';

const props = withDefaults(
  defineProps<{
    cards: number[];
    position: Position;
    /** 显示牌背（其他玩家） */
    faceDown?: boolean;
    /** 是否可点击（轮到人类行动） */
    clickable?: boolean;
    /** 当前行动高亮 */
    active?: boolean;
    /** 左键选中的牌 */
    selectedCard?: number | null;
    /** 当前合法出牌集合（用于提示/禁用） */
    legalCards?: number[];
    /** 本副已亮出的关键牌 */
    litCards?: number[];
    /** 亮牌阶段：人类已选择要亮的牌 */
    litSelection?: number[];
    /** 亮牌选择模式 */
    lightingMode?: boolean;
    /** 是否显示指向该手牌的“轮到你出牌”闪烁箭头 */
    showTurnArrow?: boolean;
    /** 系统推荐出的牌：在该牌上方显示闪烁箭头 */
    recommendedCard?: number | null;
    /** 亮牌读秒：显示在所有可亮牌的中央 */
    countdown?: number | null;
    /** 紧凑模式（用于结算弹窗等） */
    compact?: boolean;
  }>(),
  {
    faceDown: false,
    clickable: false,
    active: false,
    selectedCard: null,
    legalCards: () => [],
    litCards: () => [],
    litSelection: () => [],
    lightingMode: false,
    showTurnArrow: false,
    recommendedCard: null,
    countdown: null,
    compact: false,
  },
);

const emit = defineEmits<{
  (e: 'card-click', card: number): void;
  (e: 'card-confirm', card: number): void;
  (e: 'card-dblclick', card: number): void;
}>();

const SUIT_ROWS: SuitIndex[] = [3, 2, 0, 1];

const groups = computed(() => {
  const sorted = sortHand(props.cards);
  return SUIT_ROWS.map((suit) => ({
    suit,
    cards: sorted.filter((card) => getSuit(card) === suit),
  })).filter((row) => row.cards.length > 0);
});

const hasLegalSet = computed(() => props.legalCards.length > 0);

function isLegal(card: number): boolean {
  if (!hasLegalSet.value) return true;
  return props.legalCards.includes(card);
}

function isLit(card: number): boolean {
  return props.litCards.includes(card);
}

function isSelectedLight(card: number): boolean {
  return props.litSelection.includes(card);
}

function canClick(card: number): boolean {
  if (!props.clickable) return false;
  if (props.lightingMode) return isKeyCard(card);
  return isLegal(card);
}

function cardClass(card: number): Record<string, boolean> {
  return {
    illegal: !props.lightingMode && hasLegalSet.value && !isLegal(card),
    'key-card': isKeyCard(card),
    'lit-card': isLit(card),
    'light-selected': props.lightingMode && isSelectedLight(card),
    'light-available': props.lightingMode && isKeyCard(card) && !isSelectedLight(card),
    restricted: isLit(card) && !props.lightingMode && hasLegalSet.value && !isLegal(card),
  };
}

function onCardClick(card: number): void {
  if (!canClick(card)) return;
  emit('card-click', card);
}

function onCardConfirm(card: number): void {
  if (!props.clickable || props.lightingMode) return;
  if (!canClick(card)) return;
  emit('card-confirm', card);
}

function onCardDblClick(card: number): void {
  if (!canClick(card)) return;
  emit('card-dblclick', card);
}

/* 亮牌读秒定位：取所有可亮牌（关键牌）的包围盒中心，
   这样无论关键牌分散在哪些花色，读秒都落在“可亮牌”的中央。 */
const handEl = ref<HTMLElement | null>(null);
const cardSlots = new Map<number, HTMLElement>();
const countdownPosition = ref<{ left: number; top: number } | null>(null);
let resizeObserver: ResizeObserver | null = null;

function setCardSlotRef(card: number, el: unknown): void {
  if (el instanceof HTMLElement) cardSlots.set(card, el);
  else cardSlots.delete(card);
}

function updateCountdownPosition(): void {
  const root = handEl.value;
  if (!root || props.countdown == null) {
    countdownPosition.value = null;
    return;
  }

  const keyCards = props.cards.filter(isKeyCard);
  // 优先以仍带“可亮”标记的牌为锚点；全部已选中时退回全部关键牌。
  const availableKeys = props.lightingMode
    ? keyCards.filter((card) => !props.litSelection.includes(card))
    : keyCards;
  const anchorCards = availableKeys.length > 0 ? availableKeys : keyCards;
  const rects = anchorCards
    .map((card) => cardSlots.get(card)?.getBoundingClientRect())
    .filter((rect): rect is DOMRect => !!rect);
  if (rects.length === 0) {
    countdownPosition.value = null;
    return;
  }

  const rootRect = root.getBoundingClientRect();
  // 按位置排序后取中间的可亮牌作为锚点：奇数张取正中一张，
  // 偶数张取中间两张的中点。这样读秒不会落在一堆无关牌上。
  const centers = rects
    .map((rect) => ({
      x: (rect.left + rect.right) / 2,
      y: (rect.top + rect.bottom) / 2,
    }))
    .sort((a, b) => a.x - b.x);
  const middle = centers.length / 2;
  const anchor =
    centers.length % 2 === 1
      ? centers[Math.floor(middle)]
      : {
          x: (centers[middle - 1].x + centers[middle].x) / 2,
          y: (centers[middle - 1].y + centers[middle].y) / 2,
        };
  countdownPosition.value = {
    left: anchor.x - rootRect.left,
    top: anchor.y - rootRect.top,
  };
}

watch(
  () => `${props.countdown}|${props.lightingMode}|${props.cards.join(',')}|${props.litSelection.join(',')}`,
  () => {
    void nextTick(updateCountdownPosition);
  },
);

onMounted(() => {
  void nextTick(updateCountdownPosition);
  window.addEventListener('resize', updateCountdownPosition);
  if (typeof ResizeObserver !== 'undefined' && handEl.value) {
    resizeObserver = new ResizeObserver(updateCountdownPosition);
    resizeObserver.observe(handEl.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateCountdownPosition);
  resizeObserver?.disconnect();
  resizeObserver = null;
});

</script>

<template>
  <div ref="handEl" class="hand" :class="[{ active, compact, empty: cards.length === 0 }, `pos-${position}`]">
    <TurnArrow v-if="showTurnArrow && recommendedCard == null" :position="position" />
    <div v-if="faceDown" class="cards backs">
      <PlayingCard v-for="i in cards.length" :key="i" back size="xxl" />
      <span v-if="cards.length === 0" class="empty-hand">无牌</span>
    </div>

    <div v-else class="suits single-row" :class="{ clickable, 'no-events': !clickable }">
      <div class="hand-row">
        <span v-for="group in groups" :key="group.suit" class="suit-group">
          <span v-for="card in group.cards" :key="card" class="card-slot" :class="cardClass(card)" :ref="(el) => setCardSlotRef(card, el)">
            <TurnArrow
              v-if="recommendedCard === card"
              variant="card"
              :position="position"
              label="推荐出牌"
            />
            <span
              v-if="lightingMode && isKeyCard(card)"
              class="light-flag"
              :class="{ on: isSelectedLight(card) }"
            >
              {{ isSelectedLight(card) ? '亮' : '可亮' }}
            </span>
            <PlayingCard
              :card="card"
              size="xxl"
              :clickable="canClick(card)"
              :active="active && canClick(card)"
              :selected="selectedCard === card"
              @click="onCardClick(card)"
              @dblclick="onCardDblClick(card)"
              @contextmenu.prevent="onCardConfirm(card)"
            />
            <span class="card-caption">{{ cardLabel(card) }}</span>
            <span v-if="lightingMode && isKeyCard(card)" class="card-key-name">
              {{ KEY_CARD_SHORT[card] }}
            </span>
          </span>
        </span>
      </div>
    </div>

    <div
      v-if="countdown != null && countdownPosition"
      class="light-countdown"
      :style="{ left: `${countdownPosition.left}px`, top: `${countdownPosition.top}px` }"
      aria-live="off"
    >
      <strong>{{ countdown }}</strong><span>s</span>
    </div>
  </div>
</template>

<style scoped>
.hand {
  --hand-card-w: 108px;
  --hand-card-h: 150px;
  --hand-card-step: 32px;
  --hand-card-radius: 11px;
  --hand-label-size: 27px;
  --hand-corner-size: 21px;
  --hand-pip-size: 24px;
  --hand-court-size: 60px;
  --hand-back-spade-size: 40px;
  --card-overlap: calc(var(--hand-card-step) - var(--hand-card-w));
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  min-width: 0;
  max-width: 100%;
}
/* 手里没牌时不再占一整行高度，把空间留给收牌区 */
.hand.empty {
  display: none;
}

/* 亮牌读秒：浮在仍可点选的“可亮”牌组正中（中间一张或中间两张之间） */
.light-countdown {
  position: absolute;
  z-index: 40;
  display: flex;
  align-items: baseline;
  gap: 1px;
  transform: translate(-50%, -50%);
  padding: 5px 13px;
  border-radius: 999px;
  border: 1px solid rgba(255, 214, 102, 0.85);
  background: rgba(28, 20, 2, 0.84);
  color: #ffe19a;
  box-shadow:
    0 0 18px rgba(255, 214, 102, 0.5),
    0 4px 12px rgba(0, 0, 0, 0.4);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.light-countdown strong {
  font-size: clamp(24px, 2.4vw, 34px);
  font-weight: 900;
  line-height: 1;
}
.light-countdown span {
  font-size: 13px;
  font-weight: 800;
}

.hand :deep(.size-xxl) {
  --pc-label-size: var(--hand-label-size);
  --pc-corner-size: var(--hand-corner-size);
  --pc-pip-size: var(--hand-pip-size);
  --pc-court-size: var(--hand-court-size);
  --pc-back-spade-size: var(--hand-back-spade-size);
  width: var(--hand-card-w);
  height: var(--hand-card-h);
  border-radius: var(--hand-card-radius);
}
.hand :deep(.pc-label:not(.pc-label-bottom)) {
  top: 3px;
  left: 3px;
}
.hand :deep(.pc-corner-suit:not(.pc-corner-suit-bottom)) {
  top: calc(3px + var(--pc-label-size) + 1px);
  left: 3px;
}
.hand :deep(.pc-label-bottom) {
  right: 3px;
  bottom: 3px;
}
.hand :deep(.pc-corner-suit-bottom) {
  right: 3px;
  bottom: calc(3px + var(--pc-label-size) + 1px);
}

.suits {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.hand-row {
  display: flex;
  align-items: flex-end;
  min-height: var(--hand-card-h);
  padding-left: 2px;
  max-width: 100%;
}
.suit-group {
  display: flex;
  align-items: flex-end;
  flex: none;
}
.card-slot {
  position: relative;
  display: flex;
  flex: none;
  align-items: flex-end;
  /* 叠放后真正露出的牌宽（最后一张牌会覆盖为完整牌宽），
     推荐出牌箭头据此对准可见牌面中心 */
  --card-visible-width: calc(100% + var(--card-overlap));
  transition: opacity 0.15s ease;
}
.suit-group:last-child .card-slot:last-child {
  --card-visible-width: 100%;
}
.suit-group + .suit-group,
.suit-group .card-slot + .card-slot {
  margin-left: var(--card-overlap);
}
.card-slot :deep(.turn-arrow) {
  z-index: 30;
}

.suits.no-events {
  pointer-events: none;
}
.suits.clickable .card-slot {
  cursor: pointer;
}

/* 牌名/关键牌提示 */
.card-caption {
  position: absolute;
  left: 50%;
  bottom: -19px;
  transform: translateX(-50%);
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(4, 24, 16, 0.78);
  color: #dff7e8;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.card-slot:hover .card-caption {
  opacity: 1;
}
.card-key-name {
  position: absolute;
  right: 2px;
  top: 2px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(217, 163, 0, 0.95);
  color: #2c2200;
  font-size: 10px;
  font-weight: 800;
  pointer-events: none;
}

/* 亮牌徽标 */
.light-flag,
.lit-flag,
.restrict-flag {
  position: absolute;
  z-index: 5;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.5;
  white-space: nowrap;
  pointer-events: none;
}
.light-flag {
  top: -17px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.18);
  color: #eaf5ee;
  border: 1px solid rgba(255, 255, 255, 0.35);
}
.light-flag.on {
  background: #d9a300;
  color: #2c2200;
  border-color: #ffdf7e;
}
.lit-flag {
  top: -17px;
  left: 50%;
  transform: translateX(-50%);
  background: #d9a300;
  color: #2c2200;
}
.restrict-flag {
  bottom: -18px;
  left: 50%;
  transform: translateX(-50%);
  background: #b83232;
  color: #fff;
}

/* 不可出的牌只做去饱和/降亮处理，不使用 opacity：
   叠放的牌一旦半透明会互相透出，看起来发虚、发糊。 */
.card-slot.illegal :deep(.playing-card) {
  filter: grayscale(0.55) brightness(0.86);
}
.card-slot.restricted :deep(.playing-card) {
  outline: 2px dashed rgba(255, 120, 100, 0.9);
  outline-offset: 1px;
}
/* 自己已亮的牌：金色描边 + 轻微提亮，与未亮牌一眼区分 */
.card-slot.lit-card :deep(.playing-card) {
  box-shadow:
    0 0 0 2px rgba(255, 214, 102, 0.9),
    0 0 14px rgba(255, 214, 102, 0.4);
}
.card-slot.lit-card:not(.illegal) :deep(.playing-card) {
  filter: brightness(1.06) saturate(1.05);
}
.card-slot.lit-card.illegal :deep(.playing-card) {
  filter: grayscale(0.45) brightness(0.9);
}
/* 亮牌阶段：选中的牌整张（含角标）一起弹起，再次点击落回 */
.card-slot.light-selected {
  transform: translateY(-24px);
  z-index: 20;
}
.card-slot.light-selected :deep(.playing-card) {
  outline: 4px solid #ffd666;
  outline-offset: 1px;
  box-shadow:
    0 16px 26px rgba(0, 0, 0, 0.5),
    0 0 22px rgba(255, 214, 102, 0.75);
}
/* 所有可亮的牌都给出明显的金色外框和光晕，不只靠小标签提示 */
.card-slot.light-available :deep(.playing-card) {
  outline: 3px solid rgba(255, 214, 102, 0.95);
  outline-offset: 1px;
  box-shadow:
    0 0 0 2px rgba(217, 163, 0, 0.35),
    0 0 18px rgba(255, 214, 102, 0.55);
  filter: brightness(1.06) saturate(1.08);
}
.card-slot.light-available .light-flag {
  background: #d9a300;
  color: #2c2200;
  border-color: #ffdf7e;
}
.card-slot:has(.playing-card.selected) {
  z-index: 10;
}

/* 牌背 */
.cards.backs {
  display: flex;
  align-items: center;
  min-height: var(--hand-card-h);
  padding-left: 2px;
}
.cards.backs .playing-card + .playing-card {
  margin-left: var(--card-overlap);
}
.empty-hand {
  color: rgba(234, 245, 238, 0.55);
  font-size: 12px;
}

/* 紧凑模式（结算弹窗） */
.hand.compact {
  --hand-card-w: 42px;
  --hand-card-h: 58px;
  --hand-card-step: 22px;
  --hand-card-radius: 5px;
  --hand-label-size: 12px;
  --hand-corner-size: 9px;
  --hand-pip-size: 10px;
  --hand-court-size: 24px;
  --hand-back-spade-size: 16px;
}
.hand.compact .hand-row {
  min-height: var(--hand-card-h);
}

/* 响应式尺寸（与 bridge MVP 保持一致的牌桌比例） */
@media (min-width: 1600px) {
  .hand {
    --hand-card-w: 116px;
    --hand-card-h: 162px;
    --hand-card-step: 35px;
    --hand-card-radius: 12px;
    --hand-label-size: 29px;
    --hand-corner-size: 23px;
    --hand-pip-size: 26px;
    --hand-court-size: 64px;
    --hand-back-spade-size: 43px;
  }
}
@media (min-width: 1800px) {
  .hand {
    --hand-card-w: 128px;
    --hand-card-h: 178px;
    --hand-card-step: 41px;
    --hand-card-radius: 13px;
    --hand-label-size: 32px;
    --hand-corner-size: 25px;
    --hand-pip-size: 28px;
    --hand-court-size: 70px;
    --hand-back-spade-size: 47px;
  }
}
@media (min-width: 2000px) {
  .hand {
    --hand-card-w: 142px;
    --hand-card-h: 198px;
    --hand-card-step: 48px;
    --hand-card-radius: 14px;
    --hand-label-size: 35px;
    --hand-corner-size: 27px;
    --hand-pip-size: 31px;
    --hand-court-size: 78px;
    --hand-back-spade-size: 52px;
  }
}
@media (max-width: 1419px) {
  .hand {
    --hand-card-w: 104px;
    --hand-card-h: 146px;
    --hand-card-step: 29px;
    --hand-card-radius: 10px;
    --hand-label-size: 26px;
    --hand-corner-size: 20px;
    --hand-pip-size: 23px;
    --hand-court-size: 58px;
    --hand-back-spade-size: 38px;
  }
}
@media (max-width: 1299px) {
  .hand {
    --hand-card-w: 100px;
    --hand-card-h: 140px;
    --hand-card-step: 27px;
    --hand-card-radius: 10px;
    --hand-label-size: 24px;
    --hand-corner-size: 19px;
    --hand-pip-size: 22px;
    --hand-court-size: 56px;
    --hand-back-spade-size: 37px;
  }
}
@media (max-width: 1199px) {
  .hand {
    --hand-card-w: 94px;
    --hand-card-h: 131px;
    --hand-card-step: 20px;
    --hand-card-radius: 9px;
    --hand-label-size: 17px;
    --hand-corner-size: 16px;
    --hand-pip-size: 21px;
    --hand-court-size: 52px;
    --hand-back-spade-size: 34px;
  }
}
@media (max-width: 1099px) {
  .hand {
    --hand-card-w: 88px;
    --hand-card-h: 123px;
    --hand-card-step: 18px;
    --hand-card-radius: 8px;
    --hand-label-size: 15px;
    --hand-corner-size: 14px;
    --hand-pip-size: 19px;
    --hand-court-size: 48px;
    --hand-back-spade-size: 31px;
  }
}
@media (max-width: 999px) {
  .hand {
    --hand-card-w: 84px;
    --hand-card-h: 117px;
    --hand-card-step: 15px;
    --hand-card-radius: 8px;
    --hand-label-size: 12px;
    --hand-corner-size: 12px;
    --hand-pip-size: 17px;
    --hand-court-size: 44px;
    --hand-back-spade-size: 28px;
  }
}
@media (max-width: 880px) {
  .hand {
    --hand-card-w: 108px;
    --hand-card-h: 150px;
    --hand-card-step: 38px;
    --hand-card-radius: 11px;
    --hand-label-size: 27px;
    --hand-corner-size: 21px;
    --hand-pip-size: 24px;
    --hand-court-size: 60px;
    --hand-back-spade-size: 40px;
  }
}
@media (max-width: 700px) {
  .hand {
    --hand-card-w: 104px;
    --hand-card-h: 146px;
    --hand-card-step: 34px;
    --hand-label-size: 26px;
    --hand-corner-size: 20px;
  }
}
@media (max-width: 600px) {
  .hand {
    --hand-card-w: 100px;
    --hand-card-h: 140px;
    --hand-card-step: 30px;
    --hand-label-size: 24px;
    --hand-corner-size: 19px;
  }
}
@media (max-width: 480px) {
  .hand {
    --hand-card-w: 96px;
    --hand-card-h: 134px;
    --hand-card-step: 26px;
    --hand-label-size: 22px;
    --hand-corner-size: 18px;
  }
}
@media (max-width: 400px) {
  .hand {
    --hand-card-w: 92px;
    --hand-card-h: 128px;
    --hand-card-step: 22px;
    --hand-label-size: 20px;
    --hand-corner-size: 16px;
  }
}

/* 自己的手牌：利用牌桌横向空间放大牌面；
   左侧亮牌、右侧收牌区只占窄条，因此手牌可以明显大于其他家。 */
@media (min-width: 1000px) and (max-width: 1199px) {
  .hand.pos-S:not(.compact) {
    --hand-card-w: 112px;
    --hand-card-h: 157px;
    --hand-card-step: clamp(36px, 4vw, 46px);
    --hand-card-radius: 11px;
    --hand-label-size: 29px;
    --hand-corner-size: 23px;
    --hand-pip-size: 26px;
    --hand-court-size: 68px;
    --hand-back-spade-size: 45px;
  }
}
@media (min-width: 1200px) {
  .hand.pos-S:not(.compact) {
    --hand-card-w: 128px;
    --hand-card-h: 179px;
    --hand-card-step: clamp(48px, 4.8vw, 66px);
    --hand-card-radius: 13px;
    --hand-label-size: 33px;
    --hand-corner-size: 26px;
    --hand-pip-size: 29px;
    --hand-court-size: 76px;
    --hand-back-spade-size: 50px;
  }
}
@media (min-width: 1440px) {
  .hand.pos-S:not(.compact) {
    --hand-card-w: 140px;
    --hand-card-h: 195px;
    --hand-card-step: clamp(56px, 4.8vw, 74px);
    --hand-card-radius: 14px;
    --hand-label-size: 36px;
    --hand-corner-size: 28px;
    --hand-pip-size: 32px;
    --hand-court-size: 82px;
    --hand-back-spade-size: 54px;
  }
}
@media (min-width: 1600px) {
  .hand.pos-S:not(.compact) {
    --hand-card-w: 150px;
    --hand-card-h: 209px;
    --hand-card-step: clamp(56px, 4.8vw, 84px);
    --hand-label-size: 38px;
    --hand-corner-size: 30px;
    --hand-pip-size: 34px;
    --hand-court-size: 88px;
    --hand-back-spade-size: 58px;
  }
}
@media (min-width: 1800px) {
  .hand.pos-S:not(.compact) {
    --hand-card-w: 160px;
    --hand-card-h: 223px;
    --hand-card-step: clamp(56px, 4.8vw, 92px);
    --hand-label-size: 40px;
    --hand-corner-size: 32px;
    --hand-pip-size: 36px;
    --hand-court-size: 94px;
    --hand-back-spade-size: 62px;
  }
}
@media (min-width: 2000px) {
  .hand.pos-S:not(.compact) {
    --hand-card-w: 172px;
    --hand-card-h: 240px;
    --hand-card-step: clamp(56px, 4.8vw, 100px);
    --hand-label-size: 43px;
    --hand-corner-size: 34px;
    --hand-pip-size: 39px;
    --hand-court-size: 101px;
    --hand-back-spade-size: 67px;
  }
}

/* 矮屏（常见笔记本）优先保证整桌不滚动，手牌略收但仍大于原尺寸 */
@media (max-height: 860px) and (min-width: 1000px) {
  .hand.pos-S:not(.compact) {
    --hand-card-w: 120px;
    --hand-card-h: 167px;
    --hand-card-step: clamp(36px, 3.9vw, 64px);
    --hand-card-radius: 12px;
    --hand-label-size: 31px;
    --hand-corner-size: 24px;
    --hand-pip-size: 27px;
    --hand-court-size: 71px;
    --hand-back-spade-size: 47px;
  }
}
</style>

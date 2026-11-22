<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useGameStore } from '../store/game';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const store = useGameStore();
const text = ref('');
const error = ref('');
const success = ref('');
const dirty = ref(false);
let syncing = false;

function loadFromStore(): void {
  syncing = true;
  text.value = store.exportLightRuleJson();
  void nextTick(() => {
    dirty.value = false;
    syncing = false;
  });
}

const rule = computed(() => store.lightRuleRuntime.config);
const sourceText = computed(() => {
  const source = store.lightRuleRuntime.source;
  if (source === 'builtin') return '内置默认';
  if (source === 'local') return '本地持久化';
  return '管理员导入（本次运行）';
});

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return;
    loadFromStore();
    error.value = '';
    success.value = '';
  },
);

watch(text, () => {
  if (!syncing) dirty.value = true;
});

function apply(): void {
  const result = store.applyLightRule(text.value);
  if (!result.ok) {
    error.value = result.error ?? '规则应用失败';
    success.value = '';
    return;
  }
  error.value = '';
  success.value = `已热更新至 ${result.version}；后续推荐亮牌立即使用新规则。`;
  loadFromStore();
}

function restoreDefault(): void {
  const result = store.restoreDefaultLightRule();
  error.value = '';
  success.value = `已恢复内置默认 ${result.version}。`;
  loadFromStore();
}

function exportJson(): void {
  const blob = new Blob([store.exportLightRuleJson()], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gongzhu-light-rule-${rule.value.meta.version}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 延迟释放，避免部分浏览器在下载真正开始前就使 URL 失效。
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function importJson(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    text.value = String(reader.result ?? '');
    error.value = '';
    success.value = '已载入文件，请检查后点击“应用并热更新”。';
  };
  reader.readAsText(file);
  input.value = '';
}

function close(): void {
  emit('update:modelValue', false);
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="min(980px, 95vw)"
    align-center
    title="亮牌规则管理 · 热插拔"
    class="light-rule-dialog"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="lr-body">
      <div class="lr-status">
        <div>
          <span class="lr-label">当前版本</span>
          <strong>{{ rule.meta.version }}</strong>
          <span class="lr-name">{{ rule.meta.name ?? '未命名规则' }}</span>
        </div>
        <div>
          <span class="lr-label">来源</span>
          <strong>{{ sourceText }}</strong>
        </div>
        <div>
          <span class="lr-label">激活时间</span>
          <strong>{{ store.lightRuleRuntime.activatedAt ?? '—' }}</strong>
        </div>
        <div>
          <span class="lr-label">采样模式</span>
          <strong>{{ rule.sampling.mode === 'random' ? '随机采样' : '阈值直出' }}</strong>
        </div>
      </div>

      <p class="lr-tip">
        本面板仅面向系统管理员。规则严格对应
        <code>rules/拱猪亮牌规则_V1.0.md</code> 第 10 节参数；应用后立即替换内存中的激活规则，
        无需刷新页面。未填写的字段自动沿用内置 V1.0 默认值。
      </p>

      <div v-if="error" class="lr-alert lr-error">{{ error }}</div>
      <div v-if="success" class="lr-alert lr-success">{{ success }}</div>

      <div class="lr-toolbar">
        <el-button type="primary" :disabled="!dirty" @click="apply">应用并热更新</el-button>
        <el-button @click="restoreDefault">恢复内置默认</el-button>
        <el-button @click="exportJson">导出 JSON</el-button>
        <label class="lr-import">
          导入 JSON
          <input type="file" accept=".json,application/json,.txt" @change="importJson" />
        </label>
      </div>

      <textarea
        v-model="text"
        class="lr-editor"
        spellcheck="false"
        aria-label="亮牌规则 JSON"
      />

      <details class="lr-help">
        <summary>字段速查</summary>
        <ul>
          <li><code>meta.version / meta.s_ref</code>：规则版本与相对分值尺度。</li>
          <li><code>branches</code>：殉爆 / 绝境 / 冲锋 / 禁羊阈值。</li>
          <li><code>module_a</code>：相对分值基准概率与分支目标值。</li>
          <li><code>module_b</code>：张数、牌点、控牌、单张黑桃、零风险变压器。</li>
          <li><code>module_c</code>：满贯修正；默认关闭，启用时需提供可复现估算器。</li>
          <li><code>module_d</code>：阈值、单局上限、互斥系数。</li>
          <li><code>sampling.mode</code>：<code>random</code> 可复现随机采样；<code>threshold</code> 达到阈值即亮。</li>
          <li><code>game</code>：规则附带的默认对局参数；实际读秒与第四张自动亮仍以开始页设置为准。</li>
        </ul>
      </details>
    </div>

    <template #footer>
      <span class="lr-dirty">{{ dirty ? '有未应用的修改' : '规则已同步' }}</span>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.lr-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #3d5146;
  font-size: 12px;
}
.lr-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f4f6f1;
  border: 1px solid #e2e9df;
}
.lr-status > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.lr-label {
  color: #7a8a80;
  font-size: 10px;
  font-weight: 800;
}
.lr-status strong {
  color: #23382c;
  font-size: 13px;
  word-break: break-all;
}
.lr-name {
  color: #6b7a70;
  font-size: 11px;
}
.lr-tip {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff8e8;
  color: #7a5a00;
  line-height: 1.6;
}
.lr-tip code {
  background: rgba(0, 0, 0, 0.06);
  padding: 0 3px;
  border-radius: 3px;
}
.lr-alert {
  padding: 7px 10px;
  border-radius: 8px;
  font-weight: 700;
  line-height: 1.5;
}
.lr-error {
  background: #fdecec;
  color: #b83232;
  border: 1px solid #f3c6c6;
}
.lr-success {
  background: #eaf5ee;
  color: #1d6b45;
  border: 1px solid #c4e0d0;
}
.lr-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.lr-import {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 8px 15px;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #606266;
  font-size: 14px;
  cursor: pointer;
}
.lr-import:hover {
  border-color: #2f7d57;
  color: #2f7d57;
}
.lr-import input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.lr-editor {
  width: 100%;
  min-height: 340px;
  max-height: 52vh;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #cfdacb;
  background: #0f241a;
  color: #d8f0e2;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 11px;
  line-height: 1.55;
  resize: vertical;
  outline: none;
}
.lr-editor:focus {
  border-color: #2f7d57;
  box-shadow: 0 0 0 2px rgba(47, 125, 87, 0.2);
}
.lr-help {
  border-top: 1px dashed #dde5da;
  padding-top: 6px;
  color: #6b7a70;
}
.lr-help summary {
  cursor: pointer;
  color: #3d5146;
  font-weight: 700;
}
.lr-help ul {
  margin: 6px 0 0;
  padding-left: 18px;
  line-height: 1.65;
}
.lr-help code {
  color: #1d6b45;
  background: #eef4ef;
  padding: 0 3px;
  border-radius: 3px;
}
.lr-dirty {
  margin-right: auto;
  color: #8a9a90;
  font-size: 11px;
}
</style>

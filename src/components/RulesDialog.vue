<script setup lang="ts">
import { useGameStore } from '../store/game';

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const store = useGameStore();

function close(): void {
  emit('update:modelValue', false);
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="min(920px, 94vw)"
    align-center
    class="rules-dialog"
    title="拱猪 · 对家双人队赛规则"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="rules-body">
      <section>
        <h3>一、赛制与座位</h3>
        <ul>
          <li>固定 4 座：南、北一队（A队），东、西一队（B队），2v2 对家赛。</li>
          <li>出牌顺序逆时针：南 → 东 → 北 → 西。</li>
          <li>5 局制 / 8 局制。小分只用于触发画猪头；最终比较双方总猪头，少者获胜。</li>
        </ul>
      </section>

      <section>
        <h3>二、发牌与领出</h3>
        <ul>
          <li>52 张牌，无大小王，随机洗牌后每人 13 张。</li>
          <li>每局第一副：持 ♣2 的玩家领出，且首引必须出 ♣2。</li>
          <li>局内后续副牌：上一副拿到 ♠Q 猪的玩家领出，花色不限。</li>
          <li>满贯或画猪头后本局结束；新局第一副重新按 ♣2 规则。</li>
        </ul>
      </section>

      <section>
        <h3>三、亮牌</h3>
        <ul>
          <li>可亮四张：♠Q 猪、♦J 羊、♣10 变压器、♥A 红桃A；允许同时亮多张。</li>
          <li>亮牌提交后即在该座位旁正面公开供所有人查看；提交前只显示提交状态。</li>
          <li>提交后不可撤回；超时未提交视为不亮。</li>
          <li>自动亮：已亮 3 张时，若开启自动亮，剩余 1 张由服务端在全员提交/截止后自动亮，并立即揭晓。</li>
          <li>首轮限制：每副牌中某花色第一次作为领出花色的一墩，该花色中被亮过的牌不能领出、不能跟牌；该墩结算后解除。</li>
          <li>例外：跟牌时若该花色只剩受限制亮牌，必须出；领出时若手中只剩受限制亮牌，兜底允许任选一张领出。</li>
        </ul>
      </section>

      <section>
        <h3>四、出牌与收墩</h3>
        <ul>
          <li>一墩 4 张，共 13 墩；有领出花色必须跟同花色，缺门可任意垫牌。</li>
          <li>同花色点数最大者赢墩（A &gt; K &gt; Q &gt; J &gt; 10 &gt; … &gt; 2），无将牌。</li>
          <li>赢墩者收下本墩所有分牌，并获得下一墩领出权。</li>
          <li>一墩分牌归赢墩个人；结算时先算个人分，再相加为团队小分。</li>
          <li>操作：单击合法牌使其向上弹出，再次单击收回；右键单击合法牌或双击合法牌直接出牌。当前出牌方和推荐出牌用闪烁箭头标出。</li>
        </ul>
      </section>

      <section>
        <h3>五、基础分值</h3>
        <table class="rule-table">
          <thead>
            <tr><th>牌</th><th>基础分</th><th>亮牌后</th></tr>
          </thead>
          <tbody>
            <tr><td>♠Q 猪</td><td>-100</td><td>-200（亮猪者自收 -400 窝猪）</td></tr>
            <tr><td>♦J 羊</td><td>+100</td><td>+200</td></tr>
            <tr><td>♣10 变压器</td><td>独拿 +50</td><td>独拿 +100；非独拿 ×2 / ×4</td></tr>
            <tr><td>♥A</td><td>-50</td><td>该玩家红桃分值 ×2（含♥A自身）</td></tr>
            <tr><td>♥K / ♥Q / ♥J</td><td>-40 / -30 / -20</td><td>受亮♥A倍率</td></tr>
            <tr><td>♥10 ~ ♥5</td><td>各 -10</td><td>受亮♥A倍率</td></tr>
            <tr><td>♥4 ~ ♥2</td><td>0</td><td>0（仍属红桃/计分牌）</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>六、计分顺序（不可调换）</h3>
        <ol>
          <li>统计四人实际收牌。</li>
          <li>判满贯：单个玩家集齐猪、羊、变压器、全部 13 张红桃 → 本队立即赢下本局，不结算普通小分。</li>
          <li>亮牌修正：亮猪 -200、亮羊 +200；亮♥A使收下♥A的玩家红桃分值 ×2。</li>
          <li>全红：单个玩家收齐 13 张红桃，红桃总分反转（-200 → +200；亮♥A则 -400 → +400）。</li>
          <li>窝猪：亮猪者本人最终自收 ♠Q，猪分直接记 -400（自动亮猪自收同样算窝猪）。</li>
          <li>变压器：独拿 +50/+100；非独拿对修正后非零总分 ×2/×4；总分为 0 时仍为 0。</li>
          <li>团队本副小分 = 南分 + 北分（A队）或 东分 + 西分（B队），累加到本局小分。</li>
        </ol>
      </section>

      <section>
        <h3>七、满贯</h3>
        <ul>
          <li>满贯在整副牌结算时判定，依据本副最终收牌归属，必须个人拿齐，不支持合满贯。</li>
          <li>满贯优先于普通阈值：本队立即赢下本局，不触发窝猪，不再检查小分阈值。</li>
          <li>给对方画猪头：非全亮 1 头；触发满贯的该副四张关键牌全亮（含自动亮）则 2 头。</li>
          <li>满贯时不生成正式普通个人分，仅生成用于展示/复盘的模拟展示分。</li>
        </ul>
      </section>

      <section>
        <h3>八、画猪头（6.2）</h3>
        <p class="rule-note">正分阈值是进攻：某队小分达到 +1000，由对方被画头；负分阈值是防守：某队小分达到 -1000，本队被画头。</p>
        <table class="rule-table">
          <thead>
            <tr><th>触发条件</th><th>被画头方</th><th>本局胜者</th></tr>
          </thead>
          <tbody>
            <tr><td>仅 A ≤ -1000</td><td>A 画 1 头</td><td>B</td></tr>
            <tr><td>仅 A ≥ +1000</td><td>B 画 2 头</td><td>A</td></tr>
            <tr><td>仅 B ≤ -1000</td><td>B 画 1 头</td><td>A</td></tr>
            <tr><td>仅 B ≥ +1000</td><td>A 画 2 头</td><td>B</td></tr>
            <tr><td>A ≤ -1000 且 B ≥ +1000</td><td>A 画 3 头</td><td>B</td></tr>
            <tr><td>A ≥ +1000 且 B ≤ -1000</td><td>B 画 3 头</td><td>A</td></tr>
            <tr><td>双方均 ≥ +1000</td><td>各画 2 头</td><td>按小分裁决</td></tr>
            <tr><td>双方均 ≤ -1000</td><td>各画 1 头</td><td>按小分裁决</td></tr>
          </tbody>
        </table>
        <ul>
          <li>新增猪头相同时：比较本局小分，小分更低（更负）的一方为本局负者；小分也相同则判和。</li>
          <li>单局副数上限默认 20 副；达到上限仍未画头，小分更低方被画 1 头；小分相同各画 1 头并判和。</li>
        </ul>
      </section>

      <section>
        <h3>九、盘终裁决</h3>
        <ul>
          <li>5 局制：5 局后总猪头少者胜；相同则进入突然死亡加赛，每加赛 1 局比较总猪头，少者立即获胜。</li>
          <li>8 局制：8 局后总猪头少者胜；相同则最后一局新增猪头多者负；仍相同按 6.4 小分裁决；再相同则向前回溯最近一局有胜负的局，该局负者负。</li>
          <li>UI 在盘终展示最终裁决依据，不只显示胜负。</li>
        </ul>
      </section>

      <section>
        <h3>十、信息与审计</h3>
        <ul>
          <li>出牌阶段只可见自己的剩余手牌、当前合法出牌集合、各家剩余牌数、当前墩与历史出牌记录；不能获取他人手牌。</li>
          <li>亮牌提交后即可看到具体牌种；自动亮在判定后公开，未判定前不计入“已亮 N 张”展示。</li>
          <li>每副牌记录洗牌算法版本、随机种子、发牌哈希，支持按种子重放验证。</li>
          <li>超时自动出牌与断线 AI 接管均会在界面标记；AI 与真人使用同一信息边界。</li>
        </ul>
      </section>

      <section v-if="store.auditInfo" class="audit-section">
        <h3>本副审计信息</h3>
        <div class="audit-grid">
          <span>种子</span><code>{{ store.auditInfo.seed }}</code>
          <span>洗牌算法</span><code>{{ store.auditInfo.algorithmVersion }}</code>
          <span>随机数算法</span><code>{{ store.auditInfo.rngVersion }}</code>
          <span>牌堆哈希</span><code>{{ store.auditInfo.deckHash }}</code>
          <span>发牌哈希</span><code>{{ store.auditInfo.dealHash }}</code>
          <span>公开时机</span><code>{{ store.auditInfo.revealedAt ?? '未揭晓' }}</code>
        </div>
      </section>
    </div>

    <template #footer>
      <el-button type="primary" @click="close">知道了</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rules-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 70vh;
  overflow-y: auto;
  padding-right: 6px;
  color: #3d5146;
  font-size: 12px;
  line-height: 1.65;
}
.rules-body section {
  padding: 10px 14px;
  border-radius: 10px;
  background: #fbfcf8;
  border: 1px solid #e2e9df;
}
.rules-body h3 {
  margin: 0 0 5px;
  color: #23382c;
  font-size: 14px;
  border-left: 3px solid #2f7d57;
  padding-left: 8px;
}
.rules-body ul,
.rules-body ol {
  margin: 0;
  padding-left: 18px;
}
.rules-body li {
  margin: 2px 0;
}
.rule-note {
  margin: 0 0 6px;
  padding: 5px 8px;
  border-radius: 6px;
  background: #fff8e8;
  color: #7a5a00;
}
.rule-table {
  width: 100%;
  margin: 5px 0;
  border-collapse: collapse;
  font-size: 11px;
}
.rule-table th,
.rule-table td {
  padding: 4px 7px;
  border: 1px solid #e0e7dd;
  text-align: left;
}
.rule-table th {
  background: #f1f4ee;
  color: #5c6c62;
  font-size: 10px;
  font-weight: 800;
}
.audit-section {
  background: #f4f6f1 !important;
}
.audit-grid {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 3px 10px;
  font-size: 11px;
}
.audit-grid span {
  color: #7a8a80;
  font-weight: 700;
}
.audit-grid code {
  color: #3d5146;
  word-break: break-all;
}
</style>

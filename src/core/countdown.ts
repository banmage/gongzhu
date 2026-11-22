/** 最后 N 秒进入读秒：显示倒计时并语音播报；不足 N 秒则从实际秒数开始 */
export const FINAL_COUNTDOWN_SECONDS = 10;

/** 当前剩余秒数是否处于读秒区间（不含 0） */
export function isFinalCountdown(seconds: number): boolean {
  return seconds > 0 && seconds <= FINAL_COUNTDOWN_SECONDS;
}

/** 用浏览器语音合成播报当前秒数；环境不支持时静默跳过 */
export function speakCountdown(seconds: number): void {
  if (!isFinalCountdown(seconds)) return;
  const synth = typeof globalThis === 'undefined' ? undefined : globalThis.speechSynthesis;
  const Utterance = typeof globalThis === 'undefined' ? undefined : globalThis.SpeechSynthesisUtterance;
  if (!synth || typeof synth.speak !== 'function' || typeof Utterance !== 'function') return;
  try {
    // 只保留最新一秒，避免语音在队列里越积越慢
    synth.cancel();
    const utterance = new Utterance(String(seconds));
    utterance.lang = 'zh-CN';
    utterance.rate = 1.2;
    utterance.pitch = 1;
    utterance.volume = 1;
    synth.speak(utterance);
  } catch {
    // 浏览器可能因自动播放策略拒绝语音，读秒展示不受影响
  }
}

/** 停止尚未播完的读秒语音 */
export function cancelCountdownSpeech(): void {
  const synth = typeof globalThis === 'undefined' ? undefined : globalThis.speechSynthesis;
  if (!synth || typeof synth.cancel !== 'function') return;
  try {
    synth.cancel();
  } catch {
    // 忽略浏览器差异
  }
}

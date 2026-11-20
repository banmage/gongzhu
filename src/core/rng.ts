/**
 * 可复现的伪随机数生成器（mulberry32）。
 * 同一 seed 产生同一序列，用于发牌审计与重放验证。
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return ((Date.now() >>> 0) ^ (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0;
}

/** FNV-1a 32 位哈希，用于发牌结果审计 */
export function hashNumbers(values: number[]): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >>> 16) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

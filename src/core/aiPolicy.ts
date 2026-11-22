import {
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  baseHeartValue,
  getRank,
  getSuit,
  isScoringCard,
} from '../models/card';
import {
  ALL_POSITIONS,
  teamOf,
  type CardPlay,
  type Position,
} from '../models/game';
import { hashSeed, type PlayObservation } from './aiObservation';
import { type PublicKnowledge } from './aiKnowledge';
import {
  estimateTrickWinnerProbabilities,
  type SeatThreat,
  type ThreatModel,
  hasMode,
} from './aiThreat';

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function effectiveHeartValue(card: number, knowledge: PublicKnowledge): number {
  const base = baseHeartValue(card);
  return knowledge.litCards.includes(HEART_A) ? base * 2 : base;
}

/** 牌进入收牌区时对团队的粗略价值（不含未来全红/满贯的结构性价值）。 */
export function effectiveCardPoints(card: number, knowledge: PublicKnowledge): number {
  if (card === PIG) return knowledge.litCards.includes(PIG) ? -200 : -100;
  if (card === SHEEP) return knowledge.litCards.includes(SHEEP) ? 200 : 100;
  if (card === TRANSFORMER) return 0;
  return effectiveHeartValue(card, knowledge);
}

function isOwnTeam(pos: Position, obs: PlayObservation): boolean {
  return teamOf(pos) === obs.team;
}

function bestAllRedTarget(
  seats: Position[],
  threat: ThreatModel,
  minProbability: number,
): Position | null {
  let target: Position | null = null;
  let best = minProbability;
  for (const pos of seats) {
    const probability = threat.seat[pos].pAllRed;
    if (probability > best) {
      best = probability;
      target = pos;
    }
  }
  return target;
}

/**
 * 概率可能仍低，但已收红桃进度已经很高时，找出最接近全红的一家。
 * 只在其他家尚未收红桃时成立（否则全红已不可能）。
 */
function bestAllRedProgressTarget(
  seats: Position[],
  threat: ThreatModel,
  minProgress: number,
): Position | null {
  let target: Position | null = null;
  let best = minProgress;
  for (const pos of seats) {
    const otherHasHearts = ALL_POSITIONS.some(
      (other) => other !== pos && threat.seat[other].confirmed.hearts > 0,
    );
    if (otherHasHearts) continue;
    const progress = threat.seat[pos].confirmed.hearts / 13;
    if (progress > best) {
      best = progress;
      target = pos;
    }
  }
  return target;
}

/**
 * 某个座位的全红压力。
 *
 * 全红是“个人收齐 13 张红桃”的结构性事件：只要其他任何一家已经收过红桃，
 * 该家的全红就已经不可能，不能再拿“已收红桃进度”当作威胁或保护对象。
 * 因此这里把“其他家已收红桃”的硬事实纳入压力计算。
 */
function allRedPressure(threat: ThreatModel, pos: Position): number {
  const otherHasHearts = ALL_POSITIONS.some(
    (other) => other !== pos && threat.seat[other].confirmed.hearts > 0,
  );
  if (otherHasHearts) return 0;
  return Math.max(threat.seat[pos].pAllRed, threat.seat[pos].confirmed.hearts / 13);
}

function bestSlamTarget(
  seats: Position[],
  threat: ThreatModel,
  minProbability: number,
): Position | null {
  let target: Position | null = null;
  let best = minProbability;
  for (const pos of seats) {
    const probability = threat.seat[pos].pGrandSlam;
    if (probability > best) {
      best = probability;
      target = pos;
    }
  }
  return target;
}

function seatThreat(threat: ThreatModel, pos: Position): SeatThreat {
  return threat.seat[pos];
}

/**
 * 一张牌被某个座位收下时，对己方团队的结构性价值。
 * 这是“概率层”进入候选评分的主要入口：全红、满贯、猪、羊、变压器陷阱
 * 都通过“谁收下这张牌”影响价值，而不是只看本墩基础分。
 */
export function cardThreatValue(
  card: number,
  collector: Position,
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
): number {
  const ownSeats = ALL_POSITIONS.filter((pos) => isOwnTeam(pos, obs));
  const oppSeats = ALL_POSITIONS.filter((pos) => !isOwnTeam(pos, obs));
  const ownAllRed = bestAllRedTarget(ownSeats, threat, 0.2) ??
    (hasMode(threat, 'own-allred') || hasMode(threat, 'partner-allred')
      ? bestAllRedProgressTarget(ownSeats, threat, 0.55)
      : null);
  const oppAllRed = bestAllRedTarget(oppSeats, threat, 0.2) ??
    (hasMode(threat, 'break-opp-allred')
      ? bestAllRedProgressTarget(oppSeats, threat, 0.55)
      : null);
  const ownSlam = bestSlamTarget(ownSeats, threat, 0.2);
  const oppSlam = bestSlamTarget(oppSeats, threat, 0.2);
  const own = isOwnTeam(collector, obs);
  const collectorThreat = seatThreat(threat, collector);
  const partnerThreat = seatThreat(threat, obs.partner);
  const selfThreat = seatThreat(threat, obs.self);

  let value = 0;

  if (getSuit(card) === 2) {
    const points = effectiveHeartValue(card, knowledge);
    const magnitude = Math.abs(points);
    const ownAllRedPressure = ownAllRed ? allRedPressure(threat, ownAllRed) : 0;
    const oppAllRedPressure = oppAllRed ? allRedPressure(threat, oppAllRed) : 0;

    if (collector === ownAllRed) {
      // 全红会反转红桃：己方目标收红桃从“负分”变成最有价值的正分材料。
      value += magnitude * (0.8 + 1.4 * ownAllRedPressure);
    } else if (collector === oppAllRed) {
      value -= magnitude * (0.8 + 1.4 * oppAllRedPressure);
    } else {
      // 普通情况红桃对收牌者是负分；己方收为负价值，敌方收为正价值。
      value += own ? -magnitude * 0.62 : magnitude * 0.62;

      // 破敌方全红的价值会随敌方压力上升，同时降低“保住己方全红”的权重。
      // 只要有一张红桃落到非目标家，敌方全红就被结构性破坏，因此这里除了
      // 按牌面点数计价，还要加一笔与点数无关的结构性收益/损失。
      const breakEnemyFactor = 1 - 0.7 * oppAllRedPressure;

      // 己方全红目标未收到红桃：任何红桃落到“其他家”手里都会直接破掉己方全红。
      // 自己吃进红桃不在此列：有时正是为了替搭档挡变压器，或主动破坏敌方全红。
      if (ownAllRed) {
        value -= magnitude * (0.8 + 2.5 * ownAllRedPressure) * breakEnemyFactor;
        if (!isOwnTeam(collector, obs)) {
          value -= 80 * ownAllRedPressure * breakEnemyFactor;
        }
      }

      // 敌方全红目标未收到红桃：任何人截胡都在破坏敌方全红。
      if (oppAllRed) {
        value += magnitude * 1.0 * oppAllRedPressure;
        value += 80 * oppAllRedPressure;
      }

      // 同伴尚未被证实放弃全红（概率不为 0）时，即使还没到 0.2 的强目标阈值，
      // 也不要把红桃轻易送给其他人：送给同伴是继续喂牌，送给别人则是在拆同伴的牌。
      // 若敌方全红威胁更高，则优先破坏敌方，保留系数随敌方压力下降。
      const partnerPotential = allRedPressure(threat, obs.partner);
      const selfPotential = allRedPressure(threat, obs.self);
      if (
        !ownAllRed &&
        partnerPotential > 0 &&
        partnerPotential >= selfPotential
      ) {
        const preserveWeight =
          (0.6 + 1.4 * Math.sqrt(partnerPotential)) * breakEnemyFactor;
        if (collector === obs.partner) {
          value += magnitude * preserveWeight;
        } else if (!isOwnTeam(collector, obs)) {
          // 只有把红桃送给“其他家”才会破坏同伴的全红；自己吃进是最后手段。
          value -= magnitude * preserveWeight;
          value -= 80 * partnerPotential * breakEnemyFactor;
        }
      }
    }

    if (collector === ownSlam) value += 5 * collectorThreat.pGrandSlam;
    if (collector === oppSlam) value -= 9 * collectorThreat.pGrandSlam;
    if (oppSlam && collector !== oppSlam) {
      value += (own ? 80 : 30) * seatThreat(threat, oppSlam).pGrandSlam;
    }
    if (ownSlam && collector !== ownSlam) {
      value -= (own ? 24 : 18) * seatThreat(threat, ownSlam).pGrandSlam;
    }
    // 敌方已收三张关键牌或八张以上红桃时，概率可能仍低，但任何一张红桃
    // 落到敌方都会显著推进满贯/全红；反之落到己方就是直接破坏。
    if (hasMode(threat, 'break-opp-slam')) {
      const pressure = Math.max(
        threat.opp.pGrandSlamAny,
        threat.opp.maxGrandSlamProgress * 0.8,
      );
      value += (own ? 26 : -26) * pressure;
    }
    if (hasMode(threat, 'break-opp-allred')) {
      const pressure = Math.max(
        threat.opp.pAllRedAny,
        threat.opp.maxAllRedProgress * 0.9,
      );
      value += (own ? 20 : -20) * pressure;
    }
    if (hasMode(threat, 'protect-transformer') && collector === obs.partner) {
      const multiplier = knowledge.litCards.includes(TRANSFORMER) ? 4 : 2;
      value -= Math.abs(points) * (multiplier - 1) * collectorThreat.pTransformerNegative;
    }
    return value;
  }

  if (card === PIG) {
    if (collector === ownSlam) {
      value += 40 * collectorThreat.pGrandSlam;
    } else if (collector === oppSlam) {
      value -= 48 * collectorThreat.pGrandSlam;
    } else {
      value += own ? -95 : 95;
      if (ownSlam && collector !== ownSlam) value -= 22 * seatThreat(threat, ownSlam).pGrandSlam;
      if (oppSlam && collector !== oppSlam) value += 32 * seatThreat(threat, oppSlam).pGrandSlam;
    }
    if (hasMode(threat, 'pig-evade') && own) value -= 22;
    if (hasMode(threat, 'pig-maintain') && !own) value += 16;
    if (hasMode(threat, 'protect-transformer') && collector === obs.partner) {
      const multiplier = knowledge.litCards.includes(TRANSFORMER) ? 4 : 2;
      value -= (knowledge.litCards.includes(PIG) ? 200 : 100) *
        (multiplier - 1) *
        collectorThreat.pTransformerNegative;
    }
    if (hasMode(threat, 'exploit-transformer') && !own) {
      value += 14 * collectorThreat.pTransformerNegative;
    }
    return value;
  }

  if (card === SHEEP) {
    if (collector === ownSlam) value += 24 * collectorThreat.pGrandSlam;
    else if (collector === oppSlam) value -= 34 * collectorThreat.pGrandSlam;
    else {
      value += own ? 95 : -95;
      if (ownSlam && collector !== ownSlam) value -= 14 * seatThreat(threat, ownSlam).pGrandSlam;
      if (oppSlam && collector !== oppSlam) value += 20 * seatThreat(threat, oppSlam).pGrandSlam;
    }
    if (hasMode(threat, 'sheep-contest') && own) value += 12;
    return value;
  }

  if (card === TRANSFORMER) {
    const transformerProbability = Math.max(collectorThreat.pTransformer, 0.01);
    const negativeProbability = clamp(
      collectorThreat.pTransformerNegative / transformerProbability,
      0,
      1,
    );
    if (own) {
      value += (1 - negativeProbability) * 62 - negativeProbability * 125;
    } else {
      value += negativeProbability * 125 - (1 - negativeProbability) * 62;
    }
    if (collector === ownSlam) value += 26 * collectorThreat.pGrandSlam;
    if (collector === oppSlam) value -= 30 * collectorThreat.pGrandSlam;
    if (ownSlam && collector !== ownSlam) value -= 16 * seatThreat(threat, ownSlam).pGrandSlam;
    if (oppSlam && collector !== oppSlam) value += 22 * seatThreat(threat, oppSlam).pGrandSlam;
    if (hasMode(threat, 'protect-transformer') && collector === obs.partner) {
      value -= 20 * collectorThreat.pTransformerNegative;
    }
    if (hasMode(threat, 'exploit-transformer') && !own) {
      value += 18 * collectorThreat.pTransformerNegative;
    }
    return value;
  }

  return value;
}

function expectedTrickTeamValue(
  points: number,
  pWin: Record<Position, number>,
  obs: PlayObservation,
): number {
  let value = 0;
  for (const pos of ALL_POSITIONS) {
    const probability = pWin[pos];
    if (probability <= 0) continue;
    const sign = isOwnTeam(pos, obs) ? 1 : -1;
    value += probability * sign * points;
  }
  return value;
}

function expectedTrickThreatValue(
  trickCards: number[],
  pWin: Record<Position, number>,
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
): number {
  let value = 0;
  for (const pos of ALL_POSITIONS) {
    const probability = pWin[pos];
    if (probability <= 0) continue;
    for (const card of trickCards) {
      value += probability * cardThreatValue(card, pos, obs, knowledge, threat);
    }
  }
  return value;
}

/**
 * 残局牌张保留原则：
 * - 只剩高价值正分目标（羊、正向变压器）时，尽量留大牌去争；
 * - 只剩高风险负值（亮猪、负向变压器）时，尽量留小牌，优先脱手大牌。
 */
export function endgameRetentionScore(
  card: number,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
  trickPoints: number,
  candidateWins: boolean,
): number {
  const remaining = threat.remaining;
  const highCard = getRank(card) >= 9;
  const isTargetCard = card === SHEEP || card === TRANSFORMER;
  let value = 0;

  // 破敌方满贯/全红时，红桃是“必须现在处理”的牌，不再套用留牌原则。
  if (
    getSuit(card) === 2 &&
    (hasMode(threat, 'break-opp-slam') || hasMode(threat, 'break-opp-allred'))
  ) {
    return 0;
  }

  if (remaining.highValueEndgame) {
    if (highCard) {
      if (!candidateWins || trickPoints <= 0) value -= 8;
    } else {
      value += 2;
    }
    if (isTargetCard && candidateWins && trickPoints >= 0) value += 7;
  } else if (remaining.highRiskEndgame) {
    if (highCard) {
      value += candidateWins && trickPoints < 0 ? -4 : 7;
    } else {
      value -= 3;
    }
    if (isTargetCard && !candidateWins) value += 4;
    if (isTargetCard && candidateWins && trickPoints < 0) value -= 6;
  }

  return value;
}

function leadSafety(
  card: number,
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
): number {
  let value = 0;
  const ownSlam = bestSlamTarget(
    ALL_POSITIONS.filter((pos) => isOwnTeam(pos, obs)),
    threat,
    0.2,
  );

  if (card === PIG) {
    value -= 70;
    if (ownSlam && !threat.seat[ownSlam].confirmed.pig) {
      value += 18 * threat.seat[ownSlam].pGrandSlam;
    }
  }
  if (card === TRANSFORMER) value -= 24;
  if (card === SHEEP) value -= 5;

  if (getSuit(card) === 2) {
    const slamPressure = Math.max(
      threat.opp.pGrandSlamAny,
      threat.opp.maxGrandSlamProgress * 0.8,
    );
    const allRedPressure = Math.max(
      threat.opp.pAllRedAny,
      threat.opp.maxAllRedProgress * 0.9,
    );
    value -= 14;
    value += 12 * allRedPressure;
    value += 10 * slamPressure;
    if (hasMode(threat, 'break-opp-slam')) value += 28 * slamPressure;
    if (hasMode(threat, 'break-opp-allred')) value += 22 * allRedPressure;
    if (hasMode(threat, 'partner-allred')) {
      value += 24 * threat.seat[obs.partner].pAllRed;
    }
    if (hasMode(threat, 'own-allred')) {
      value += 16 * threat.seat[obs.self].pAllRed;
    }
  }

  if (getSuit(card) === 3 && threat.remaining.pigRemaining) {
    value -= 7;
    if (hasMode(threat, 'pig-evade')) value -= 12;
    if (hasMode(threat, 'pig-maintain')) value += 6;
  }

  if (!isScoringCard(card)) {
    value += (12 - getRank(card)) * 0.42;
  }
  if (knowledge.litCards.includes(card)) {
    // 已亮的牌主动领出会提前暴露/浪费首轮限制价值。
    value -= 4;
  }

  return value;
}

function followSafety(
  card: number,
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
  points: number,
  partnerWinning: boolean,
  opponentWinning: boolean,
): number {
  let value = 0;
  const pointsValue = effectiveCardPoints(card, knowledge);
  const hasLeadSuit =
    knowledge.currentTrick.leadSuit !== null &&
    knowledge.ownHand.some((held) => getSuit(held) === knowledge.currentTrick.leadSuit);

  const breakAllRed = hasMode(threat, 'break-opp-allred') || hasMode(threat, 'break-opp-slam');
  const partnerAllRedPotential = allRedPressure(threat, obs.partner);

  if (!hasLeadSuit) {
    if (partnerWinning && pointsValue < 0) {
      // 同伴仍有全红可能时，红桃优先喂给同伴；只有同伴已彻底放弃全红才按普通负分处理。
      if (hasMode(threat, 'partner-allred') || partnerAllRedPotential > 0) value += 18;
      else value -= 18;
    }
    if (opponentWinning && pointsValue < 0) {
      const oppSeats = ALL_POSITIONS.filter((pos) => !isOwnTeam(pos, obs));
      const oppAllRedTarget =
        bestAllRedTarget(oppSeats, threat, 0.2) ??
        (hasMode(threat, 'break-opp-allred')
          ? bestAllRedProgressTarget(oppSeats, threat, 0.55)
          : null);
      if (oppAllRedTarget === knowledge.currentWinner) {
        // 不能把红桃直接喂给正在冲全红的敌方。
        value -= 18;
      } else if (breakAllRed) {
        // 给非目标敌方红桃，直接破坏敌方全红/满贯。
        value += 12;
      } else if (partnerAllRedPotential > 0) {
        // 同伴仍可能全红，给其他人红桃会拆掉同伴的全红。
        value -= 12;
      } else {
        value += 12;
      }
    }
    if (partnerWinning && pointsValue > 0) value += 5;
    if (opponentWinning && pointsValue > 0) value -= 9;
  }

  if (partnerWinning && getSuit(card) === 2) {
    const partnerThreat = threat.seat[obs.partner];
    const partnerAllRed = hasMode(threat, 'partner-allred')
      ? Math.max(partnerThreat.pAllRed, partnerThreat.confirmed.hearts / 13)
      : partnerThreat.pAllRed;
    if (partnerAllRed > 0.4) value += 16 * partnerAllRed;
    if (partnerThreat.pTransformerNegative > 0.4 && points < 0) {
      value -= 12 * partnerThreat.pTransformerNegative;
    }
  }

  if (getSuit(card) === 2) {
    const slamPressure = Math.max(
      threat.opp.pGrandSlamAny,
      threat.opp.maxGrandSlamProgress * 0.8,
    );
    const allRedPressure = Math.max(
      threat.opp.pAllRedAny,
      threat.opp.maxAllRedProgress * 0.9,
    );
    value += 6 * allRedPressure;
    value += 5 * slamPressure;
    if (hasMode(threat, 'break-opp-slam')) {
      value += 10 * slamPressure;
    }
    if (hasMode(threat, 'break-opp-allred')) {
      value += 9 * allRedPressure;
    }
  }

  return value;
}

/**
 * ♥A 处置策略。
 *
 * 手持 ♥A + 少量小牌时，自己收全红的概率很低；♥A 留在手里既可能被逼着吃下
 * 整圈大红桃，也会让敌方保留收齐红桃的机会。因此：
 * - 能垫给同伴（且同伴没有负向变压器）时优先垫给同伴；
 * - 同伴仍有全红可能时，不把 ♥A 垫给其他家，也不主动领出；
 * - 只有敌方全红压力明显更高时，才把 ♥A 当作“破敌红”的代价；
 * - 没有垫牌机会且没有上述冲突时，在前期主动用 ♥A 落墩，把损失封顶并剥夺敌方的 ♥A。
 */
function heartADisposalValue(
  card: number,
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
  pWin: Record<Position, number>,
): number {
  if (card !== HEART_A || !hasMode(threat, 'heart-a-disposal')) return 0;
  if (hasMode(threat, 'own-allred') || hasMode(threat, 'own-slam')) return 0;

  const partner = obs.partner;
  const partnerThreat = threat.seat[partner];
  const partnerNegative = partnerThreat.pTransformerNegative;
  const currentWinner = knowledge.currentWinner;
  const hasPlays = knowledge.currentTrick.plays.length > 0;
  const offSuit = hasPlays && knowledge.currentLeadSuit !== 2;
  // 亮 ♥A 会让红桃分翻倍，处置收益也应按实际分值放大。
  const heartAValue = Math.abs(effectiveHeartValue(HEART_A, knowledge));
  const valueScale = heartAValue / 50;
  const partnerPotential = allRedPressure(threat, partner);
  const selfPotential = allRedPressure(threat, obs.self);
  const oppAllRedPressure = ALL_POSITIONS
    .filter((pos) => !isOwnTeam(pos, obs))
    .reduce((best, pos) => Math.max(best, allRedPressure(threat, pos)), 0);

  if (offSuit) {
    if (currentWinner === partner) {
      // 同伴已有负向变压器时，把 ♥A 塞给同伴会被放大，宁可自己留着找别的时机。
      // 非负向变压器时，♥A 的负分在 trickValue / threatValue 中会被重复计价，
      // 这里补回这部分并加上“尽早脱手、剥夺敌方 ♥A”的风险溢价。
      return partnerNegative >= 0.4 ? -30 * valueScale : 115 * valueScale;
    }
    if (currentWinner !== null && !isOwnTeam(currentWinner, obs)) {
      const oppSeats = ALL_POSITIONS.filter((pos) => !isOwnTeam(pos, obs));
      const allRedTarget =
        bestAllRedTarget(oppSeats, threat, 0.2) ??
        (hasMode(threat, 'break-opp-allred')
          ? bestAllRedProgressTarget(oppSeats, threat, 0.55)
          : null);
      const slamTarget = bestSlamTarget(oppSeats, threat, 0.2);
      // 不能把 ♥A 直接喂给正在冲全红/满贯的敌方。
      if (currentWinner === allRedTarget || currentWinner === slamTarget) return -40 * valueScale;

      // 把 ♥A 垫给非目标敌方，同样会直接破掉同伴的全红。
      // 只有敌方全红压力更高时，才值得用同伴的全红去换“破敌红”。
      if (partnerPotential > 0 && partnerPotential >= selfPotential) {
        return (-30 - 60 * partnerPotential + 80 * oppAllRedPressure) * valueScale;
      }
      return 18 * valueScale;
    }
    return 0;
  }

  if (!hasPlays) {
    // 同伴仍有全红可能时，♥A 领出会被自己收下，直接破掉同伴的全红。
    // 只有在敌方全红压力明显更高时，才主动吃进红桃破坏敌方。
    if (
      hasMode(threat, 'partner-allred') ||
      hasMode(threat, 'partner-slam') ||
      (partnerPotential > 0 && partnerPotential >= selfPotential)
    ) {
      return (-20 - 60 * partnerPotential + 80 * oppAllRedPressure) * valueScale;
    }
    if (partnerThreat.confirmed.hearts >= 12 && partnerNegative < 0.4) return -25 * valueScale;

    // 前期落 ♥A 的收益：把负分损失封顶，避免后期被逼吃整圈大牌；
    // 同时 ♥A 只要被自己收下，敌方就不可能再收齐 13 张红桃。
    const early = Math.max(0, 4 - knowledge.tricksPlayed);
    const futureRisk = Math.max(0, threat.remaining.bigHeartsValue - heartAValue);
    const opponentPressure =
      hasMode(threat, 'break-opp-allred') || hasMode(threat, 'break-opp-slam');
    return 88 * valueScale + early * 4 + Math.min(20, futureRisk * 0.2) + (opponentPressure ? 12 * valueScale : 0);
  }

  // 红桃领出时，若敌方当前赢墩，♥A 吃入可以截断敌方的红桃。
  if (
    currentWinner !== null &&
    !isOwnTeam(currentWinner, obs) &&
    pWin[obs.self] >= 0.45
  ) {
    return 10 * valueScale;
  }
  return 0;
}

function contextAdjustment(
  points: number,
  pWin: Record<Position, number>,
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
): number {
  const ownWin = ALL_POSITIONS.filter((pos) => isOwnTeam(pos, obs)).reduce(
    (sum, pos) => sum + pWin[pos],
    0,
  );
  const oppWin = clamp(1 - ownWin, 0, 1);
  const ownSmall = knowledge.smallScores[obs.team];
  const oppSmall = knowledge.smallScores[obs.opponentTeam];
  const positivePoints = Math.max(0, points);
  const negativePoints = Math.max(0, -points);

  let value = 0;
  if (ownSmall <= -700) {
    value -= ownWin * negativePoints * 1.25;
    value += ownWin * positivePoints * 0.25;
  }
  if (ownSmall >= 700) {
    value += ownWin * positivePoints * 0.45;
  }
  if (oppSmall <= -700) {
    value += oppWin * negativePoints * 1.05;
    value -= oppWin * positivePoints * 0.85;
  }
  if (oppSmall >= 700) {
    value -= oppWin * positivePoints * 1.2;
  }

  const headDiff = knowledge.totalPigHeads[obs.team] - knowledge.totalPigHeads[obs.opponentTeam];
  if (headDiff > 0) {
    // 总猪头落后：提高方差，争正分。
    value += ownWin * positivePoints * 0.18;
  } else if (headDiff < 0) {
    // 总猪头领先：降低方差，避免送负分。
    value -= ownWin * negativePoints * 0.18;
  }

  if (hasMode(threat, 'danger-zone')) {
    value -= ownWin * negativePoints * 0.55;
  }
  if (hasMode(threat, 'finish')) {
    value += ownWin * positivePoints * 0.3;
  }

  return value;
}

function partnerCoordination(
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
  pWin: Record<Position, number>,
  candidate: number,
  points: number,
): number {
  let value = 0;
  const partner = obs.partner;
  const partnerThreat = threat.seat[partner];
  const selfThreat = threat.seat[obs.self];
  const partnerWin = pWin[partner];
  const selfWin = pWin[obs.self];
  const currentWinner = obs.currentTrick.plays.length > 0
    ? obs.currentTrick.plays.reduce<CardPlay | null>((best, play) => {
        if (!best) return play;
        const leadSuit = getSuit(obs.currentTrick.plays[0].card);
        if (getSuit(play.card) !== leadSuit) return best;
        return getRank(play.card) > getRank(best.card) ? play : best;
      }, null)?.position ?? null
    : null;
  const partnerWinning = currentWinner === partner;

  if (partnerWinning) {
    if (partnerWin >= selfWin - 0.05) value += 7;
    if (selfWin > partnerWin + 0.1) {
      const protecting =
        hasMode(threat, 'protect-transformer') ||
        hasMode(threat, 'break-opp-slam') ||
        hasMode(threat, 'break-opp-allred');
      if (!protecting) value -= 12;
    }
  }

  if (partnerThreat.pAllRed > 0.45) {
    if (partnerWin > selfWin) value += 18 * partnerThreat.pAllRed;
    if (selfWin > partnerWin && getSuit(candidate) === 2) {
      value -= 14 * partnerThreat.pAllRed;
    }
  }
  if (partnerThreat.pGrandSlam > 0.3) {
    if (partnerWin > selfWin) value += 22 * partnerThreat.pGrandSlam;
    if (selfWin > partnerWin) value -= 12 * partnerThreat.pGrandSlam;
  }
  if (selfThreat.pAllRed > 0.45 || selfThreat.pGrandSlam > 0.3) {
    if (selfWin > partnerWin) value += 16 * Math.max(selfThreat.pAllRed, selfThreat.pGrandSlam);
  }

  if (hasMode(threat, 'protect-transformer') && partnerWinning && points < 0) {
    value -= 24 * partnerThreat.pTransformerNegative;
    if (selfWin > partnerWin) value += 20 * partnerThreat.pTransformerNegative;
  }
  if (hasMode(threat, 'protect-transformer') && selfWin > partnerWin && points < 0) {
    const multiplier = knowledge.litCards.includes(TRANSFORMER) ? 4 : 2;
    value += Math.abs(points) * (multiplier - 1) * partnerThreat.pTransformerNegative;
  }
  if (hasMode(threat, 'break-opp-slam') && partnerWin > selfWin) {
    value += 8 * threat.opp.pGrandSlamAny;
  }

  return value;
}

function jitter(obs: PlayObservation, card: number): number {
  return (hashSeed(obs.samplingSeed, obs.trickHistory.length, obs.currentTrick.plays.length, card) % 1000) / 1000;
}

/** 对一张候选牌做团队概率评分。分数越高越优先。 */
export function scoreCandidate(
  card: number,
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
): number {
  const play: CardPlay = { position: obs.self, card };
  const plays = [...obs.currentTrick.plays, play];
  const trickCards = plays.map((item) => item.card);
  const points = trickCards.reduce(
    (sum, trickCard) => sum + effectiveCardPoints(trickCard, knowledge),
    0,
  );
  const pWin = estimateTrickWinnerProbabilities(plays, knowledge);
  const candidateWins =
    pWin[obs.self] >= 0.45 &&
    pWin[obs.self] >= Math.max(...ALL_POSITIONS.map((pos) => pWin[pos])) - 0.05;

  // 全红模式或全红压力在场时，红桃的基础负分不再可靠：若目标收齐即反转为正分，
  // 因此红桃价值完全交给 threatValue 的概率模型处理，避免“把红桃送给敌方”被误判为好棋。
  const ownAllRedPotential = Math.max(
    allRedPressure(threat, obs.self),
    allRedPressure(threat, obs.partner),
  );
  const oppAllRedPotential = ALL_POSITIONS
    .filter((pos) => !isOwnTeam(pos, obs))
    .reduce((best, pos) => Math.max(best, allRedPressure(threat, pos)), 0);
  const allRedInPlay =
    hasMode(threat, 'own-allred') ||
    hasMode(threat, 'partner-allred') ||
    hasMode(threat, 'break-opp-allred') ||
    ownAllRedPotential > 0.02 ||
    oppAllRedPotential > 0.02;
  const trickPointsForBase = allRedInPlay
    ? obs.currentTrick.plays
        .concat([play])
        .reduce(
          (sum, item) =>
            sum + (getSuit(item.card) === 2 ? 0 : effectiveCardPoints(item.card, knowledge)),
          0,
        )
    : points;
  const trickValue = expectedTrickTeamValue(trickPointsForBase, pWin, obs);
  const threatValue = expectedTrickThreatValue(trickCards, pWin, obs, knowledge, threat);
  const partnerValue = partnerCoordination(obs, knowledge, threat, pWin, card, points);
  const contextValue = contextAdjustment(points, pWin, obs, knowledge, threat);
  const retentionValue = endgameRetentionScore(card, knowledge, threat, points, candidateWins);
  const heartAValue = heartADisposalValue(card, obs, knowledge, threat, pWin);

  const currentWinner = knowledge.currentWinner;
  const partnerWinning = currentWinner === obs.partner;
  const opponentWinning = currentWinner !== null && !isOwnTeam(currentWinner, obs);

  const safetyValue =
    obs.currentTrick.plays.length === 0
      ? leadSafety(card, obs, knowledge, threat)
      : followSafety(card, obs, knowledge, threat, points, partnerWinning, opponentWinning);

  return (
    trickValue +
    threatValue * 1.35 +
    partnerValue +
    contextValue +
    retentionValue +
    heartAValue +
    safetyValue +
    jitter(obs, card) * 0.01
  );
}

/** 概率启发式：对所有合法牌评分并选择最高者。 */
export function choosePolicyPlay(
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
): number {
  let bestCard = obs.legalCards[0];
  let bestScore = -Infinity;
  for (const card of obs.legalCards) {
    const score = scoreCandidate(card, obs, knowledge, threat);
    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }
  return bestCard;
}

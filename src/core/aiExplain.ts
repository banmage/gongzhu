import {
  HEART_A,
  PIG,
  SHEEP,
  TRANSFORMER,
  cardLabel,
  getRank,
  getSuit,
  isKeyCard,
} from '../models/card';
import { ALL_POSITIONS, seatName } from '../models/game';
import type { PlayObservation } from './aiObservation';
import { buildPublicKnowledge, type PublicKnowledge } from './aiKnowledge';
import {
  estimateThreats,
  hasMode,
  type ThreatMode,
  type ThreatModel,
} from './aiThreat';
import {
  isSuitMaster,
  rankCandidates,
  type CandidateBreakdown,
} from './aiPolicy';

export interface PlayAlternative {
  card: number;
  /** 与首选牌的评分差（正数表示更低）。 */
  gap: number;
}

export interface PlayRecommendation {
  card: number;
  title: string;
  /** 推荐理由，按重要性排序。 */
  reasons: string[];
  /** 基于已出牌公开信息的推断，单独展示。 */
  inference: string;
  breakdown: CandidateBreakdown;
  alternatives: PlayAlternative[];
  modes: ThreatMode[];
}

export interface RecommendPlayOptions {
  /** 外部指定要解释的牌（例如玩家点击“提示”后保留的选择）。 */
  preferredCard?: number;
}

const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;

const MODE_REASONS: Partial<Record<ThreatMode, string>> = {
  'own-slam': '我方接近满贯：关键牌和红桃优先集中给满贯目标，避免自己截胡。',
  'partner-slam': '搭档接近满贯：主动喂关键牌/红桃，并帮搭档挡住对手抢牌。',
  'break-opp-slam': '对手接近满贯：优先破坏其红桃和关键牌，必要时自己吃负分。',
  'own-allred': '我方正在冲全红：红桃应尽量集中到自己手里，不要轻易打断。',
  'partner-allred': '搭档正在冲全红：优先把红桃喂给搭档，不抢搭档的红桃墩。',
  'break-opp-allred': '对手正在冲全红：优先用红桃或截胡打断，不能把红桃直接送给目标家。',
  'heart-a-disposal': '♥A 留在手里风险高：能垫给安全同伴时优先脱手，或及早落墩封顶。',
  'protect-transformer': '搭档有负向变压器风险：避免把红桃/猪送进搭档的收牌区。',
  'exploit-transformer': '对手的变压器可能为负：尽量让对手收下红桃或猪，放大其负分。',
  'pig-evade': '猪可能落到我方：优先把黑桃控制在对手一侧，避免自己收猪。',
  'pig-maintain': '对手更可能收猪：保持黑桃压力，不要帮对手解套。',
  'sheep-contest': '羊仍在场上：保留方块大牌，保持对羊的争夺力。',
  'danger-zone': '我方接近 -1000：降低方差，优先避免送负分。',
  finish: '我方接近 +1000：主动争正分，争取触发画头。',
  'high-value-endgame': '残局高价值路线：场上只剩羊/正向变压器等正分目标，尽量保留大牌去争。',
  'high-risk-endgame': '残局高风险路线：场上只剩亮猪/负向变压器等高风险牌，优先脱手大牌、保留小牌。',
};

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

/** 从公开缺门信息生成“东家缺♥、西家缺♣”一类读牌说明。 */
function voidInference(knowledge: PublicKnowledge): string {
  const parts: string[] = [];
  for (const pos of ALL_POSITIONS) {
    if (pos === knowledge.self) continue;
    const suits = ([0, 1, 2, 3] as const).filter((suit) => knowledge.voids[pos][suit]);
    if (suits.length > 0) {
      parts.push(
        `${seatName(pos)}家缺${suits.map((suit) => SUIT_SYMBOLS[suit]).join('')}`,
      );
    }
  }
  return parts.join('、');
}

function keyCardInference(knowledge: PublicKnowledge): string {
  const names: Array<[number, string]> = [
    [PIG, '猪♠Q'],
    [SHEEP, '羊♦J'],
    [TRANSFORMER, '变压器♣10'],
    [HEART_A, '♥A'],
  ];
  const parts: string[] = [];
  for (const [card, label] of names) {
    const state = knowledge.keyCards[
      card === PIG
        ? 'pig'
        : card === SHEEP
          ? 'sheep'
          : card === TRANSFORMER
            ? 'transformer'
            : 'heartA'
    ];
    if (state.collectedBy) {
      parts.push(`${label} 已由${seatName(state.collectedBy)}家收下`);
    } else if (state.inCurrentTrick) {
      parts.push(`${label} 正在本墩`);
    } else if (state.knownHolder) {
      parts.push(`${label} 已亮，${seatName(state.knownHolder)}家持有`);
    } else {
      parts.push(`${label} 仍在场上`);
    }
  }
  return parts.join('；');
}

function suitInference(
  card: number,
  knowledge: PublicKnowledge,
  lateGame: boolean,
): string {
  const suit = getSuit(card);
  const rank = getRank(card);
  const higher = knowledge.unseen.filter(
    (unseenCard) => getSuit(unseenCard) === suit && getRank(unseenCard) > rank,
  );
  if (higher.length === 0) {
    return `${cardLabel(card)} 是该花色未见牌中的最大张${lateGame ? '，残局可作为控制张兑现' : ''}`;
  }
  return `同花色仍有 ${higher.length} 张更大的未见牌（${higher
    .sort((a, b) => getRank(b) - getRank(a))
    .map((unseenCard) => cardLabel(unseenCard))
    .join('、')}），需防被压`;
}

function buildInference(
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  threat: ThreatModel,
  breakdown: CandidateBreakdown,
): string {
  const lateGame = obs.ownHand.length <= 5 || knowledge.tricksRemaining <= 5;
  const parts: string[] = [];
  parts.push(
    lateGame
      ? `残局读牌：已打 ${knowledge.tricksPlayed} 墩，剩 ${knowledge.tricksRemaining} 墩`
      : `已打 ${knowledge.tricksPlayed} 墩，公开信息推断如下`,
  );

  const voids = voidInference(knowledge);
  if (voids) parts.push(voids);
  parts.push(keyCardInference(knowledge));
  parts.push(suitInference(breakdown.card, knowledge, lateGame));

  if (lateGame) {
    if (hasMode(threat, 'high-value-endgame')) {
      parts.push('残局路线：先保留大牌争夺剩余正分目标');
    } else if (hasMode(threat, 'high-risk-endgame')) {
      parts.push('残局路线：先脱手高风险大牌，避免最后被迫收下');
    } else if (breakdown.isMaster) {
      parts.push('残局路线：用控制张兑现本墩，争取继续掌握领出权');
    }
  }

  return parts.join('；');
}

function cardSpecificReasons(
  obs: PlayObservation,
  knowledge: PublicKnowledge,
  breakdown: CandidateBreakdown,
  lateGame: boolean,
): string[] {
  const reasons: string[] = [];
  const card = breakdown.card;
  const leading = obs.currentTrick.plays.length === 0;
  const partnerWinning = knowledge.currentWinner === obs.partner;
  const opponentWinning =
    knowledge.currentWinner !== null &&
    knowledge.currentWinner !== obs.self &&
    knowledge.currentWinner !== obs.partner;

  if (obs.legalCards.length === 1) {
    reasons.push('这是当前唯一合法牌，按跟牌/首轮限制规则必须打出。');
  }

  if (leading) {
    if (breakdown.isMaster && lateGame) {
      reasons.push(
        `残局控制张：${cardLabel(card)} 已是该花色未见牌中的最大张，领出可稳拿本墩并保留主动权。`,
      );
    } else if (!breakdown.isMaster && !isKeyCard(card) && getSuit(card) !== 2) {
      reasons.push('首出小牌试探，保留大牌作为后续控制。');
    }
  } else {
    reasons.push(
      `本墩我方收墩概率约 ${percent(breakdown.ownTeamWinProbability)}，${
        breakdown.trickPoints > 0
          ? `可收下约 +${breakdown.trickPoints} 分`
          : breakdown.trickPoints < 0
            ? `当前墩值约 ${breakdown.trickPoints} 分`
            : '当前墩无计分牌'
      }。`,
    );
    if (partnerWinning && !breakdown.candidateWins) {
      reasons.push('同伴已经领先本墩，跟小牌不抢，保留大牌控制后续。');
    } else if (opponentWinning && !breakdown.candidateWins) {
      reasons.push('对手当前领先，优先垫出对团队风险最低的牌。');
    }
  }

  if (card === PIG) {
    reasons.push('猪♠Q 优先脱手：留在手里容易被逼收下 -100（亮猪 -200）。');
  } else if (card === SHEEP) {
    reasons.push('羊♦J 是正分目标，按当前局面决定争夺还是保留控制。');
  } else if (card === TRANSFORMER) {
    reasons.push('变压器♣10 的收益取决于收牌者小计，避免把它送进己方正分小计。');
  } else if (card === HEART_A) {
    reasons.push('♥A 负分较重，优先按“垫给安全同伴/及早封顶”的路线处理。');
  }

  if (breakdown.futureValue > 0.5) {
    reasons.push('残局路线加分：这张牌能把下一墩的主动权留在己方。');
  } else if (breakdown.futureValue < -0.5) {
    reasons.push('残局路线减分：这张牌可能浪费控制张或把主动权交给对手。');
  }

  if (breakdown.retentionValue > 0.5) {
    reasons.push('符合残局留牌原则：保留高价值控制张，先出风险较低的小牌。');
  } else if (breakdown.retentionValue < -0.5) {
    reasons.push('符合残局脱手原则：优先把高风险大牌打出去，避免最后被逼收下。');
  }

  if (breakdown.heartAValue > 5) {
    reasons.push('♥A 处置收益明显，尽早脱手可封顶负分并剥夺对手的 ♥A。');
  }

  if (breakdown.partnerValue > 4) {
    reasons.push('与搭档配合：不抢搭档的赢墩，或把有利的牌喂给搭档。');
  }

  if (breakdown.contextValue > 4 || breakdown.contextValue < -4) {
    reasons.push(
      breakdown.contextValue > 0
        ? '分数情境有利：当前小分/猪头差支持主动争分。'
        : '分数情境偏防守：当前小分/猪头差要求降低方差。',
    );
  }

  if (breakdown.safetyValue > 6) {
    reasons.push('安全张优先：减少被对手压住或利用的风险。');
  } else if (breakdown.safetyValue < -6) {
    reasons.push('这张牌有一定风险，但在当前威胁模式下属于必要代价。');
  }

  return reasons;
}

/** 由概率评分与公开推断生成中文推荐说明。 */
export function recommendPlay(
  obs: PlayObservation,
  options: RecommendPlayOptions = {},
): PlayRecommendation {
  if (obs.legalCards.length === 0) throw new Error('没有合法出牌');

  const knowledge = buildPublicKnowledge(obs);
  const threat = estimateThreats(obs, knowledge);
  const ranked = rankCandidates(obs, knowledge, threat);
  const preferred =
    options.preferredCard !== undefined && obs.legalCards.includes(options.preferredCard)
      ? ranked.find((item) => item.card === options.preferredCard) ?? ranked[0]
      : ranked[0];
  const lateGame = obs.ownHand.length <= 5 || knowledge.tricksRemaining <= 5;

  const reasons = cardSpecificReasons(obs, knowledge, preferred, lateGame);

  // 当前威胁模式只取优先级最高的两条，避免说明过长。
  for (const mode of threat.modes.slice(0, 2)) {
    const reason = MODE_REASONS[mode];
    if (reason) reasons.push(reason);
  }

  const uniqueReasons = [...new Set(reasons)].slice(0, 5);
  const title = `推荐出 ${cardLabel(preferred.card)}`;

  return {
    card: preferred.card,
    title,
    reasons: uniqueReasons,
    inference: buildInference(obs, knowledge, threat, preferred),
    breakdown: preferred,
    alternatives: ranked
      .filter((item) => item.card !== preferred.card)
      .slice(0, 2)
      .map((item) => ({
        card: item.card,
        gap: Math.max(0, preferred.total - item.total),
      })),
    modes: [...threat.modes],
  };
}

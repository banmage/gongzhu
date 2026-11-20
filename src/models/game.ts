import type { SuitIndex } from './card';

/** 座位：南、东、北、西。出牌顺序为逆时针：南 → 东 → 北 → 西 */
export type Position = 'S' | 'E' | 'N' | 'W';

/** A 队 = 南 + 北；B 队 = 东 + 西 */
export type Team = 'A' | 'B';
export type TeamOrNone = Team | 'NONE';

export type MatchFormat = 5 | 8;

export type Phase = 'idle' | 'dealing' | 'lighting' | 'revealing' | 'playing' | 'scoring' | 'matchEnd';

export type DealPhase = 'dealing' | 'lighting' | 'revealing' | 'playing' | 'scoring' | 'done';

export type SuitStatus = 'NOT_LED' | 'LED';

export type RoundEndReason = 'PIG_HEAD' | 'SLAM' | 'DEAL_LIMIT';

export type RoundResultCode = 'A_WIN' | 'B_WIN' | 'DRAW';

/** 出牌顺序（逆时针） */
export const ORDER: Position[] = ['S', 'E', 'N', 'W'];

/** 发牌顺序（发牌动画用） */
export const DEAL_ORDER: Position[] = ['S', 'E', 'N', 'W'];

export const ALL_POSITIONS: Position[] = ['S', 'E', 'N', 'W'];

export function nextPosition(pos: Position): Position {
  const idx = ORDER.indexOf(pos);
  return ORDER[(idx + 1) % 4];
}

export function getPartner(pos: Position): Position {
  return pos === 'S' ? 'N' : pos === 'N' ? 'S' : pos === 'E' ? 'W' : 'E';
}

export function teamOf(pos: Position): Team {
  return pos === 'S' || pos === 'N' ? 'A' : 'B';
}

export function otherTeam(team: Team): Team {
  return team === 'A' ? 'B' : 'A';
}

export function teamName(team: Team): string {
  return team === 'A' ? '南北队' : '东西队';
}

export function teamShort(team: Team): string {
  return team === 'A' ? 'A队' : 'B队';
}

export function seatName(pos: Position): string {
  return { S: '南', E: '东', N: '北', W: '西' }[pos];
}

export function seatFullName(pos: Position): string {
  return { S: '南家（你）', E: '东家', N: '北家', W: '西家' }[pos];
}

export function teamOfSeatLabel(pos: Position): string {
  return `${seatName(pos)}（${teamShort(teamOf(pos))}）`;
}

/* ------------------------------------------------------------------ *
 * 配置
 * ------------------------------------------------------------------ */

export interface GameConfig {
  format: MatchFormat;
  /** 单局限副数（兜底终止） */
  dealLimit: number;
  /** 自动亮最后一张 */
  autoLightLastOne: boolean;
  /** 亮牌阶段时限（秒） */
  lightSeconds: number;
  /** 每墩出牌时限（秒） */
  playSeconds: number;
  /** 断线保留时长（秒，展示用） */
  disconnectSeconds: number;
  /** AI 思考延迟基数（毫秒） */
  aiDelayMs: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  format: 5,
  dealLimit: 20,
  autoLightLastOne: true,
  lightSeconds: 30,
  playSeconds: 20,
  disconnectSeconds: 60,
  aiDelayMs: 750,
};

/* ------------------------------------------------------------------ *
 * 牌局实体
 * ------------------------------------------------------------------ */

export interface CardPlay {
  position: Position;
  card: number;
  /** 系统超时代打 */
  auto?: boolean;
  /** AI 出牌 */
  ai?: boolean;
  /** 南家只剩唯一合法牌时的自动出牌 */
  single?: boolean;
}

export interface Trick {
  leader: Position;
  plays: CardPlay[];
  winner: Position | null;
  /** 本墩内计分牌基础分之和（展示用） */
  points: number;
  firstLedSuit: SuitIndex | null;
  /** 该墩是否为该花色“首次作为领出花色”的一墩 */
  isFirstLed: boolean;
}

export interface ScoreBreakdown {
  position: Position;
  collected: number[];

  pigBase: number;
  pigLitAdj: number;
  ownPigAdj: number;
  pigTotal: number;

  sheepBase: number;
  sheepLitAdj: number;
  sheepTotal: number;

  heartsBase: number;
  heartALit: boolean;
  heartLitAdj: number;
  heartsTotal: number;
  allRed: boolean;

  subtotal: number;

  hasTransformer: boolean;
  transformerLit: boolean;
  transformerSolo: boolean;
  transformerAdj: number;

  final: number;
  notes: string[];
}

export interface SlamInfo {
  triggered: boolean;
  position?: Position;
  team?: Team;
  allKeyCardsLit: boolean;
  /** 给对方画几头 */
  pigHeads: number;
}

export interface DealScore {
  breakdowns: Record<Position, ScoreBreakdown>;
  teamScores: Record<Team, number>;
  slam: SlamInfo;
  /** 满贯时为 false：不生成正式个人分 */
  official: boolean;
  litCards: number[];
  litBy: Record<number, Position>;
  autoLitCards: number[];
}

export interface RoundResult {
  newPigHeads: Record<Team, number>;
  winner: TeamOrNone;
  loser: TeamOrNone;
  result: RoundResultCode;
  reason: string;
  endReason: RoundEndReason;
  slam?: SlamInfo;
}

/** 画猪头判定结果（未附带本局小分记录） */
export type PigHeadResult = Omit<RoundResult, 'slam'>;

export interface RoundRecord {
  roundNumber: number;
  isExtra: boolean;
  dealsPlayed: number;
  smallScores: Record<Team, number>;
  newPigHeads: Record<Team, number>;
  winner: TeamOrNone;
  loser: TeamOrNone;
  result: RoundResultCode;
  endReason: RoundEndReason;
  slam?: SlamInfo;
  totalPigHeadsAfter: Record<Team, number>;
  note: string;
}

export interface DealState {
  index: number;
  seed: number;
  hands: Record<Position, number[]>;
  originalHands: Record<Position, number[]>;
  leader: Position;
  /** 本局第一副：持♣2者领出且必须出♣2 */
  forcedClub2: boolean;

  litCards: number[];
  litBy: Record<number, Position>;
  autoLitCards: number[];
  submissions: Record<Position, number[]>;
  submitted: Record<Position, boolean>;
  allKeyCardsLit: boolean;

  firstLedSuitStatus: Record<SuitIndex, SuitStatus>;

  tricks: Trick[];
  currentTrick: Trick;
  nextPlayer: Position;
  collected: Record<Position, number[]>;
  pigCollector: Position | null;

  phase: DealPhase;
  score: DealScore | null;
  lastAction: CardPlay | null;
}

export interface MatchState {
  format: MatchFormat;
  totalPigHeads: Record<Team, number>;
  rounds: RoundRecord[];
  winner: TeamOrNone | null;
  reason: string;
  finished: boolean;
  seed: number;
}

export interface RoundState {
  number: number;
  isExtra: boolean;
  smallScores: Record<Team, number>;
  newPigHeads: Record<Team, number>;
  dealsPlayed: number;
  lastPigCollector: Position | null;
  result: RoundResult | null;
}

export interface MatchOutcome {
  finished: boolean;
  winner: TeamOrNone | null;
  reason: string;
}

export interface AuditInfo {
  seed: number;
  algorithmVersion: string;
  rngVersion: string;
  deckHash: string;
  dealHash: string;
  revealedAt: string | null;
}

/* ------------------------------------------------------------------ *
 * 事件记录与复盘
 * ------------------------------------------------------------------ */

export type GameEventType =
  | 'MATCH_STARTED'
  | 'DEAL_CREATED'
  | 'PLAYER_LIGHT_SUBMITTED'
  | 'AUTO_LIGHT_TRIGGERED'
  | 'LIGHT_REVEALED'
  | 'CARD_PLAYED'
  | 'TIMEOUT_AUTO_PLAY'
  | 'AI_TAKEOVER_STARTED'
  | 'TRICK_COMPLETED'
  | 'SCORE_CALCULATED'
  | 'PIG_HEAD_ASSIGNED'
  | 'ROUND_COMPLETED'
  | 'MATCH_COMPLETED';

export interface GameEvent {
  seq: number;
  at: string;
  type: GameEventType;
  roundNumber: number;
  dealIndex: number | null;
  position?: Position;
  card?: number;
  detail: string;
}

export const EVENT_TYPE_TEXT: Record<GameEventType, string> = {
  MATCH_STARTED: '开赛',
  DEAL_CREATED: '发牌',
  PLAYER_LIGHT_SUBMITTED: '亮牌提交',
  AUTO_LIGHT_TRIGGERED: '自动亮',
  LIGHT_REVEALED: '亮牌揭晓',
  CARD_PLAYED: '出牌',
  TIMEOUT_AUTO_PLAY: '超时代打',
  AI_TAKEOVER_STARTED: 'AI 接管',
  TRICK_COMPLETED: '墩结算',
  SCORE_CALCULATED: '副结算',
  PIG_HEAD_ASSIGNED: '画猪头',
  ROUND_COMPLETED: '局结算',
  MATCH_COMPLETED: '盘终',
};

/** 一副牌的完整复盘记录 */
export interface DealRecord {
  index: number;
  seed: number;
  roundNumber: number;
  leader: Position;
  forcedClub2: boolean;
  litCards: number[];
  litBy: Record<number, Position>;
  autoLitCards: number[];
  allKeyCardsLit: boolean;
  tricks: Trick[];
  collected: Record<Position, number[]>;
  score: DealScore | null;
  pigCollector: Position | null;
}

/* ------------------------------------------------------------------ *
 * 展示辅助
 * ------------------------------------------------------------------ */

export function resultText(code: RoundResultCode): string {
  return { A_WIN: 'A队胜', B_WIN: 'B队胜', DRAW: '和局' }[code];
}

export function endReasonText(reason: RoundEndReason): string {
  return {
    PIG_HEAD: '达到画猪头条件',
    SLAM: '满贯触发',
    DEAL_LIMIT: '单局副数上限兜底',
  }[reason];
}

export function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

import type { TargetShape } from '../../types'

/**
 * 统一的游戏 API 接口，屏蔽 solo/pk 差异。
 * 仅覆盖共享的游戏逻辑方法（移动、同步、判定、提示、放弃）。
 * 游戏初始化（startGame/getGameState）和 PK 独有方法（rematch）由父组件直接调用。
 */
export interface GameApiAdapter {
  /** 移动视角 */
  move(gameId: number, direction: string, distanceKm: number): Promise<{ view_lng: number; view_lat: number; steps?: number; total_distance_km?: number }>
  /** 同步视角到服务端 */
  updateView(gameId: number, lng: number, lat: number): Promise<void>
  /** 困难模式视野判定 */
  checkView(gameId: number, west: number, south: number, east: number, north: number): Promise<CheckViewResult>
  /** 简单模式点击落点判定 */
  clickTarget(gameId: number, lng: number, lat: number): Promise<ClickResult>
  /** 使用提示 */
  getHint(gameId: number, hintLevel: number): Promise<HintResult>
  /** 放弃 */
  giveUp(gameId: number): Promise<GiveUpResult>
}

/** 视野判定统一结果（solo 和 pk 共用，差异字段可选） */
export interface CheckViewResult {
  hit: boolean
  distance_bucket?: string
  score?: number
  target_name?: string
  target_poi_id?: number | null
  target_lng?: number
  target_lat?: number
  target_summary?: string | null
  target_cover?: string | null
  duration_sec?: number
  target_shape?: TargetShape | null
  contributor_nickname?: string | null
  // PK 独有
  opponent_score?: number | null
  opponent_nickname?: string | null
  opponent_hit?: boolean | null
}

/** 点击落点判定结果 */
export interface ClickResult {
  hit: boolean
  distance_hint?: string
  score?: number
  target_name?: string
  target_poi_id?: number | null
  target_lng?: number
  target_lat?: number
  target_summary?: string | null
  target_cover?: string | null
  duration_sec?: number
  target_shape?: TargetShape | null
  contributor_nickname?: string | null
}

/** 提示结果 */
export interface HintResult {
  bounds?: { west: number; south: number; east: number; north: number } | null
  direction?: string
  hint_text?: string
  hint_credits?: number
  [key: string]: unknown
}

/** 放弃结果 */
export interface GiveUpResult {
  distance_km?: number
  total_distance_km?: number
  target_name?: string
  target_poi_id?: number | null
  target_lng?: number
  target_lat?: number
  target_summary?: string | null
  target_cover?: string | null
  target_shape?: TargetShape | null
  contributor_nickname?: string | null
  duration_sec?: number
  success?: boolean
  [key: string]: unknown
}

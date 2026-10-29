export interface PKUser {
  user_id: number
  nickname: string
}

export interface RoomStatus {
  version: number
  status: 'waiting' | 'playing' | 'finished'
  mode: string
  region_code: string | null
  difficulty: string
  category: string | null
  room_code: string
  players: PKUser[]
  game_id: number | null
}

export interface PKTargetInfo {
  name: string
  poi_id?: number | null
  lng: number
  lat: number
  summary: string | null
  cover: string | null
  shape?: import('./index').TargetShape | null
  contributor_nickname?: string | null
}

export interface PKGameState {
  version: number
  mode: string
  difficulty: string
  time_limit: number
  hint_text: string | null
  my_view_lng: number
  my_view_lat: number
  my_steps: number
  my_distance_km: number
  my_hint_level: number
  my_score: number
  my_hit: boolean
  opponent_nickname: string
  opponent_steps: number
  opponent_hit: boolean
  opponent_score: number
  is_finished: boolean
  remaining_seconds: number
  winner: string | null
  win_reason: 'hit' | 'timeout' | 'draw' | 'opponent_left' | null
  target: PKTargetInfo | null
  my_to_target_km: number | null
  opponent_to_target_km: number | null
  my_rematch: boolean
  opponent_rematch: boolean
  rematch_game_id: number | null
  opponent_left: boolean
}

export interface UserStatus {
  active_room_id: number | null
  active_game_id: number | null
  room_status: string | null
  is_host: boolean
  room_code: string | null
}

export interface PKStartResponse {
  game_id: number
  mode: string
  difficulty: string
  start_lng: number
  start_lat: number
  time_limit: number
  hint_text: string | null
  // 开局目标封面图（按难度分级模糊展示）
  target_cover?: string | null
  // 开局剩余积分（机会）
  hint_credits?: number
}

export interface PKCheckViewResponse {
  hit: boolean
  distance_hint?: string
  // 未命中时距离区间（与 solo 契约一致）
  distance_bucket?: string
  score?: number
  target_name?: string
  target_lng?: number
  target_lat?: number
  target_summary?: string | null
  target_cover?: string | null
  duration_sec?: number
  target_shape?: import('./index').TargetShape | null
  contributor_nickname?: string | null
}

// 点击判定返回结构与视野判定一致
export type PKClickResponse = PKCheckViewResponse

export interface PKHintResponse {
  hint_level: number
  content: string
  cost: number
  bounds: {
    west: number
    east: number
    south: number
    north: number
  } | null
  // 扣减后剩余积分（机会）；PK 暂不展示，预留契约
  hint_credits?: number
}

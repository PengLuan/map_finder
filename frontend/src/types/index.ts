export interface StartResponse {
  game_id: number
  mode: string
  difficulty: string
  start_lng: number
  start_lat: number
  time_limit: number
  tolerance_km: number
  hint_text: string | null
  // 开局目标封面图（按难度分级模糊展示，命中/结算解除）
  target_cover: string | null
  // 开局剩余积分（机会），默认 100
  hint_credits?: number
  // 设备类型（后端按 device 返回不同阈值与文案）
  device?: string
}

export interface MoveResponse {
  view_lng: number
  view_lat: number
  steps: number
  total_distance_km: number
}

export interface SelectResponse {
  hit: boolean
  distance_km: number
  score: number
  target_name: string
  target_poi_id?: number | null
  target_lng: number
  target_lat: number
  target_summary: string | null
  target_cover: string | null
  duration_sec: number
  steps: number
  total_distance_km: number
}

// 目标形态（区域范围判定）
export interface TargetShape {
  type: 'point' | 'circle' | 'polygon'
  lng: number
  lat: number
  radius_km?: number
  geojson?: { type: string; coordinates: number[][][] | number[][][][] }
}

// 视野判定返回：未命中时仅 hit=false；命中时携带完整结算信息
export interface CheckViewResponse {
  hit: boolean
  distance_hint?: string
  distance_km?: number
  // 未命中时距离区间（困难 B 救济用，如 "1-5km"）
  distance_bucket?: string
  score?: number
  target_name?: string
  target_poi_id?: number | null
  target_lng?: number
  target_lat?: number
  target_summary?: string | null
  target_cover?: string | null
  duration_sec?: number
  steps?: number
  total_distance_km?: number
  target_shape?: TargetShape | null
  contributor_nickname?: string | null
}

// 点击判定返回结构与视野判定一致
export type ClickResponse = CheckViewResponse

export interface HintResponse {
  hint_level: number
  content: string
  cost: number
  bounds: {
    west: number
    east: number
    south: number
    north: number
  } | null
  // 扣减后剩余积分（机会）
  hint_credits: number
}

// 困难 C 救济：当前视野所在省/市与目标省/市对比（不暴露目标省/市）
export interface LocationHintResponse {
  current_province: string | null
  in_target_province: boolean
  current_city: string | null
  in_target_city: boolean
}

export interface Region {
  code: string
  name: string
  level: number
  lng: number | null
  lat: number | null
}

export interface Theme {
  code: string
  name: string
  description: string | null
  icon: string | null
  cover_url: string | null
  group_name: string | null
  poi_count: number
}

export interface GameState {
  game_id: number
  mode: string
  status: string
  view_lng: number
  view_lat: number
  steps: number
  total_distance_km: number
  hints_used: number
  hint_level: number
  duration_sec: number
  // 剩余积分（机会）
  hint_credits: number
  // 设备类型
  device: string
}

export interface GiveUpResponse {
  target_name: string
  target_poi_id?: number | null
  target_lng: number
  target_lat: number
  target_summary: string | null
  target_cover: string | null
  distance_km: number
  target_shape?: TargetShape | null
}

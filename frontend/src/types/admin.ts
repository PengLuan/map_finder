export interface AdminTheme {
  id: number
  code: string
  name: string
  description: string | null
  icon: string | null
  cover_url: string | null
  group_name: string | null
  sort_order: number
  enabled: boolean
  poi_count: number
}

export interface ThemeInput {
  code: string
  name: string
  description?: string | null
  icon?: string | null
  cover_url?: string | null
  group_name?: string | null
  sort_order?: number
  enabled?: boolean
}

export interface CollectionRef {
  id: number
  code: string
  name: string
}

export interface AdminPOI {
  id: number
  name: string
  category: string | null
  lng: number
  lat: number
  adcode: string | null
  address: string | null
  summary: string | null
  cover_url: string | null
  hint_text: string | null
  difficulty: number
  source: string | null
  used_count: number
  verify_status: string
  contributor_nickname: string | null
  shape_type: 'point' | 'circle' | 'polygon'
  radius_km: number
  area_review: number
  area_geojson: string | null
  collections: CollectionRef[]
}

export interface AdminPOIInput {
  name: string
  category?: string | null
  lng: number
  lat: number
  adcode?: string | null
  address?: string | null
  summary?: string | null
  cover_url?: string | null
  hint_text?: string | null
  difficulty: number
  source?: string
  shape_type: 'point' | 'circle' | 'polygon'
  radius_km: number
  area_geojson?: string | null
  contributor_nickname?: string | null
  verify_status?: string
}

export interface AdminPOIList {
  total: number
  page: number
  page_size: number
  items: AdminPOI[]
}

export interface SessionItem {
  id: number
  session_id: string
  ip: string
  ip_region: string | null
  nickname: string | null
  mode: string
  region_code: string | null
  category: string | null
  difficulty: string
  game_type: string
  won: boolean
  score: number
  duration_sec: number
  started_at: string | null
  ended_at: string | null
}

export interface SessionList {
  total: number
  page: number
  page_size: number
  items: SessionItem[]
}

export interface ModeDist {
  mode: string
  count: number
}

export interface TrendItem {
  date: string
  count: number
}

export interface IpSummary {
  ip: string
  games: number
  total_duration: number
  last_active: string | null
}

export interface Overview {
  today_dau: number
  today_games: number
  avg_duration: number
  mode_dist: ModeDist[]
  trend: TrendItem[]
  ip_summary: IpSummary[]
}

export interface SubmissionItem {
  id: number
  session_id: string
  nickname: string | null
  name: string
  province_code: string | null
  category: string | null
  lng: number
  lat: number
  description: string | null
  cover_url: string | null
  suggested_shape_type: string
  suggested_radius_km: number
  suggested_area_geojson: string | null
  status: string
  reviewer_note: string | null
  submitted_at: string | null
  reviewed_at: string | null
}

export interface SubmissionList {
  total: number
  page: number
  page_size: number
  items: SubmissionItem[]
}

export interface ApproveInput {
  name?: string
  category?: string | null
  lng?: number
  lat?: number
  adcode?: string | null
  summary?: string | null
  cover_url?: string | null
  difficulty?: number
  shape_type?: 'point' | 'circle' | 'polygon'
  radius_km?: number
  area_geojson?: string | null
  contributor_nickname?: string | null
}

export interface FeedbackItem {
  id: number
  content: string
  image_urls: string[]
  contact: string | null
  nickname: string | null
  ip: string
  admin_reply: string | null
  replied_at: string | null
  created_at: string | null
}

export interface CorrectionItem {
  id: number
  poi_id: number
  session_id: string
  nickname: string | null
  // 纠正快照（null = 未纠正该项）
  name: string | null
  category: string | null
  lng: number | null
  lat: number | null
  description: string | null
  cover_url: string | null
  suggested_shape_type: string | null
  suggested_radius_km: number | null
  suggested_area_geojson: string | null
  status: 'pending' | 'adopted' | 'rejected'
  reviewer_note: string | null
  created_at: string | null
  adopted_at: string | null
  // 原 POI 当前值（后台对照）
  poi_current?: {
    name: string
    category: string | null
    lng: number
    lat: number
    summary: string | null
    cover_url: string | null
    shape_type: string
    radius_km: number
    area_geojson: string | null
  }
}

export interface AdminCollection {
  id: number
  code: string
  name: string
  description: string | null
  icon: string | null
  cover_url: string | null
  geometry: string | null
  difficulty_star: number
  unlock_require: number
  audit_status: string
  sort_order: number
  enabled: boolean
  point_count: number
  medal_count: number
  created_at: string | null
}

export interface CollectionInput {
  code: string
  name: string
  description?: string | null
  icon?: string | null
  cover_url?: string | null
  geometry?: string | null
  difficulty_star: number
  unlock_require: number
  audit_status: string
  sort_order: number
  enabled: boolean
}

export interface AdminCollectionList {
  total: number
  page: number
  page_size: number
  items: AdminCollection[]
}

export interface CollectionPoiItem {
  poi_id: number
  name: string
  lng: number
  lat: number
  cover_url: string | null
  difficulty: number
  sort_order: number
}

export interface CollectionPoiList {
  collection_id: number
  items: CollectionPoiItem[]
}

export interface AdminUser {
  id: number
  email: string | null
  nickname: string
  avatar_url: string | null
  total_medals: number
  is_admin: boolean
  last_login_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface AdminUserList {
  total: number
  page: number
  page_size: number
  items: AdminUser[]
}

export interface UserUpdateInput {
  is_admin?: boolean
  nickname?: string
  total_medals?: number
}

// ===== 勋章排行类型 =====

export interface UserMedalItem {
  medal_name: string
  difficulty: string
  game_type: string
  collection_name: string
  collection_code: string
  total_time_sec: number
  earned_at: string | null
}

export interface CollectionLeaderRow {
  rank: number
  user_id: number
  nickname: string
  total_time_sec: number
  earned_at: string | null
  game_type: string
}

export interface POILeaderRow {
  rank: number
  user_id: number
  nickname: string
  poi_time_sec: number
  total_time_sec: number
  earned_at: string | null
}

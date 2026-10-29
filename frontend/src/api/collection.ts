/**
 * 专题模式 API 客户端
 * 邮箱登录 + 专题列表/详情/流程 + 勋章墙 + 排行榜 + 足迹
 */
import { getSessionId } from './index'

const TOKEN_KEY = 'map_pk_token' // 与 PK 共用 token，登录态打通
const USER_KEY = 'map_pk_user' // 与 PK 共用 user 存储（昵称打通）

export interface CollectionUser {
  id: number
  email: string
  nickname: string
  total_medals: number
  avatar_url?: string | null
  slogan?: string | null
  profile_public?: boolean
  is_admin?: boolean
}

// 用户公开主页信息（第四期）
export interface UserProfileInfo {
  hidden: boolean
  id?: number
  nickname?: string
  avatar_url?: string | null
  slogan?: string | null
  total_medals?: number
  created_at?: string | null
  profile_public?: boolean
  is_self?: boolean
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}
export function getStoredUser(): CollectionUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
export function setStoredUser(u: CollectionUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(u))
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
export function isLoggedIn(): boolean {
  return !!getToken() && !!getStoredUser()
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  })
  if (!res.ok) {
    if (res.status === 401 && token) {
      clearAuth()
    }
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `请求失败: ${res.status}`)
  }
  return res.json()
}

// ===== 邮箱登录 =====

export const authApi = {
  sendCode(email: string) {
    return request<{ ok: boolean; message: string }>('/api/auth/send_code', {
      method: 'POST', body: JSON.stringify({ email }),
    })
  },
  login(email: string, code: string, nickname?: string, sessionId?: string) {
    return request<{ token: string; user: CollectionUser; is_new: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, code, nickname, session_id: sessionId }),
    })
  },
  checkNickname(nickname: string, base?: string) {
    return request<{ available: boolean; suggestions?: string[] }>('/api/auth/check_nickname', {
      method: 'POST', body: JSON.stringify({ nickname, base }),
    })
  },
  me() {
    return request<CollectionUser>('/api/auth/me')
  },
  userProfile(userId: number) {
    return request<UserProfileInfo>(`/api/auth/user/${userId}/profile`)
  },
  updateProfileSettings(data: { slogan?: string; profile_public?: boolean }) {
    return request<{ id: number; nickname: string; slogan: string | null; profile_public: boolean }>(
      '/api/auth/user/profile', { method: 'PUT', body: JSON.stringify(data) },
    )
  },
  updateNickname(nickname: string) {
    return request<CollectionUser>('/api/auth/update_nickname', {
      method: 'POST', body: JSON.stringify({ nickname }),
    })
  },
}

// ===== 专题 =====

export interface CollectionListItem {
  id: number
  code: string
  name: string
  icon: string | null
  cover_url: string | null
  difficulty_star: number
  point_count: number
  geometry: string | null
  unlocked: boolean
  unlock_require: number
}
export interface CollectionGroup {
  star: number
  completed: number
  collections: CollectionListItem[]
}

export interface CollectionPoint {
  name: string
  lng: number
  lat: number
}
export interface SearchPoiItem {
  id: number
  name: string
  address: string | null
}
export interface CollectionDetail {
  id: number
  code: string
  name: string
  description: string | null
  icon: string | null
  cover_url: string | null
  geometry: string | null
  difficulty_star: number
  point_count: number
  unlocked: boolean
  unlock_require: number
  avg_time_sec: number
  finish_rate: number
  points: CollectionPoint[]
}

export interface StartCollectionResponse {
  collection_id: number
  collection_code: string
  collection_name: string
  point_index: number
  point_count: number
  game_id: number
  mode: string
  difficulty: string
  game_type: string
  start_lng: number
  start_lat: number
  time_limit: number
  tolerance_km: number
  target_cover: string | null
  target_name: string
  device: string
}

export interface PointEndResponse {
  has_next: boolean
  point_index: number
  total: number
  next_point_index?: number
  next_game_id?: number
  next_start_lng?: number
  next_start_lat?: number
  next_target_cover?: string | null
  next_target_name?: string
  next_time_limit?: number
  next_tolerance_km?: number
  next_mode?: string
}

export interface FinishCollectionResponse {
  collection_id: number
  collection_name: string
  difficulty: string
  game_type: string
  total_time_sec: number
  point_times: number[]
  medal_awarded: boolean
  is_new_best: boolean
  medal_name: string | null
  medal_icon_url: string | null
}

export interface MedalWallItem {
  collection_id: number
  collection_code: string
  collection_name: string
  difficulty: string
  game_type: string
  icon_url: string | null
  earned: boolean
  total_time_sec: number | null
  earned_at: string | null
}
export interface MedalWallGroup {
  star: number
  medals: MedalWallItem[]
}

export interface LeaderboardRow {
  rank: number
  user_id: number
  nickname: string
  total_time_sec: number | null
  poi_time_sec?: number | null
  medal_count: number | null
  earned_at: string | null
  game_type?: string | null  // 来源：solo/pk
  profile_public?: boolean   // 公开主页开关（False 时排行榜不可点击）
}

export interface TrackPoint {
  collection_code: string | null
  collection_name: string | null
  point_index: number | null
  poi_id?: number | null
  name: string
  lng: number
  lat: number
  cover_url: string | null
  collection_cover_url: string | null
  summary: string | null
}

export const collectionApi = {
  list(star?: number) {
    const sid = getSessionId()
    const params = new URLSearchParams()
    if (star) params.set('star', String(star))
    if (sid) params.set('session_id', sid)
    return request<{ data: { groups: CollectionGroup[]; total: number } }>(
      `/api/collection/list?${params}`
    )
  },
  searchPois(keyword: string, limit = 20) {
    const params = new URLSearchParams({ keyword, limit: String(limit) })
    return request<{ data: SearchPoiItem[] }>(`/api/collection/poi_search?${params}`)
  },
  detail(code: string) {
    const sid = getSessionId()
    const q = sid ? `?session_id=${encodeURIComponent(sid)}` : ''
    return request<{ data: CollectionDetail }>(`/api/collection/${code}${q}`)
  },
  start(code: string, difficulty: string, gameType: string = 'solo',
        startLng?: number, startLat?: number) {
    return request<{ data: StartCollectionResponse }>('/api/collection/start', {
      method: 'POST',
      body: JSON.stringify({
        collection_code: code, difficulty, game_type: gameType,
        device: window.innerWidth >= 768 ? 'pc' : 'mobile',
        session_id: getSessionId(),
        start_lng: startLng, start_lat: startLat,
      }),
    })
  },
  pointEnd(collectionId: number, pointIndex: number, timeSec: number,
           isCorrect: boolean, difficulty: string, gameType: string = 'solo') {
    return request<{ data: PointEndResponse }>('/api/collection/point_end', {
      method: 'POST',
      body: JSON.stringify({
        collection_id: collectionId, point_index: pointIndex,
        time_sec: timeSec, is_correct: isCorrect,
        difficulty, game_type: gameType, session_id: getSessionId(),
        device: window.innerWidth >= 768 ? 'pc' : 'mobile',
      }),
    })
  },
  finish(collectionId: number, difficulty: string, gameType: string,
         totalTimeSec: number, pointTimes: number[], isWin = true) {
    return request<{ data: FinishCollectionResponse }>('/api/collection/finish', {
      method: 'POST',
      body: JSON.stringify({
        collection_id: collectionId, difficulty, game_type: gameType,
        total_time_sec: totalTimeSec, point_times: pointTimes, is_win: isWin,
        session_id: getSessionId(),
      }),
    })
  },
  medalWall(userId?: number, difficulty?: string) {
    const sid = getSessionId()
    const params = new URLSearchParams()
    if (userId) params.set('user_id', String(userId))
    if (difficulty) params.set('difficulty', difficulty)
    if (sid) params.set('session_id', sid)
    return request<{ data: MedalWallGroup[] }>(`/api/medal/wall?${params}`)
  },
  leaderboardSingle(collectionId: number, difficulty: string, limit = 50) {
    const params = new URLSearchParams({
      scope: 'single', collection_id: String(collectionId), difficulty, limit: String(limit),
    })
    return request<{ data: LeaderboardRow[] }>(`/api/collection/leaderboard?${params}`)
  },
  leaderboardPoi(poiId: number, difficulty: string, limit = 50) {
    const params = new URLSearchParams({
      scope: 'poi', poi_id: String(poiId), difficulty, limit: String(limit),
    })
    return request<{ data: LeaderboardRow[] }>(`/api/collection/leaderboard?${params}`)
  },
  leaderboardMedalCount(limit = 100, difficulty?: string) {
    const params = new URLSearchParams({ scope: 'medal_count', limit: String(limit) })
    if (difficulty) params.set('difficulty', difficulty)
    return request<{ data: LeaderboardRow[] }>(
      `/api/collection/leaderboard?${params}`
    )
  },
  tracks(userId?: number) {
    const params = new URLSearchParams()
    if (userId) params.set('user_id', String(userId))
    else {
      const sid = getSessionId()
      if (sid) params.set('session_id', sid)
    }
    const q = params.toString() ? `?${params}` : ''
    return request<{ data: TrackPoint[] }>(`/api/collection/tracks${q}`)
  },
}

import type {
  StartResponse,
  MoveResponse,
  CheckViewResponse,
  ClickResponse,
  HintResponse,
  LocationHintResponse,
  Region,
  Theme,
  GameState,
  GiveUpResponse,
} from '../types'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('map_pk_token')
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    // 403（积分不足/配额超限）抛带 detail 的 Error，前端 catch 后走 toast
    throw new Error(data.detail || `请求失败: ${res.status}`)
  }
  return res.json()
}

export const api = {
  startGame(
    mode: string,
    regionCode?: string,
    difficulty: string = 'hard',
    category?: string,
    device: 'pc' | 'mobile' = 'pc',
    startLng?: number,
    startLat?: number
  ) {
    return request<StartResponse>('/api/game/start', {
      method: 'POST',
      body: JSON.stringify({
        mode,
        region_code: regionCode,
        difficulty,
        category,
        device,
        start_lng: startLng,
        start_lat: startLat,
      }),
    })
  },

  move(gameId: number, direction: string, distanceKm: number) {
    return request<MoveResponse>('/api/game/move', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId, direction, distance_km: distanceKm }),
    })
  },

  updateView(gameId: number, lng: number, lat: number) {
    return request('/api/game/update-view', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId, lng, lat }),
    })
  },

  checkView(gameId: number, west: number, south: number, east: number, north: number) {
    return request<CheckViewResponse>('/api/game/check-view', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId, west, south, east, north }),
    })
  },

  clickTarget(gameId: number, lng: number, lat: number) {
    return request<ClickResponse>('/api/game/click', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId, lng, lat }),
    })
  },

  getHint(gameId: number, hintLevel: number) {
    return request<HintResponse>('/api/game/hint', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId, hint_level: hintLevel }),
    })
  },

  // 困难 C 救济：当前视野所在省/市与目标省/市对比（不暴露目标省/市）
  getLocationHint(gameId: number, stage: 'province' | 'city') {
    return request<LocationHintResponse>(
      `/api/game/${gameId}/location-hint?stage=${stage}`
    )
  },

  giveUp(gameId: number) {
    return request<GiveUpResponse>('/api/game/giveup', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId }),
    })
  },

  getState(gameId: number) {
    return request<GameState>(`/api/game/state/${gameId}`)
  },

  getRegions(level: number, parentCode?: string) {
    const params = new URLSearchParams({ level: String(level) })
    if (parentCode) params.set('parent_code', parentCode)
    return request<Region[]>(`/api/game/regions?${params}`)
  },

  getThemes() {
    return request<Theme[]>('/api/game/themes')
  },

  // ===== 玩家行为统计（无登录，session_id 存 localStorage） =====
  reportSession(data: {
    session_id: string
    nickname?: string
    mode: string
    region_code?: string
    category?: string
    difficulty: string
    game_type: 'solo' | 'pk'
    target_poi_id?: number
  }) {
    return request<{ id: number; session_id: string }>('/api/admin/session', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  endSession(sessionId: number, data: { won: boolean; score: number; duration_sec: number }) {
    return request<{ ok: boolean }>(`/api/admin/session/${sessionId}/end`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // ===== UGC 贡献 =====
  contribute(data: {
    session_id: string
    nickname?: string
    name: string
    province_code?: string
    category?: string
    lng: number
    lat: number
    description?: string
    cover_url?: string
    suggested_shape_type?: 'point' | 'circle' | 'polygon'
    suggested_radius_km?: number
    suggested_area_geojson?: string
  }) {
    return request<{ id: number }>('/api/contribute', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  uploadCover(file: File, onProgress?: (pct: number) => void): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
      const fd = new FormData()
      fd.append('file', file)
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }
      xhr.onload = () => {
        if (xhr.status === 200) {
          try { resolve(JSON.parse(xhr.responseText)) }
          catch { reject(new Error('解析响应失败')) }
        } else {
          try {
            const d = JSON.parse(xhr.responseText)
            reject(new Error(d.detail || '上传失败'))
          } catch { reject(new Error('上传失败')) }
        }
      }
      xhr.onerror = () => reject(new Error('网络错误'))
      xhr.open('POST', '/api/upload')
      xhr.send(fd)
    })
  },

  // ===== 意见留言 =====
  submitFeedback(data: {
    content: string
    image_urls?: string[]
    contact?: string
    nickname?: string
  }) {
    return request<{ id: number; message: string }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ ...data, session_id: getSessionId() }),
    })
  },

  // 本人历史反馈与官方回复
  getMyFeedback(page = 1, size = 50) {
    const params = new URLSearchParams({ session_id: getSessionId(), page: String(page), size: String(size) })
    return request<FeedbackHistory>(`/api/feedback/mine?${params}`)
  },

  // 本人投稿记录 + 纠正记录
  getMySubmissions(page = 1, size = 50) {
    const params = new URLSearchParams({ session_id: getSessionId(), page: String(page), size: String(size) })
    return request<SubmissionHistory>(`/api/contribute/mine?${params}`)
  },

  // POI 基本信息（纠正表单预填）
  getPoiPublic(poiId: number) {
    return request<PoiPublic>(`/api/poi/${poiId}`)
  },

  // 提交 POI 纠正（审核采纳后写回）
  submitCorrection(data: {
    poi_id: number
    session_id: string
    nickname?: string
    name?: string
    category?: string
    lng?: number
    lat?: number
    description?: string
    cover_url?: string
    suggested_shape_type?: string
    suggested_radius_km?: number
    suggested_area_geojson?: string
  }) {
    return request<{ id: number; message: string }>('/api/correction', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // 开发计划 + 用户评价
  getDevPlans(sessionId: string) {
    return request<{ items: DevPlanItem[] }>(`/api/dev-plans?session_id=${encodeURIComponent(sessionId)}`)
  },
  getDevPlanFeedbacks(planId: number, page = 1, size = 20) {
    return request<DevPlanFeedbackList>(`/api/dev-plans/${planId}/feedbacks?page=${page}&size=${size}`)
  },
  submitDevPlanFeedback(planId: number, data: {
    session_id: string
    attitude: 'like' | 'dislike'
    comment?: string
    images?: string[]
    nickname?: string
  }) {
    return request<{ feedback: DevPlanFeedbackItem; like_count: number; dislike_count: number }>(
      `/api/dev-plans/${planId}/feedback`,
      { method: 'POST', body: JSON.stringify(data) },
    )
  },
  withdrawDevPlanFeedback(planId: number, sessionId: string) {
    return request<{ ok: boolean; like_count: number; dislike_count: number }>(
      `/api/dev-plans/${planId}/feedback/withdraw`,
      { method: 'POST', body: JSON.stringify({ session_id: sessionId }) },
    )
  },
}

export interface PoiPublic {
  id: number
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

export interface FeedbackHistoryItem {
  id: number
  content: string
  image_urls: string[]
  nickname?: string | null
  admin_reply?: string | null
  replied_at?: string | null
  created_at?: string
}
export interface FeedbackHistory {
  total: number
  items: FeedbackHistoryItem[]
}
export interface SubmissionHistoryItem {
  id: number
  name: string
  category?: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewer_note?: string | null
  submitted_at?: string | null
}
export interface SubmissionHistory {
  total: number
  items: SubmissionHistoryItem[]
  corrections_total?: number
  corrections?: CorrectionHistoryItem[]
}
export interface CorrectionHistoryItem {
  id: number
  poi_id: number
  name: string | null
  status: 'pending' | 'adopted' | 'rejected'
  reviewer_note?: string | null
  created_at?: string | null
}

// 开发计划 + 用户评价
export interface DevPlanItem {
  id: number
  title: string
  content: string
  status: 'planning' | 'done' | 'abandoned'
  sort_order: number
  created_at?: string | null
  like_count: number
  dislike_count: number
  feedback_total?: number
  my_attitude: 'like' | 'dislike' | null
}
export interface DevPlanFeedbackItem {
  id: number
  plan_id: number
  nickname: string | null
  attitude: 'like' | 'dislike'
  comment: string | null
  images: string[]
  created_at?: string | null
}
export interface DevPlanFeedbackList {
  total: number
  page: number
  page_size: number
  items: DevPlanFeedbackItem[]
}

// 会话 ID 工具（无登录玩家行为追踪）
const SESSION_KEY = 'map_session_id'
export function getSessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const id =
    (crypto as any).randomUUID?.() ||
    'sess-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  localStorage.setItem(SESSION_KEY, id)
  return id
}

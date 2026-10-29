/**
 * 新闻时间线 API 客户端（小寻带你看新闻）
 * 进度按 session_id 记录；登录用户自动带 token 关联 user
 */
import { getSessionId } from './index'
import { getToken } from './collection'

export interface NewsTimelineItem {
  id: number
  code: string
  name: string
  description: string | null
  color: string | null
  cover_url: string | null
  medal_icon_url?: string | null
  batch: string | null
  point_count: number
  /** 列表接口：各模式进度 */
  found_easy?: number
  found_hard?: number
  /** 详情/回顾接口：当前模式进度 */
  mode?: 'easy' | 'hard'
  other_found_easy?: number
  other_found_hard?: number
  medal_earned?: boolean
  found_count: number
  completed: boolean
}

export interface NewsPoiLocked {
  id: number
  /** 定位地名（事件名"｜"前段） */
  location?: string
  region?: string | null
  event_date: string | null
  hint_text: string | null
  difficulty: number
  sort_order: number
  found: boolean
}

export interface NewsPoiUnlocked extends NewsPoiLocked {
  name: string
  event_text: string | null
  fact_text: string | null
  lng: number
  lat: number
  region: string | null
  cover_url: string | null
  found: true
}

export type NewsPoiPoint = NewsPoiLocked | NewsPoiUnlocked

export interface NewsTimelineDetail extends NewsTimelineItem {
  mode: 'easy' | 'hard'
  start_lng?: number
  start_lat?: number
  time_limit?: number
  medal_earned?: boolean
  current: NewsPoiLocked | null
  points: NewsPoiPoint[]
}

export interface NewsFoundResponse {
  hit: boolean
  distance_km?: number
  tolerance_km?: number
  need_zoom?: boolean
  distance_bucket?: string
  poi?: NewsPoiUnlocked
  next?: NewsPoiLocked | null
  found_count?: number
  point_count?: number
  completed?: boolean
  medal_awarded?: boolean
  medal_icon_url?: string | null
  medal_name?: string
}

export interface NewsSummary extends NewsTimelineItem {
  medal_awarded?: boolean
  points: (NewsPoiUnlocked & { link_url?: string | null; link_source?: string | null })[]
}

export interface NewsMedalItem {
  timeline_id: number
  code: string
  name: string
  color: string | null
  icon_url: string | null
  batch: string | null
  mode: 'easy' | 'hard'
  mode_label: string
  earned: boolean
  earned_at: string | null
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
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `请求失败: ${res.status}`)
  }
  return res.json()
}

const sid = () => getSessionId()

export const newsApi = {
  list() {
    return request<{ data: NewsTimelineItem[] }>(
      `/api/news/timelines?session_id=${encodeURIComponent(sid())}`,
    )
  },
  detail(code: string, mode: 'easy' | 'hard' = 'easy') {
    return request<{ data: NewsTimelineDetail }>(
      `/api/news/timelines/${code}?mode=${mode}&session_id=${encodeURIComponent(sid())}`,
    )
  },
  found(code: string, poiId: number, lng: number, lat: number, mode: 'easy' | 'hard') {
    return request<{ data: NewsFoundResponse }>('/api/news/timelines/' + code + '/found', {
      method: 'POST',
      body: JSON.stringify({ poi_id: poiId, lng, lat, mode, session_id: sid() }),
    })
  },
  checkView(code: string, west: number, south: number, east: number, north: number, mode: 'easy' | 'hard') {
    return request<{ data: NewsFoundResponse }>('/api/news/timelines/' + code + '/check-view', {
      method: 'POST',
      body: JSON.stringify({ west, south, east, north, mode, session_id: sid() }),
    })
  },
  summary(code: string, mode: 'easy' | 'hard') {
    return request<{ data: NewsSummary }>(
      `/api/news/timelines/${code}/summary?mode=${mode}&session_id=${encodeURIComponent(sid())}`,
    )
  },
  medals() {
    return request<{ data: NewsMedalItem[] }>('/api/news/medals')
  },
  /** 巡航移动（无状态）：从视野中心沿方向移动 */
  move(code: string, lng: number, lat: number, direction: string, distanceKm: number) {
    return request<{ data: { view_lng: number; view_lat: number } }>(
      `/api/news/timelines/${code}/move`,
      { method: 'POST', body: JSON.stringify({ lng, lat, direction, distance_km: distanceKm }) },
    )
  },
  /** 新闻提示（对齐自由模式分级） */
  hint(code: string, lng: number, lat: number, hintLevel: number, mode: 'easy' | 'hard',
       device: string, hintCredits: number, poiId?: number) {
    return request<{ data: Record<string, any> }>(
      `/api/news/timelines/${code}/hint`,
      {
        method: 'POST',
        body: JSON.stringify({
          lng, lat, hint_level: hintLevel, mode, device,
          hint_credits: hintCredits, poi_id: poiId,
        }),
      },
    )
  },
  /** 新闻事件纠错反馈 */
  submitCorrection(newsPoiId: number, content: string, contact?: string) {
    return request<{ data: { id: number; message: string } }>('/api/news/correction', {
      method: 'POST',
      body: JSON.stringify({
        news_poi_id: newsPoiId, content, contact,
        session_id: sid(),
        nickname: (() => {
          try {
            const raw = localStorage.getItem('map_pk_user')
            return raw ? JSON.parse(raw)?.nickname ?? null : null
          } catch { return null }
        })(),
      }),
    })
  },
}

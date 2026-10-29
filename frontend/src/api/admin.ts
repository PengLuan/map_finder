import type {
  AdminTheme,
  AdminPOI,
  AdminPOIList,
  SessionList,
  Overview,
  SubmissionList,
  AdminPOIInput,
  ThemeInput,
  ApproveInput,
  FeedbackItem,
  CorrectionItem,
  AdminCollection,
  AdminCollectionList,
  CollectionInput,
  CollectionPoiList,
  AdminUserList,
  UserUpdateInput,
  UserMedalItem,
  CollectionLeaderRow,
  POILeaderRow,
} from '../types/admin'

const TOKEN_KEY = 'map_admin_token'

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAdminToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function loginAdmin(username: string, password: string): Promise<string> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '用户名或密码错误')
  }
  if (!res.ok) {
    throw new Error(`登录失败: ${res.status}`)
  }
  const data = await res.json()
  setAdminToken(data.token)
  return data.token
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAdminToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { headers, ...options })
  if (res.status === 401) {
    clearAdminToken()
    throw new Error('未登录或登录已失效')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `请求失败: ${res.status}`)
  }
  return res.json()
}

export const adminApi = {
  // 主题
  listThemes(all = false) {
    return request<AdminTheme[]>(`/api/admin/themes${all ? '?all=true' : ''}`)
  },
  createTheme(data: ThemeInput) {
    return request<{ id: number; code: string }>('/api/admin/themes', {
      method: 'POST', body: JSON.stringify(data),
    })
  },
  updateTheme(code: string, data: ThemeInput) {
    return request<{ ok: boolean }>(`/api/admin/themes/${code}`, {
      method: 'PUT', body: JSON.stringify(data),
    })
  },
  deleteTheme(code: string) {
    return request<{ ok: boolean }>(`/api/admin/themes/${code}`, { method: 'DELETE' })
  },

  // POI
  listPois(params: Record<string, string | number | undefined>) {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') q.set(k, String(v))
    })
    return request<AdminPOIList>(`/api/admin/pois?${q}`)
  },
  getPoi(id: number) {
    return request<AdminPOI>(`/api/admin/pois/${id}`)
  },
  createPoi(data: AdminPOIInput) {
    return request<AdminPOI>('/api/admin/pois', { method: 'POST', body: JSON.stringify(data) })
  },
  updatePoi(id: number, data: AdminPOIInput) {
    return request<AdminPOI>(`/api/admin/pois/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  },
  deletePoi(id: number) {
    return request<{ ok: boolean }>(`/api/admin/pois/${id}`, { method: 'DELETE' })
  },
  confirmPoiArea(id: number) {
    return request<AdminPOI>(`/api/admin/pois/${id}/confirm-area`, { method: 'POST' })
  },

  // 会话统计
  overview() {
    return request<Overview>('/api/admin/overview')
  },
  listSessions(params: Record<string, string | number | undefined>) {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') q.set(k, String(v))
    })
    return request<SessionList>(`/api/admin/sessions?${q}`)
  },

  // 投稿审核
  listSubmissions(status?: string, page = 1, pageSize = 20) {
    const q = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    if (status) q.set('status', status)
    return request<SubmissionList>(`/api/admin/submissions?${q}`)
  },
  approveSubmission(id: number, data: ApproveInput) {
    return request<{ ok: boolean; poi_id: number }>(`/api/admin/submissions/${id}/approve`, {
      method: 'POST', body: JSON.stringify(data),
    })
  },
  rejectSubmission(id: number, note: string) {
    return request<{ ok: boolean }>(`/api/admin/submissions/${id}/reject`, {
      method: 'POST', body: JSON.stringify({ note }),
    })
  },

  // 意见留言
  listFeedback(page = 1, pageSize = 20, search = '', sort: 'desc' | 'asc' = 'desc', replied: '' | 'yes' | 'no' = '') {
    const params = new URLSearchParams({ page: String(page), size: String(pageSize) })
    if (search) params.set('search', search)
    params.set('sort', sort)
    if (replied) params.set('replied', replied)
    return request<{ total: number; items: FeedbackItem[] }>(
      `/api/admin/feedback?${params}`,
    )
  },
  replyFeedback(id: number, reply: string) {
    return request<{ message: string; replied_at: string }>(
      `/api/admin/feedback/${id}/reply`,
      { method: 'POST', body: JSON.stringify({ reply }) },
    )
  },
  deleteFeedback(id: number) {
    return request<{ message: string }>(`/api/admin/feedback/${id}`, { method: 'DELETE' })
  },
  // ===== POI 纠正审核 =====
  listCorrections(status: '' | 'pending' | 'adopted' | 'rejected' = '', page = 1, pageSize = 20) {
    const params = new URLSearchParams({ page: String(page), size: String(pageSize) })
    if (status) params.set('status', status)
    return request<{ total: number; items: CorrectionItem[] }>(`/api/admin/corrections?${params}`)
  },
  adoptCorrection(id: number) {
    return request<CorrectionItem>(`/api/admin/corrections/${id}/adopt`, { method: 'POST' })
  },
  rejectCorrection(id: number, note: string) {
    return request<CorrectionItem>(`/api/admin/corrections/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    })
  },

  // 专题管理
  listCollections(params: Record<string, string | number | undefined>) {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') q.set(k, String(v))
    })
    return request<AdminCollectionList>(`/api/admin/collections?${q}`)
  },
  createCollection(data: CollectionInput) {
    return request<{ id: number; code: string }>('/api/admin/collections', {
      method: 'POST', body: JSON.stringify(data),
    })
  },
  updateCollection(id: number, data: CollectionInput) {
    return request<{ ok: boolean }>(`/api/admin/collections/${id}`, {
      method: 'PUT', body: JSON.stringify(data),
    })
  },
  deleteCollection(id: number) {
    return request<{ ok: boolean }>(`/api/admin/collections/${id}`, { method: 'DELETE' })
  },
  listCollectionPois(id: number) {
    return request<CollectionPoiList>(`/api/admin/collections/${id}/pois`)
  },
  setCollectionPois(id: number, poiIds: number[]) {
    return request<{ ok: boolean; count: number }>(`/api/admin/collections/${id}/pois`, {
      method: 'PUT', body: JSON.stringify({ poi_ids: poiIds }),
    })
  },

  // 用户管理
  listUsers(params: Record<string, string | number | undefined>) {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') q.set(k, String(v))
    })
    return request<AdminUserList>(`/api/admin/users?${q}`)
  },
  updateUser(id: number, data: UserUpdateInput) {
    return request<{ ok: boolean }>(`/api/admin/users/${id}`, {
      method: 'PUT', body: JSON.stringify(data),
    })
  },
  deleteUser(id: number) {
    return request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' })
  },
  getUserMedals(id: number) {
    return request<UserMedalItem[]>(`/api/admin/users/${id}/medals`)
  },
  getCollectionLeaderboard(id: number, difficulty: string, limit = 50) {
    return request<CollectionLeaderRow[]>(
      `/api/admin/collections/${id}/leaderboard?difficulty=${difficulty}&limit=${limit}`,
    )
  },
  getPOILeaderboard(poiId: number, collectionId: number, difficulty: string, limit = 50) {
    return request<POILeaderRow[]>(
      `/api/admin/pois/${poiId}/leaderboard?collection_id=${collectionId}&difficulty=${difficulty}&limit=${limit}`,
    )
  },

  // ===== 开发计划 + 用户评价 =====
  listDevPlans(page = 1, pageSize = 50) {
    return request<DevPlanAdminList>(`/api/admin/dev-plans?page=${page}&size=${pageSize}`)
  },
  createDevPlan(data: DevPlanInput) {
    return request<DevPlanAdminItem>('/api/admin/dev-plans', { method: 'POST', body: JSON.stringify(data) })
  },
  updateDevPlan(id: number, data: DevPlanInput) {
    return request<DevPlanAdminItem>(`/api/admin/dev-plans/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  },
  deleteDevPlan(id: number) {
    return request<{ ok: boolean }>(`/api/admin/dev-plans/${id}`, { method: 'DELETE' })
  },
  listDevPlanFeedbacks(planId: number, page = 1, pageSize = 50) {
    return request<DevPlanFeedbackAdminList>(`/api/admin/dev-plan-feedbacks?plan_id=${planId}&page=${page}&size=${pageSize}`)
  },
  deleteDevPlanFeedback(feedbackId: number) {
    return request<{ ok: boolean }>(`/api/admin/dev-plan-feedbacks/${feedbackId}`, { method: 'DELETE' })
  },

  // ===== 新闻时间线 =====
  listNewsTimelines(keyword?: string, auditStatus?: string) {
    const q = new URLSearchParams()
    if (keyword) q.set('keyword', keyword)
    if (auditStatus) q.set('audit_status', auditStatus)
    return request<NewsTimelineList>(`/api/admin/news/timelines?${q}`)
  },
  getNewsStats() {
    return request<NewsStats>('/api/admin/news/stats')
  },
  createNewsTimeline(data: NewsTimelineInput) {
    return request<{ id: number; code: string }>('/api/admin/news/timelines', {
      method: 'POST', body: JSON.stringify(data),
    })
  },
  updateNewsTimeline(id: number, data: NewsTimelineInput) {
    return request<{ ok: boolean }>(`/api/admin/news/timelines/${id}`, {
      method: 'PUT', body: JSON.stringify(data),
    })
  },
  deleteNewsTimeline(id: number) {
    return request<{ ok: boolean }>(`/api/admin/news/timelines/${id}`, { method: 'DELETE' })
  },
  listNewsPois(timelineId: number) {
    return request<{ items: NewsPoiItem[] }>(`/api/admin/news/timelines/${timelineId}/pois`)
  },
  createNewsPoi(data: NewsPoiInput) {
    return request<{ id: number }>('/api/admin/news/pois', {
      method: 'POST', body: JSON.stringify(data),
    })
  },
  updateNewsPoi(id: number, data: NewsPoiInput) {
    return request<{ ok: boolean }>(`/api/admin/news/pois/${id}`, {
      method: 'PUT', body: JSON.stringify(data),
    })
  },
  deleteNewsPoi(id: number) {
    return request<{ ok: boolean }>(`/api/admin/news/pois/${id}`, { method: 'DELETE' })
  },
  listNewsCorrections(status?: string) {
    const q = status ? `?status=${encodeURIComponent(status)}` : ''
    return request<{ items: NewsCorrectionItem[] }>(`/api/admin/news/corrections${q}`)
  },
  handleNewsCorrection(id: number, note?: string) {
    return request<{ ok: boolean }>(`/api/admin/news/corrections/${id}/handle`, {
      method: 'POST', body: JSON.stringify({ note }),
    })
  },
}

export interface NewsCorrectionItem {
  id: number
  news_poi_id: number
  poi_name: string | null
  poi_name_full: string | null
  session_id: string
  nickname: string | null
  content: string
  contact: string | null
  status: 'pending' | 'handled'
  created_at: string | null
}

// ===== 新闻时间线类型 =====
export interface NewsTimelineItem {
  id: number
  code: string
  name: string
  description: string | null
  color: string | null
  cover_url: string | null
  medal_icon_url: string | null
  batch: string | null
  sort_order: number
  audit_status: 'pending' | 'approved'
  enabled: boolean
  poi_count: number
  approved_count: number
  verified_count: number
}
export interface NewsTimelineList {
  items: NewsTimelineItem[]
}
export interface NewsStats {
  pending_pois: number
  unverified_pois: number
  timelines: number
  pois: number
  found_records: number
}
export interface NewsTimelineInput {
  code: string
  name: string
  description?: string | null
  color?: string | null
  cover_url?: string | null
  medal_icon_url?: string | null
  batch?: string | null
  sort_order: number
  audit_status: 'pending' | 'approved'
  enabled: boolean
}
export interface NewsPoiItem {
  id: number
  timeline_id: number
  name: string
  event_date: string | null
  event_text: string | null
  fact_text: string | null
  hint_text: string | null
  link_url: string | null
  link_source: string | null
  lng: number
  lat: number
  region: string | null
  difficulty: number
  cover_url: string | null
  sort_order: number
  verified: boolean
  status: 'pending' | 'approved' | 'rejected'
}
export interface NewsPoiInput {
  timeline_id?: number
  name: string
  event_date?: string | null
  event_text?: string | null
  fact_text?: string | null
  hint_text?: string | null
  link_url?: string | null
  link_source?: string | null
  lng: number
  lat: number
  region?: string | null
  difficulty: number
  cover_url?: string | null
  sort_order: number
  verified: boolean
  status: 'pending' | 'approved' | 'rejected'
}

export interface DevPlanAdminItem {
  id: number
  title: string
  content: string
  status: 'planning' | 'done' | 'abandoned'
  sort_order: number
  created_at?: string | null
  like_count: number
  dislike_count: number
  feedback_total?: number
}
export interface DevPlanAdminList {
  total: number
  page: number
  page_size: number
  items: DevPlanAdminItem[]
}
export interface DevPlanInput {
  title: string
  content: string
  status: 'planning' | 'done' | 'abandoned'
  sort_order: number
}
export interface DevPlanFeedbackAdminItem {
  id: number
  plan_id: number
  nickname: string | null
  attitude: 'like' | 'dislike'
  comment: string | null
  images: string[]
  created_at?: string | null
  withdrawn?: boolean
  withdrawn_at?: string | null
}
export interface DevPlanFeedbackAdminList {
  total: number
  page: number
  page_size: number
  items: DevPlanFeedbackAdminItem[]
}

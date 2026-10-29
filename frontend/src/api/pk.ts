import type {
  RoomStatus,
  PKGameState,
  UserStatus,
  PKStartResponse,
  PKCheckViewResponse,
  PKClickResponse,
  PKHintResponse,
} from '../types/pk'

const TOKEN_KEY = 'map_pk_token'
const USER_KEY = 'map_pk_user'

export interface StoredUser {
  id: number
  nickname: string
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setStoredUser(user: StoredUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function isLoggedIn(): boolean {
  return !!getToken() && !!getStoredUser()
}

async function pkRequest<T>(url: string, options?: RequestInit): Promise<T> {
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
      // token 已过期：清理本地登录态，引导重新登录
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    }
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `请求失败: ${res.status}`)
  }
  return res.json()
}

export const pkApi = {
  // 认证
  login(nickname: string) {
    return pkRequest<{ token: string; user: StoredUser }>('/api/auth/nickname', {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    })
  },

  recommendNicknames(count: number) {
    return pkRequest<{ nicknames: string[] }>(`/api/auth/recommend?count=${count}`)
  },

  // 房间
  createRoom(mode: string, regionCode?: string, difficulty: string = 'hard', category?: string) {
    return pkRequest<{ room_code: string; room_id: number }>('/api/pk/room/create', {
      method: 'POST',
      body: JSON.stringify({ mode, region_code: regionCode, difficulty, category }),
    })
  },

  joinRoom(roomCode: string) {
    return pkRequest<{
      room_id: number
      host_user_id: number
      mode: string
      region_code: string | null
      difficulty: string
    }>('/api/pk/room/join', {
      method: 'POST',
      body: JSON.stringify({ room_code: roomCode }),
    })
  },

  getRoomStatus(roomId: number) {
    return pkRequest<RoomStatus>(`/api/pk/room/${roomId}/status`)
  },

  leaveRoom(roomId: number) {
    return pkRequest<{ status: string; reason: string }>(`/api/pk/room/${roomId}/leave`, {
      method: 'POST',
    })
  },

  startGame(roomId: number) {
    return pkRequest<PKStartResponse>(`/api/pk/room/${roomId}/start`, { method: 'POST' })
  },

  rematch(roomId: number) {
    return pkRequest<{
      my_rematch: boolean
      opponent_rematch: boolean
      both_ready: boolean
      new_game_id: number | null
    }>(`/api/pk/room/${roomId}/rematch`, { method: 'POST' })
  },

  // 游戏
  getGameState(gameId: number) {
    return pkRequest<PKGameState>(`/api/pk/game/${gameId}/state`)
  },

  move(gameId: number, direction: string, distanceKm: number) {
    return pkRequest<{ view_lng: number; view_lat: number }>(`/api/pk/game/${gameId}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction, distance_km: distanceKm }),
    })
  },

  updateView(gameId: number, lng: number, lat: number) {
    return pkRequest(`/api/pk/game/${gameId}/update-view`, {
      method: 'POST',
      body: JSON.stringify({ lng, lat }),
    })
  },

  checkView(gameId: number, west: number, south: number, east: number, north: number) {
    return pkRequest<PKCheckViewResponse>(`/api/pk/game/${gameId}/check-view`, {
      method: 'POST',
      body: JSON.stringify({ west, south, east, north }),
    })
  },

  clickTarget(gameId: number, lng: number, lat: number) {
    return pkRequest<PKClickResponse>(`/api/pk/game/${gameId}/click`, {
      method: 'POST',
      body: JSON.stringify({ lng, lat }),
    })
  },

  useHint(gameId: number, hintLevel: number) {
    return pkRequest<PKHintResponse>(`/api/pk/game/${gameId}/hint`, {
      method: 'POST',
      body: JSON.stringify({ hint_level: hintLevel }),
    })
  },

  giveUp(gameId: number) {
    return pkRequest<{ success: boolean }>(`/api/pk/game/${gameId}/give-up`, {
      method: 'POST',
    })
  },

  // 状态恢复 & 心跳
  getUserStatus() {
    return pkRequest<UserStatus>('/api/pk/user/status')
  },

  heartbeat(roomId: number) {
    return pkRequest('/api/pk/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ room_id: roomId }),
    })
  },

  cleanup() {
    return pkRequest<{ cleaned: number }>('/api/pk/cleanup', { method: 'POST' })
  },
}

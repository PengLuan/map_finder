// 游戏记录本地存储（localStorage，最近 20 条）

export interface GameRecordItem {
  ts: number // 结算时间戳
  mode: string // national / provincial / city
  difficulty: string // easy / hard
  hit: boolean // 是否命中
  score: number
  distance_km: number // 最终距目标距离
  target_name: string
  total_distance_km: number // 累计移动距离
  // 复盘所需字段
  target_lng: number | null
  target_lat: number | null
  duration_sec: number
  target_cover: string | null
  contributor: string | null
}

const KEY = 'map_game_records'
const MAX = 20

export function saveGameRecord(item: GameRecordItem): void {
  try {
    const list = getGameRecords()
    list.unshift(item)
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    // localStorage 不可用时静默忽略
  }
}

export function getGameRecords(): GameRecordItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function clearGameRecords(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 忽略
  }
}

// 提示系统纯逻辑工具：设备识别 / 积分显示 / 距离区间判定 / 时间阈值 / 防抖距离
// 全部为无副作用纯函数，便于 vitest 单元测试（不依赖 Leaflet DOM）。

/** 设备识别：移动端判定（PC 弱化 / 移动强化分流依据） */
export function detectIsMobile(width: number, userAgent: string): boolean {
  return width < 768 || /Mobi|Android|iPhone/i.test(userAgent)
}

/** 浏览器环境一次性识别（SSR 安全） */
export function detectIsMobileEnv(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return detectIsMobile(window.innerWidth, navigator.userAgent)
}

// ===== 积分（机会）机制 =====
export const HINT_CREDITS_INITIAL = 100
/** 积分 ≤ 该阈值时变红警示 */
export const HINT_CREDITS_LOW = 20

export function isCreditsLow(credits: number): boolean {
  return credits <= HINT_CREDITS_LOW
}

/** 积分显示颜色 class（≤20 红 / 其余 青） */
export function creditsTextClass(credits: number): string {
  return isCreditsLow(credits) ? 'text-red-400' : 'text-cyan-400'
}

// ===== 距离区间（B 救济） =====
/** 规范化区间字符串：去空白、小写，便于匹配后端可能带空格的文案 */
export function normalizeBucket(bucket: string): string {
  return bucket.replace(/\s+/g, '').toLowerCase()
}

// PC 触发 B 救济的区间：≤10km
const NEAR_BUCKETS_PC = ['1km以内', '1-5km']
// 移动触发 B 救济的区间：≤30km
const NEAR_BUCKETS_MOBILE = ['1km以内', '1-5km', '5-20km']

/**
 * 判断当前 distance_bucket 是否触发困难 B 救济（"快到了"自动 toast）。
 * PC 阈值 ≤10km；移动阈值 ≤30km。
 */
export function isNearTargetBucket(bucket: string | undefined | null, isMobile: boolean): boolean {
  if (!bucket) return false
  const b = normalizeBucket(bucket)
  const list = isMobile ? NEAR_BUCKETS_MOBILE : NEAR_BUCKETS_PC
  return list.some((x) => normalizeBucket(x) === b)
}

/** B 救济防抖：上次触发后需再移动多少 km 才能再次触发 */
export function bReliefMinMoveKm(isMobile: boolean): number {
  return isMobile ? 5 : 10
}

// ===== C 救济：按剩余时间比例触发省/市提示 =====
// PC: 省 ≤30%, 市 ≤15%；移动: 省 ≤50%, 市 ≤20%
export function shouldTriggerCProvince(ratio: number, isMobile: boolean): boolean {
  return ratio <= (isMobile ? 0.5 : 0.3)
}
export function shouldTriggerCCity(ratio: number, isMobile: boolean): boolean {
  return ratio <= (isMobile ? 0.2 : 0.15)
}

// ===== 403 错误识别 =====
/**
 * 判断是否为提示被拦截错误（积分不足 / 配额超限）。
 * 后端 request 对 403 抛带 detail 的 Error，这里识别关键词后走 toast 而非红色弹窗。
 */
export function isHintBlockedError(error: unknown): boolean {
  if (!error) return false
  const msg = error instanceof Error ? error.message : String(error)
  return /积分不足|次数已用完|已用完|机会已用完/.test(msg)
}

/** 提示按钮单次消耗标注文案，如 "(-10)" */
export function hintCostText(pcCost: number, mobileCost: number, isMobile: boolean): string {
  return `(-${isMobile ? mobileCost : pcCost})`
}

// ===== Haversine 距离（B 救济防抖用，比较视野中心移动距离） =====
export function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

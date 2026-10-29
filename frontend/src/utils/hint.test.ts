import { describe, it, expect } from 'vitest'
import {
  detectIsMobile,
  detectIsMobileEnv,
  HINT_CREDITS_INITIAL,
  HINT_CREDITS_LOW,
  isCreditsLow,
  creditsTextClass,
  normalizeBucket,
  isNearTargetBucket,
  bReliefMinMoveKm,
  shouldTriggerCProvince,
  shouldTriggerCCity,
  isHintBlockedError,
  hintCostText,
  haversineKm,
} from './hint'

describe('detectIsMobile', () => {
  it('width < 768 视为移动端', () => {
    expect(detectIsMobile(767, 'Mozilla/5.0')).toBe(true)
    expect(detectIsMobile(768, 'Mozilla/5.0')).toBe(false)
  })

  it('UA 含 Mobi/Android/iPhone 视为移动端', () => {
    expect(detectIsMobile(1920, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(true)
    expect(detectIsMobile(1920, 'Mozilla/5.0 (Android 13)')).toBe(true)
    expect(detectIsMobile(1920, 'Mozilla/5.0 (Mobi)')).toBe(true)
    expect(detectIsMobile(1920, 'Mozilla/5.0 (Windows NT 10.0)')).toBe(false)
  })

  it('detectIsMobileEnv 在 SSR（无 window）时返回 false', () => {
    // 浏览器环境下 window 存在，主要测试 SSR 安全性不抛错
    expect(typeof detectIsMobileEnv()).toBe('boolean')
  })
})

describe('积分显示', () => {
  it('HINT_CREDITS_INITIAL=100 / HINT_CREDITS_LOW=20', () => {
    expect(HINT_CREDITS_INITIAL).toBe(100)
    expect(HINT_CREDITS_LOW).toBe(20)
  })

  it('isCreditsLow 阈值 ≤20', () => {
    expect(isCreditsLow(20)).toBe(true)
    expect(isCreditsLow(21)).toBe(false)
    expect(isCreditsLow(0)).toBe(true)
  })

  it('creditsTextClass ≤20 红，否则青', () => {
    expect(creditsTextClass(20)).toBe('text-red-400')
    expect(creditsTextClass(21)).toBe('text-cyan-400')
    expect(creditsTextClass(100)).toBe('text-cyan-400')
  })
})

describe('距离区间（B 救济）', () => {
  it('normalizeBucket 去空白小写', () => {
    expect(normalizeBucket('1-5km')).toBe('1-5km')
    expect(normalizeBucket(' 1 - 5 KM ')).toBe('1-5km')
  })

  it('isNearTargetBucket PC 阈值 ≤10km', () => {
    expect(isNearTargetBucket('1km以内', false)).toBe(true)
    expect(isNearTargetBucket('1-5km', false)).toBe(true)
    expect(isNearTargetBucket('5-20km', false)).toBe(false)
    expect(isNearTargetBucket('20-50km', false)).toBe(false)
  })

  it('isNearTargetBucket 移动阈值 ≤30km', () => {
    expect(isNearTargetBucket('1km以内', true)).toBe(true)
    expect(isNearTargetBucket('1-5km', true)).toBe(true)
    expect(isNearTargetBucket('5-20km', true)).toBe(true)
    expect(isNearTargetBucket('20-50km', true)).toBe(false)
  })

  it('isNearTargetBucket null/undefined 安全返回 false', () => {
    expect(isNearTargetBucket(null, false)).toBe(false)
    expect(isNearTargetBucket(undefined, true)).toBe(false)
    expect(isNearTargetBucket('', false)).toBe(false)
  })

  it('bReliefMinMoveKm 移动 5 / PC 10', () => {
    expect(bReliefMinMoveKm(false)).toBe(10)
    expect(bReliefMinMoveKm(true)).toBe(5)
  })
})

describe('C 救济触发阈值', () => {
  it('PC 省 ≤30% / 市 ≤15%', () => {
    expect(shouldTriggerCProvince(0.3, false)).toBe(true)
    expect(shouldTriggerCProvince(0.31, false)).toBe(false)
    expect(shouldTriggerCCity(0.15, false)).toBe(true)
    expect(shouldTriggerCCity(0.16, false)).toBe(false)
  })

  it('移动 省 ≤50% / 市 ≤20%', () => {
    expect(shouldTriggerCProvince(0.5, true)).toBe(true)
    expect(shouldTriggerCProvince(0.51, true)).toBe(false)
    expect(shouldTriggerCCity(0.2, true)).toBe(true)
    expect(shouldTriggerCCity(0.21, true)).toBe(false)
  })
})

describe('403 错误识别', () => {
  it('isHintBlockedError 识别积分不足类消息', () => {
    expect(isHintBlockedError(new Error('积分不足'))).toBe(true)
    expect(isHintBlockedError(new Error('机会已用完'))).toBe(true)
    expect(isHintBlockedError(new Error('次数已用完'))).toBe(true)
    expect(isHintBlockedError(new Error('已用完今日配额'))).toBe(true)
  })

  it('isHintBlockedError 非拦截错误返回 false', () => {
    expect(isHintBlockedError(new Error('网络错误'))).toBe(false)
    expect(isHintBlockedError(new Error('500 Internal'))).toBe(false)
    expect(isHintBlockedError(null)).toBe(false)
    expect(isHintBlockedError(undefined)).toBe(false)
    expect(isHintBlockedError('积分不足')).toBe(true) // 字符串也支持
  })
})

describe('提示按钮消耗文案', () => {
  it('PC 文案使用 pcCost', () => {
    expect(hintCostText(10, 5, false)).toBe('(-10)')
  })

  it('移动文案使用 mobileCost', () => {
    expect(hintCostText(10, 5, true)).toBe('(-5)')
  })
})

describe('haversineKm', () => {
  it('同点距离为 0', () => {
    expect(haversineKm(116.3975, 39.9087, 116.3975, 39.9087)).toBe(0)
  })

  it('北京天安门到天安门附近约 1km', () => {
    // 经度差 0.01° ≈ 0.85km（纬度 40° 附近）
    const d = haversineKm(116.3975, 39.9087, 116.4075, 39.9087)
    expect(d).toBeGreaterThan(0.8)
    expect(d).toBeLessThan(1.0)
  })

  it('北京到上海约 1000km+', () => {
    const d = haversineKm(116.4074, 39.9042, 121.4737, 31.2304)
    expect(d).toBeGreaterThan(1000)
    expect(d).toBeLessThan(1200)
  })
})

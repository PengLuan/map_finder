import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import {
  DIR_VEC,
  DIR_LABEL,
  OPPOSITE,
} from './constants'
import type { GameApiAdapter, CheckViewResult } from './types'
import { useTrailSystem } from './useTrailSystem'
import { useZoomManager } from './useZoomManager'

export interface CruiseSystemParams {
  // 共享 ref（由父组件/InteractiveMapBase 管理）
  mapRef: React.MutableRefObject<L.Map | null>
  gameIdRef: React.MutableRefObject<number | null>
  endedRef: React.MutableRefObject<boolean>
  labelLayerRef: React.MutableRefObject<L.TileLayer | null>
  zoomRestoringRef: React.MutableRefObject<boolean>

  // 配置
  difficulty: string
  cruiseSpeeds: number[]

  // API
  apiAdapter: GameApiAdapter

  // 回调
  onCheckView: (result: CheckViewResult) => void
  setTotalDist: (updater: (prev: number) => number) => void
}

export interface CruiseSystemReturn {
  // UI 状态
  cruiseDirUI: string | null
  cruiseSpeedUI: number
  cruiseDistUI: number
  cruiseZoomed: boolean
  cruiseMsg: string

  // 控制
  startCruise: (dir: string) => void
  stopCruise: () => void
  speedUp: () => void
  handleCruiseClick: (dir: string) => void

  // 供 moveend/父组件使用
  syncAndCheck: () => void
  showToast: (msg: string) => void
  cruiseActiveRef: React.MutableRefObject<boolean>
  cruiseDirRef: React.MutableRefObject<string | null>
  lastDirRef: React.MutableRefObject<string | null>
  /** 巡航降级前的原始 zoom（供外层在专题命中时改写为当前 zoom，避免恢复缩放） */
  cruiseOrigZoomRef: React.MutableRefObject<number | null>
  metersPerPixel: () => number
  /** 重置所有内部状态（新一局/地图重建时调用） */
  reset: () => void
}

export function useCruiseSystem(params: CruiseSystemParams): CruiseSystemReturn {
  const {
    mapRef,
    gameIdRef,
    endedRef,
    labelLayerRef,
    zoomRestoringRef,
    difficulty,
    cruiseSpeeds,
    apiAdapter,
    onCheckView,
    setTotalDist,
  } = params

  // ---- 巡航 UI 状态 ----
  const [cruiseDirUI, setCruiseDirUI] = useState<string | null>(null)
  const [cruiseSpeedUI, setCruiseSpeedUI] = useState(0)
  const [cruiseDistUI, setCruiseDistUI] = useState(0)
  const [cruiseMsg, setCruiseMsg] = useState('')

  // ---- 巡航 ref ----
  const cruiseActiveRef = useRef(false)
  const cruiseDirRef = useRef<string | null>(null)
  const cruiseSpeedIdxRef = useRef(0)
  const cruiseDistRef = useRef(0)
  const cruiseSpeedsRef = useRef(cruiseSpeeds)
  const cruiseLoopRef = useRef<(ts: number) => void>(() => {})
  const lastDirRef = useRef<string | null>(null)
  const lastTsRef = useRef(0)
  const lastCheckRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const shiftDownRef = useRef(false)

  // ---- 依赖 Hook：轨迹系统 + 缩放管理 ----
  const trail = useTrailSystem({ mapRef })
  const zoomMgr = useZoomManager({ mapRef, labelLayerRef, zoomRestoringRef, difficulty })

  // ---- showToast 包装 ----
  const showToast = useCallback((msg: string) => setCruiseMsg(msg), [])
  useEffect(() => {
    if (!cruiseMsg) return
    const t = setTimeout(() => setCruiseMsg(''), 1500)
    return () => clearTimeout(t)
  }, [cruiseMsg])

  // ---- 工具函数 ----
  const metersPerPixel = useCallback(() => {
    const map = mapRef.current
    if (!map) return 1000
    const center = map.getCenter()
    const cp = map.latLngToContainerPoint(center)
    const east = map.containerPointToLatLng([cp.x + 100, cp.y])
    return map.distance(center, east) / 100
  }, [mapRef])

  // ---- 同步服务端中心 + 视野判定（节流） ----
  const syncAndCheck = useCallback(() => {
    const map = mapRef.current
    const id = gameIdRef.current
    if (!map || !id || endedRef.current) return
    const center = map.getCenter()
    apiAdapter.updateView(id, center.lng, center.lat).catch(() => {})
    // zoom 恢复中或巡航中跳过视野判定，避免误触发结算；停下来才判定
    if (zoomRestoringRef.current || cruiseActiveRef.current) return
    const b = map.getBounds()
    apiAdapter
      .checkView(id, b.getWest(), b.getSouth(), b.getEast(), b.getNorth())
      .then((res) => onCheckView(res as CheckViewResult))
      .catch(() => {})
  }, [mapRef, gameIdRef, endedRef, apiAdapter, onCheckView, zoomRestoringRef, cruiseActiveRef])

  // ---- 巡航循环（存入 ref，避免闭包过期） ----
  useEffect(() => {
    cruiseLoopRef.current = (ts: number) => {
      const map = mapRef.current
      if (!map || !cruiseActiveRef.current || endedRef.current) {
        if (endedRef.current) {
          cruiseActiveRef.current = false
          if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
          // 巡航中游戏结束（命中/放弃/超时），恢复降级的 zoom
          zoomMgr.restoreZoom()
        }
        return
      }
      const dir = cruiseDirRef.current
      if (!dir) return
      const last = lastTsRef.current || ts
      const dt = Math.min(50, ts - last)
      lastTsRef.current = ts
      const idx = cruiseSpeedIdxRef.current
      const baseSpeed = cruiseSpeedsRef.current[idx - 1] || 0
      const speedKmS = shiftDownRef.current ? baseSpeed / 5 : baseSpeed
      if (speedKmS > 0 && dt > 0) {
        const mpp = metersPerPixel()
        const pixPerSec = (speedKmS * 1000) / mpp
        const pix = (pixPerSec * dt) / 1000
        const [vx, vy] = DIR_VEC[dir]
        map.panBy([vx * pix, vy * pix], { animate: false })
        // 累计本次巡航移动距离（km）
        cruiseDistRef.current += speedKmS * (dt / 1000)
        trail.trailPointsRef.current.push(map.getCenter())
        if (trail.trailPointsRef.current.length > 300) trail.trailPointsRef.current.shift()
        trail.updateTrail()
      }
      if (ts - lastCheckRef.current > 200) {
        lastCheckRef.current = ts
        syncAndCheck()
        setCruiseDistUI(cruiseDistRef.current)
        // 飞行中定期纠正 zoom 倍率，确保与当前速度档位匹配
        zoomMgr.adjustZoomForSpeedIdx(cruiseSpeedIdxRef.current)
      }
      rafRef.current = requestAnimationFrame((t) => cruiseLoopRef.current(t))
    }
  })

  // ---- 停止巡航 ----
  const stopCruise = useCallback(() => {
    cruiseActiveRef.current = false
    cruiseDirRef.current = null
    cruiseSpeedIdxRef.current = 0
    setCruiseDirUI(null)
    setCruiseSpeedUI(0)
    // 将本次巡航距离累加到总距离
    const d = cruiseDistRef.current
    if (d > 0) setTotalDist((prev) => prev + d)
    cruiseDistRef.current = 0
    setCruiseDistUI(0)
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    // 恢复巡航降级的 zoom（内部处理标注层恢复 + zoomRestoringRef）
    zoomMgr.restoreZoom()
    syncAndCheck()
    showToast('已停止')
    trail.fadeTrail()
  }, [syncAndCheck, showToast, trail.fadeTrail, zoomMgr.restoreZoom, setTotalDist, rafRef, cruiseDistRef, cruiseActiveRef, cruiseDirRef, cruiseSpeedIdxRef])

  // ---- 开始巡航 ----
  const startCruise = useCallback((dir: string) => {
    if (endedRef.current) return
    const map = mapRef.current
    if (!map) return
    // 记录本次是否为转弯（已在巡航中换方向）
    const isTurning = cruiseActiveRef.current
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    // 清除旧轨迹（切换方向 / 新一局）
    trail.clearTrail()
    // 切换方向时，先把本次巡航距离累加到总距离，避免累积飞行清零
    if (isTurning && cruiseDistRef.current > 0) {
      const d = cruiseDistRef.current
      setTotalDist((prev) => prev + d)
    }
    if (isTurning) {
      // 已在巡航中（转弯换方向）：不降速，保持当前速度档位，zoom 维持当前级别
    } else {
      // 首次启动：从 1 档开始；困难模式巡航开始时临时降级 zoom 加速瓦片加载
      cruiseSpeedIdxRef.current = 1
      if (!zoomMgr.cruiseZoomReducedRef.current) {
        zoomMgr.reduceZoomForCruiseStart()
      }
    }
    cruiseDirRef.current = dir
    cruiseActiveRef.current = true
    lastDirRef.current = dir
    cruiseDistRef.current = 0
    setCruiseDistUI(0)
    setCruiseDirUI(dir)
    const curSpeed = cruiseSpeedsRef.current[cruiseSpeedIdxRef.current - 1]
    setCruiseSpeedUI(curSpeed)
    trail.trailPointsRef.current = [map.getCenter()]
    lastTsRef.current = 0
    lastCheckRef.current = 0
    rafRef.current = requestAnimationFrame((t) => cruiseLoopRef.current(t))
    showToast(
      isTurning
        ? `转向${DIR_LABEL[dir]}，保持 ${curSpeed} km/秒`
        : `向${DIR_LABEL[dir]}巡航 ${curSpeed} km/秒，再次点击速度翻倍`,
    )
  }, [showToast, trail.clearTrail, trail.trailPointsRef, zoomMgr.reduceZoomForCruiseStart, zoomMgr.cruiseZoomReducedRef, zoomMgr.cruiseOrigZoomRef, setTotalDist, mapRef, endedRef, cruiseDistRef, cruiseActiveRef, cruiseDirRef, cruiseSpeedIdxRef, cruiseSpeedsRef])

  // ---- 加速 ----
  const speedUp = useCallback(() => {
    if (cruiseSpeedIdxRef.current >= cruiseSpeedsRef.current.length) {
      stopCruise()
      return
    }
    cruiseSpeedIdxRef.current += 1
    const s = cruiseSpeedsRef.current[cruiseSpeedIdxRef.current - 1]
    setCruiseSpeedUI(s)
    // 困难模式：速度档位变化时同步调整 zoom 降级数（速度越快降级越多）
    zoomMgr.adjustZoomForSpeedIdx(cruiseSpeedIdxRef.current)
    if (cruiseSpeedIdxRef.current >= cruiseSpeedsRef.current.length) {
      showToast(`已达最高速度 ${s} km/秒，再次点击停止`)
    } else {
      const next = cruiseSpeedsRef.current[cruiseSpeedIdxRef.current]
      showToast(`提速至 ${s} km/秒，再次点击提速至 ${next}`)
    }
  }, [stopCruise, showToast, zoomMgr.adjustZoomForSpeedIdx, cruiseSpeedIdxRef, cruiseSpeedsRef])

  // ---- 巡航点击处理 ----
  const handleCruiseClick = useCallback((dir: string) => {
    const cur = cruiseDirRef.current
    if (cur === dir) {
      speedUp()
    } else if (cur && OPPOSITE[cur] === dir) {
      stopCruise()
    } else {
      startCruise(dir)
    }
  }, [speedUp, stopCruise, startCruise, cruiseDirRef])

  // ---- 键盘巡航 ----
  useEffect(() => {
    if (difficulty === 'easy') return
    const AXIS: Record<string, string> = {
      w: 'up', arrowup: 'up',
      s: 'down', arrowdown: 'down',
      a: 'left', arrowleft: 'left',
      d: 'right', arrowright: 'right',
    }
    const DIAG: Record<string, string> = { q: 'NW', e: 'NE', z: 'SW', c: 'SE' }
    const keysDown = new Set<string>()
    const computeCombo = (): string | null => {
      const u = keysDown.has('up'), d = keysDown.has('down'), l = keysDown.has('left'), r = keysDown.has('right')
      if (u && l) return 'NW'
      if (u && r) return 'NE'
      if (d && l) return 'SW'
      if (d && r) return 'SE'
      if (u) return 'N'
      if (d) return 'S'
      if (l) return 'W'
      if (r) return 'E'
      return null
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (endedRef.current) return
      const key = e.key.toLowerCase()
      if (key === 'shift') { shiftDownRef.current = true; return }
      const axis = AXIS[key]
      if (axis) {
        e.preventDefault()
        if (e.repeat) return
        keysDown.add(axis)
        const combo = computeCombo()
        if (!combo) return
        if (combo === cruiseDirRef.current) speedUp()
        else startCruise(combo)
        return
      }
      const diag = DIAG[key]
      if (diag) {
        e.preventDefault()
        if (e.repeat) return
        keysDown.clear()
        if (cruiseDirRef.current === diag) speedUp()
        else startCruise(diag)
        return
      }
      if (key === ' ' || key === 'spacebar') { e.preventDefault(); stopCruise(); keysDown.clear() }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === 'shift') { shiftDownRef.current = false; return }
      const axis = AXIS[key]
      if (axis) { keysDown.delete(axis); return }
      // 松手不停止、不变向，巡航保持当前方向
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [difficulty, startCruise, stopCruise, speedUp, endedRef])

  // ---- 重置（新一局/地图重建时调用） ----
  const reset = useCallback(() => {
    cruiseActiveRef.current = false
    cruiseDirRef.current = null
    cruiseSpeedIdxRef.current = 0
    cruiseDistRef.current = 0
    lastDirRef.current = null
    lastTsRef.current = 0
    lastCheckRef.current = 0
    shiftDownRef.current = false
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    trail.reset()
    zoomMgr.reset()
    setCruiseDirUI(null)
    setCruiseSpeedUI(0)
    setCruiseDistUI(0)
    setCruiseMsg('')
  }, [trail.reset, zoomMgr.reset])

  return {
    cruiseDirUI,
    cruiseSpeedUI,
    cruiseDistUI,
    cruiseZoomed: zoomMgr.cruiseZoomed,
    cruiseMsg,
    startCruise,
    stopCruise,
    speedUp,
    handleCruiseClick,
    syncAndCheck,
    showToast,
    cruiseActiveRef,
    cruiseDirRef,
    lastDirRef,
    cruiseOrigZoomRef: zoomMgr.cruiseOrigZoomRef,
    metersPerPixel,
    reset,
  }
}

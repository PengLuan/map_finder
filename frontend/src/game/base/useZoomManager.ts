import { useState, useRef, useCallback } from 'react'
import L from 'leaflet'
import { ZOOM_REDUCE_BY_SPEED_IDX } from './constants'

/**
 * 缩放/标注层管理 Hook
 * 职责：巡航降级 zoom 时移除标注层（隐藏地名文字），恢复时加回；
 *       放大恢复期间设置 zoomRestoringRef 跳过视野判定，避免误触发结算
 * 从 useCruiseSystem 抽取，保持行为完全一致
 */
export interface ZoomManagerParams {
  mapRef: React.MutableRefObject<L.Map | null>
  labelLayerRef: React.MutableRefObject<L.TileLayer | null>
  zoomRestoringRef: React.MutableRefObject<boolean>
  difficulty: string
}

export interface ZoomManagerReturn {
  cruiseZoomReducedRef: React.MutableRefObject<boolean>
  cruiseOrigZoomRef: React.MutableRefObject<number | null>
  /** 巡航降级中（UI 显示白色时速大字） */
  cruiseZoomed: boolean
  /**
   * 巡航开始时降级 zoom（仅困难模式 + 未降级时生效）
   * 先移除标注层再降级 zoom，减少同时渲染压力避免卡顿
   */
  reduceZoomForCruiseStart: () => void
  /**
   * 速度档位变化时同步调整 zoom 降级数（速度越快降级越多）
   */
  adjustZoomForSpeedIdx: (speedIdx: number) => void
  /**
   * 停止巡航 / 游戏结束时恢复 zoom
   * 立即恢复标注层（飞行停止后文字立即显示），放大恢复期间禁用视野判定
   */
  restoreZoom: () => void
  /** 重置所有缩放状态（地图销毁 / 再来一局） */
  reset: () => void
}

export function useZoomManager(params: ZoomManagerParams): ZoomManagerReturn {
  const { mapRef, labelLayerRef, zoomRestoringRef, difficulty } = params

  const cruiseZoomReducedRef = useRef(false)
  const cruiseOrigZoomRef = useRef<number | null>(null)
  /** 最近一次恢复的目标 zoom（修复：恢复动画期间再次巡航时，避免把"降级中的 zoom"当原始值导致棘轮式降级） */
  const restoreTargetZoomRef = useRef<number | null>(null)
  const [cruiseZoomed, setCruiseZoomed] = useState(false)

  const reduceZoomForCruiseStart = useCallback(() => {
    if (difficulty !== 'hard') return
    if (cruiseZoomReducedRef.current) return
    const map = mapRef.current
    if (!map) return
    // 先移除标注层再降级 zoom，减少同时渲染压力避免卡顿
    if (labelLayerRef.current && map.hasLayer(labelLayerRef.current)) {
      map.removeLayer(labelLayerRef.current)
    }
    cruiseZoomReducedRef.current = true
    // 若上一次恢复动画未完成（快速停→启），当前 zoom 可能仍是降级值，
    // 用记录的恢复目标 zoom 作为原始值，避免逐次累减最终缩放到全国视野
    let orig = map.getZoom()
    if (restoreTargetZoomRef.current != null && orig < restoreTargetZoomRef.current) {
      orig = restoreTargetZoomRef.current
    }
    cruiseOrigZoomRef.current = orig
    setCruiseZoomed(true)
    const reduce = ZOOM_REDUCE_BY_SPEED_IDX[0] || 1
    const targetZoom = Math.max(3, cruiseOrigZoomRef.current - reduce)
    map.setMinZoom(targetZoom)
    map.setZoom(targetZoom, { animate: false })
  }, [difficulty, mapRef, labelLayerRef, cruiseZoomReducedRef, cruiseOrigZoomRef, restoreTargetZoomRef])

  const adjustZoomForSpeedIdx = useCallback((speedIdx: number) => {
    if (!cruiseZoomReducedRef.current) return
    if (cruiseOrigZoomRef.current == null) return
    const map = mapRef.current
    if (!map) return
    // 困难模式：速度档位变化时同步调整 zoom 降级数（速度越快降级越多）
    const reduce = ZOOM_REDUCE_BY_SPEED_IDX[speedIdx - 1] || 1
    const targetZoom = Math.max(3, cruiseOrigZoomRef.current - reduce)
    map.setMinZoom(targetZoom)
    map.setZoom(targetZoom, { animate: true, duration: 0.3 })
  }, [mapRef, cruiseZoomReducedRef, cruiseOrigZoomRef])

  const restoreZoom = useCallback(() => {
    if (!cruiseZoomReducedRef.current) return
    cruiseZoomReducedRef.current = false
    setCruiseZoomed(false)
    const map = mapRef.current
    const origZoom = cruiseOrigZoomRef.current
    if (map && origZoom != null) {
      // 记录恢复目标：若恢复期间用户再次启动巡航，reduceZoomForCruiseStart 用它做原始值基准
      restoreTargetZoomRef.current = origZoom
      // 立即恢复标注层，飞行停止后文字立即显示
      if (labelLayerRef.current && !map.hasLayer(labelLayerRef.current)) {
        map.addLayer(labelLayerRef.current)
      }
      // 先放开 zoom 范围，避免 setMinZoom 钳制把 zoom 卡在错误位置
      map.setMinZoom(3)
      map.setMaxZoom(18)
      // 先设 zoomRestoringRef 并注册 zoomend 监听 + 保险超时，
      // 确保动画中断/未触发 zoomend 时也会释放，避免永久阻塞视野判定
      zoomRestoringRef.current = true
      const timer = window.setTimeout(() => {
        zoomRestoringRef.current = false
        // 超时但 flyTo 可能未完成；若期间又开始了新的巡航降级（cruiseZoomReducedRef 为 true），
        // 不要用旧的 origZoom 覆盖新巡航的降级 zoom
        const m = mapRef.current
        if (m && !cruiseZoomReducedRef.current) {
          m.setView(m.getCenter(), origZoom, { animate: false })
          restoreTargetZoomRef.current = null
        }
      }, 1200)
      map.once('zoomend', () => {
        clearTimeout(timer)
        zoomRestoringRef.current = false
        // 恢复真正完成后清除目标记录；若 zoomend 由新巡航的 setZoom 触发则保留
        if (!cruiseZoomReducedRef.current) restoreTargetZoomRef.current = null
      })
      map.flyTo(map.getCenter(), origZoom, { animate: true, duration: 0.5 })
    }
    cruiseOrigZoomRef.current = null
  }, [mapRef, labelLayerRef, zoomRestoringRef, cruiseZoomReducedRef, cruiseOrigZoomRef, restoreTargetZoomRef])

  const reset = useCallback(() => {
    cruiseZoomReducedRef.current = false
    cruiseOrigZoomRef.current = null
    restoreTargetZoomRef.current = null
    setCruiseZoomed(false)
  }, [])

  return {
    cruiseZoomReducedRef,
    cruiseOrigZoomRef,
    cruiseZoomed,
    reduceZoomForCruiseStart,
    adjustZoomForSpeedIdx,
    restoreZoom,
    reset,
  }
}

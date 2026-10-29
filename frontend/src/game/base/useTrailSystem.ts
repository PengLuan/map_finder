import { useRef, useCallback } from 'react'
import L from 'leaflet'

/**
 * 轨迹系统 Hook
 * 职责：巡航轨迹 polyline 的创建、更新、淡出、清理
 * 从 useCruiseSystem 抽取，保持行为完全一致
 */
export interface TrailSystemParams {
  mapRef: React.MutableRefObject<L.Map | null>
}

export interface TrailSystemReturn {
  trailRef: React.MutableRefObject<L.Polyline | null>
  trailPointsRef: React.MutableRefObject<L.LatLng[]>
  trailFadeTimerRef: React.MutableRefObject<number | null>
  /** 更新轨迹 polyline（不存在则创建） */
  updateTrail: () => void
  /** 淡出并移除轨迹 */
  fadeTrail: () => void
  /** 清除旧轨迹（startCruise 切换方向 / 新一局时调用） */
  clearTrail: () => void
  /** 重置所有轨迹状态（地图销毁 / 再来一局） */
  reset: () => void
}

export function useTrailSystem(params: TrailSystemParams): TrailSystemReturn {
  const { mapRef } = params

  const trailRef = useRef<L.Polyline | null>(null)
  const trailPointsRef = useRef<L.LatLng[]>([])
  const trailFadeTimerRef = useRef<number | null>(null)

  const updateTrail = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    if (trailRef.current) {
      trailRef.current.setLatLngs(trailPointsRef.current)
    } else {
      trailRef.current = L.polyline(trailPointsRef.current, {
        color: '#22d3ee', weight: 3, opacity: 0.7,
      }).addTo(map)
    }
  }, [mapRef])

  const fadeTrail = useCallback(() => {
    const trail = trailRef.current
    if (!trail) return
    let opacity = 0.7
    const step = () => {
      opacity -= 0.06
      if (opacity <= 0) {
        if (trailRef.current) {
          mapRef.current?.removeLayer(trailRef.current)
          trailRef.current = null
        }
        trailPointsRef.current = []
        return
      }
      trail.setStyle({ opacity })
      trailFadeTimerRef.current = window.setTimeout(step, 50)
    }
    step()
  }, [mapRef])

  const clearTrail = useCallback(() => {
    const map = mapRef.current
    if (trailFadeTimerRef.current) {
      clearTimeout(trailFadeTimerRef.current)
      trailFadeTimerRef.current = null
    }
    if (trailRef.current && map) {
      map.removeLayer(trailRef.current)
      trailRef.current = null
    }
    trailPointsRef.current = []
  }, [mapRef])

  const reset = useCallback(() => {
    if (trailFadeTimerRef.current) {
      clearTimeout(trailFadeTimerRef.current)
      trailFadeTimerRef.current = null
    }
    trailRef.current = null
    trailPointsRef.current = []
  }, [])

  return {
    trailRef,
    trailPointsRef,
    trailFadeTimerRef,
    updateTrail,
    fadeTrail,
    clearTrail,
    reset,
  }
}

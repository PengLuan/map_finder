import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import { ZOOM_CONFIG, PICK_ICON } from './constants'
import { addTileLayers } from './tileLayers'
import { useCruiseSystem } from './useCruiseSystem'
import type { GameApiAdapter, CheckViewResult } from './types'
import type { CruiseSystemReturn } from './useCruiseSystem'

/**
 * InteractiveMapBase — 交互地图基础组件
 *
 * 职责：地图容器创建、瓦片加载、moveend/click 事件绑定、巡航系统集成
 * 通过 render prop 将 map 句柄（refs + cruise）暴露给父组件
 *
 * 使用 React key 属性控制重建：父组件改变 key → 组件卸载重建
 *  - Game.tsx: key={game.game_id}（新一局重建）
 *  - PKGame.tsx: key={gameId}（rematch 重建）
 */
export interface InteractiveMapHandle {
  mapRef: React.MutableRefObject<L.Map | null>
  cruise: CruiseSystemReturn
  pickMarkerRef: React.MutableRefObject<L.Marker | null>
  picked: { lng: number; lat: number } | null
  setPicked: React.Dispatch<React.SetStateAction<{ lng: number; lat: number } | null>>
  hintRectRef: React.MutableRefObject<L.Rectangle | null>
  targetMarkerRef: React.MutableRefObject<L.Marker | null>
  targetShapeLayerRef: React.MutableRefObject<L.Layer | null>
  zoomControlRef: React.MutableRefObject<L.Control.Zoom | null>
}

export interface InteractiveMapBaseProps {
  // 地图初始化数据
  startLng: number
  startLat: number
  mode: string
  difficulty: string

  // 游戏状态 ref（由父组件管理，map 事件 + 巡航系统读取）
  gameIdRef: React.MutableRefObject<number | null>
  endedRef: React.MutableRefObject<boolean>

  // API + 巡航
  apiAdapter: GameApiAdapter
  cruiseSpeeds: number[]
  onCheckView: (result: CheckViewResult) => void
  setTotalDist: (updater: (prev: number) => number) => void

  // isMobile（简单模式缩放控件等差异）
  isMobile: boolean

  // 初始 zoom（仅 easy 模式生效，用于新局继承上一局结束时的 zoom 比例）
  initZoom?: number

  // render prop：父组件接收 map 句柄并返回 JSX
  children: (handle: InteractiveMapHandle) => React.ReactNode
}

export function InteractiveMapBase(props: InteractiveMapBaseProps) {
  const {
    startLng,
    startLat,
    mode,
    difficulty,
    gameIdRef,
    endedRef,
    apiAdapter,
    cruiseSpeeds,
    onCheckView,
    setTotalDist,
    children,
  } = props

  // ---- ref（内部管理） ----
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const labelLayerRef = useRef<L.TileLayer | null>(null)
  const zoomRestoringRef = useRef(false)
  const pickMarkerRef = useRef<L.Marker | null>(null)
  const zoomControlRef = useRef<L.Control.Zoom | null>(null)
  const hintRectRef = useRef<L.Rectangle | null>(null)
  const targetMarkerRef = useRef<L.Marker | null>(null)
  const targetShapeLayerRef = useRef<L.Layer | null>(null)
  const mapReadyRef = useRef(false)

  // ---- 简单模式落点状态 ----
  const [picked, setPicked] = useState<{ lng: number; lat: number } | null>(null)

  // ---- onCheckView ref 包装：避免 useCruiseSystem 闭包过期 ----
  const onCheckViewRef = useRef(onCheckView)
  onCheckViewRef.current = onCheckView
  const stableOnCheckView = useCallback((res: CheckViewResult) => {
    onCheckViewRef.current(res)
  }, [])

  // ---- 巡航系统 ----
  const cruise = useCruiseSystem({
    mapRef,
    gameIdRef,
    endedRef,
    labelLayerRef,
    zoomRestoringRef,
    difficulty,
    cruiseSpeeds,
    apiAdapter,
    onCheckView: stableOnCheckView,
    setTotalDist,
  })

  // ---- 地图初始化（只在条件满足时创建一次，mapReadyRef 防止重复） ----
  useEffect(() => {
    if (!mapContainerRef.current || mapReadyRef.current) return
    if (!Number.isFinite(startLng) || !Number.isFinite(startLat)) return
    if (!mode || !difficulty) return
    mapReadyRef.current = true

    const isEasy = difficulty === 'easy'
    const zoomCfg = ZOOM_CONFIG[mode] || ZOOM_CONFIG.national
    const initZoom = (isEasy && props.initZoom != null) ? props.initZoom : zoomCfg.start
    const map = L.map(mapContainerRef.current, {
      center: [startLat, startLng],
      zoom: initZoom,
      minZoom: isEasy ? 3 : zoomCfg.start,
      maxZoom: isEasy ? 18 : zoomCfg.start,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: isEasy,
      doubleClickZoom: isEasy,
      touchZoom: isEasy,
      boxZoom: false,
      keyboard: false,
    })

    labelLayerRef.current = addTileLayers(map)
    mapRef.current = map
    zoomControlRef.current = null
    if (isEasy) {
      zoomControlRef.current = L.control.zoom({ position: 'bottomright' }).addTo(map)
    }

    // moveend：同步服务端中心；困难模式追加视野框判定
    map.on('moveend', () => {
      const id = gameIdRef.current
      if (!id || endedRef.current || zoomRestoringRef.current) return
      if (cruise.cruiseActiveRef.current) return
      const center = map.getCenter()
      apiAdapter.updateView(id, center.lng, center.lat).catch(() => {})
      if (isEasy) return
      cruise.syncAndCheck()
    })

    // 简单模式：点击地图放置落点标记，可拖拽微调
    if (isEasy) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        if (endedRef.current) return
        if (pickMarkerRef.current) {
          pickMarkerRef.current.setLatLng(e.latlng)
        } else {
          const marker = L.marker(e.latlng, {
            icon: PICK_ICON,
            draggable: true,
            zIndexOffset: 900,
          }).addTo(map)
          marker.on('drag', () => {
            const p = marker.getLatLng()
            setPicked({ lng: p.lng, lat: p.lat })
          })
          pickMarkerRef.current = marker
        }
        setPicked({ lng: e.latlng.lng, lat: e.latlng.lat })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLng, startLat, mode, difficulty])

  // ---- 卸载时销毁地图 + 重置所有 ref ----
  useEffect(() => {
    return () => {
      const map = mapRef.current
      if (map) {
        map.remove()
        mapRef.current = null
      }
      mapReadyRef.current = false
      pickMarkerRef.current = null
      labelLayerRef.current = null
      targetMarkerRef.current = null
      hintRectRef.current = null
      targetShapeLayerRef.current = null
      zoomControlRef.current = null
      cruise.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 组装 render prop 句柄 ----
  const handle: InteractiveMapHandle = {
    mapRef,
    cruise,
    pickMarkerRef,
    picked,
    setPicked,
    hintRectRef,
    targetMarkerRef,
    targetShapeLayerRef,
    zoomControlRef,
  }

  return (
    <div className="h-full relative">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />
      {children(handle)}
    </div>
  )
}

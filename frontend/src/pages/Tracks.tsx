/**
 * Tracks — 我的足迹
 * 全屏 Leaflet 地图，展示玩家在所有专题中收集过的 POI
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import L from 'leaflet'
import { collectionApi, isLoggedIn, type TrackPoint } from '../api/collection'
import AuthModal from '../components/AuthModal'
import { addTileLayers } from '../game/base/tileLayers'
import { PICK_ICON } from '../game/base/constants'

interface Props {
  onBack: () => void
}

export default function Tracks({ onBack }: Props) {
  const [authed, setAuthed] = useState(isLoggedIn())
  const [points, setPoints] = useState<TrackPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAuth, setShowAuth] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.Marker[]>([])

  const load = useCallback(async () => {
    if (!isLoggedIn()) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const res = await collectionApi.tracks()
      setPoints(res.data)
    } catch (e: any) { setError(e.message || '加载失败') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // 初始化地图（登录后容器渲染时）
  useEffect(() => {
    if (!authed || mapRef.current || !containerRef.current) return
    const map = L.map(containerRef.current, {
      center: [35, 105],
      zoom: 4,
      worldCopyJump: true,
      zoomControl: false,
    })
    addTileLayers(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [authed])

  // 渲染标记点
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((m) => map.removeLayer(m))
    markersRef.current = []

    const latlngs: L.LatLngTuple[] = []
    points.forEach((p) => {
      const m = L.marker([p.lat, p.lng], { icon: PICK_ICON }).addTo(map)
      m.bindTooltip(p.name, {
        permanent: true,
        direction: 'top',
        offset: [0, -42],
        className: 'track-point-label text-center',
      })
      const coverUrl = p.cover_url || p.collection_cover_url
      const cover = coverUrl
        ? `<img src="${coverUrl}" alt="${p.name}" style="width:100%; height:120px; object-fit:cover; border-radius:8px 8px 0 0;" />`
        : ''
      m.bindPopup(
        `<div style="width:220px; margin:-13px -19px -15px; overflow:hidden;">${cover}` +
        `<div style="padding:10px 12px;"><div style="font-weight:bold; font-size:15px; margin-bottom:4px;">${p.name}</div>` +
        `<div style="font-size:12px; color:#64748b; margin-bottom:6px;">${p.collection_name || '自由探索'}</div>` +
        `${p.summary ? `<div style="font-size:12px; line-height:1.5; color:#475569;">${p.summary}</div>` : ''}` +
        `${p.poi_id != null ? `<button onclick="window.dispatchEvent(new CustomEvent('open-correction',{detail:{poiId:${p.poi_id}}}))" style="margin-top:8px; width:100%; padding:4px 0; font-size:11px; color:#94a3b8; background:none; border:none; cursor:pointer;">✎ 地点信息有误？纠正此地点</button>` : ''}</div></div>`
      )
      markersRef.current.push(m)
      latlngs.push([p.lat, p.lng])
    })
    if (latlngs.length > 1) {
      map.fitBounds(latlngs, { padding: [40, 40] })
    } else if (latlngs.length === 1) {
      map.setView(latlngs[0], 12)
    }
  }, [points])

  if (!authed) {
    return (
      <div className="h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="shrink-0 p-4 pb-2">
          <button onClick={onBack} className="text-sm text-slate-400 hover:text-cyan-300 transition-colors">
            ← 返回
          </button>
          <h1 className="font-hud text-2xl md:text-3xl text-cyan-400 glow-cyan text-center mt-3">
            🗺️ 我的足迹
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl mb-3">🗺️</div>
            <p className="text-slate-400 mb-4">登录后查看你的收集足迹</p>
            <button
              onClick={() => setShowAuth(true)}
              className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-sm font-bold text-white"
            >
              登录 / 注册
            </button>
          </div>
        </div>
        {showAuth && (
          <AuthModal
            onClose={() => setShowAuth(false)}
            onSuccess={() => { setShowAuth(false); setAuthed(true); load() }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-slate-900">
      <div className="absolute top-0 left-0 right-0 z-[1001] p-4 bg-gradient-to-b from-slate-900/90 to-transparent pointer-events-none">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="pointer-events-auto px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-white"
          >
            ← 返回
          </button>
          <h1 className="font-hud text-xl text-cyan-300">🗺️ 我的足迹</h1>
          <span className="text-xs text-slate-400">{points.length} 个点位</span>
        </div>
      </div>

      <div ref={containerRef} className="absolute inset-0" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-[1100] bg-slate-900/60">
          <span className="text-cyan-300">加载中...</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-[1100] bg-slate-900/80">
          <span className="text-red-400">{error}</span>
        </div>
      )}
      {!loading && !error && points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-[1000] pointer-events-none">
          <div className="bg-slate-800/90 px-6 py-4 rounded-xl border border-slate-700 text-center">
            <div className="text-3xl mb-2">🗺️</div>
            <p className="text-slate-300 text-sm">还没有收集记录，去完成一个专题吧</p>
          </div>
        </div>
      )}
    </div>
  )
}

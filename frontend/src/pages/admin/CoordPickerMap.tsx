/**
 * CoordPickerMap — 后台通用坐标拾取地图
 * 卫星底图 + 可拖拽水滴 marker + 点击设点 + 高德地名搜索定位
 * 用于新闻 POI 核定 / POI 编辑等需要可视核对坐标的场景
 */
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { addTileLayers } from '../../game/base/tileLayers'

const DROP_ICON = L.divIcon({
  className: '',
  html:
    '<svg width="36" height="36" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.5))">' +
    '<path d="M12 1.6C7.4 1.6 3.7 5.3 3.7 9.9c0 5.6 8.3 12.5 8.3 12.5s8.3-6.9 8.3-12.5c0-4.6-3.7-8.3-8.3-8.3z" fill="#f59e0b" stroke="#ffffff" stroke-width="1.5"/>' +
    '<circle cx="12" cy="9.5" r="2.8" fill="#ffffff"/>' +
    '</svg>',
  iconSize: [36, 36],
  iconAnchor: [18, 33],
})

interface Props {
  lng: number
  lat: number
  onChange: (lng: number, lat: number) => void
}

export default function CoordPickerMap({ lng, lat, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const initialRef = useRef({ lng, lat })
  const [searchKw, setSearchKw] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchMsg, setSearchMsg] = useState('')

  // 初始化地图（弹窗每次打开重新挂载）
  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return
    const hasCoord = Number.isFinite(initialRef.current.lng) && Number.isFinite(initialRef.current.lat)
      && (initialRef.current.lng !== 0 || initialRef.current.lat !== 0)
    const map = L.map(container, {
      center: hasCoord ? [initialRef.current.lat, initialRef.current.lng] : [33.5, 106.5],
      zoom: hasCoord ? 15 : 4,
      minZoom: 3,
      maxZoom: 18,
      zoomControl: true,
      attributionControl: false,
    })
    addTileLayers(map)
    if (hasCoord) {
      const marker = L.marker([initialRef.current.lat, initialRef.current.lng], {
        icon: DROP_ICON,
        draggable: true,
        zIndexOffset: 900,
      }).addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        onChange(Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6)))
      })
      markerRef.current = marker
    }
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (markerRef.current) {
        markerRef.current.setLatLng(e.latlng)
      } else {
        markerRef.current = L.marker(e.latlng, { icon: DROP_ICON, draggable: true, zIndexOffset: 900 }).addTo(map)
        markerRef.current.on('dragend', () => {
          const p = markerRef.current!.getLatLng()
          onChange(Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6)))
        })
      }
      onChange(Number(e.latlng.lng.toFixed(6)), Number(e.latlng.lat.toFixed(6)))
    })
    mapRef.current = map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部坐标变化（如表单回填）→ 移动 marker 与视野
  useEffect(() => {
    const map = mapRef.current
    if (!map || !Number.isFinite(lng) || !Number.isFinite(lat)) return
    if (lng === 0 && lat === 0) return
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng])
    } else {
      markerRef.current = L.marker([lat, lng], { icon: DROP_ICON, draggable: true, zIndexOffset: 900 }).addTo(map)
      markerRef.current.on('dragend', () => {
        const p = markerRef.current!.getLatLng()
        onChange(Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6)))
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lng, lat])

  // 高德地名搜索定位
  const doSearch = () => {
    const kw = searchKw.trim()
    if (!kw || searching) return
    setSearching(true)
    setSearchMsg('')
    fetch(`/api/geocode?keyword=${encodeURIComponent(kw)}`)
      .then((r) => r.json())
      .then((d) => {
        const first = d?.items?.[0]
        if (!first) {
          setSearchMsg('未找到该地名')
          return
        }
        onChange(Number(first.lng.toFixed(6)), Number(first.lat.toFixed(6)))
        mapRef.current?.flyTo([first.lat, first.lng], 15, { duration: 0.8 })
      })
      .catch(() => setSearchMsg('搜索失败'))
      .finally(() => setSearching(false))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          value={searchKw}
          onChange={(e) => setSearchKw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch() } }}
          placeholder="输入地名搜索定位（如：三江源国家公园）"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm"
        />
        <button
          type="button"
          onClick={doSearch}
          disabled={searching}
          className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold bg-cyan-600/20 text-cyan-300 border border-cyan-600/40 hover:bg-cyan-600/30 disabled:opacity-50 whitespace-nowrap"
        >
          {searching ? '搜索中...' : '🔍 搜索定位'}
        </button>
      </div>
      {searchMsg && <p className="text-amber-400 text-xs">{searchMsg}</p>}
      <div ref={containerRef} className="h-56 rounded-lg border border-slate-600 overflow-hidden" />
      <p className="text-[10px] text-slate-500">拖拽水滴或点击地图调整坐标；搜索定位后仍需微调到精确位置</p>
    </div>
  )
}

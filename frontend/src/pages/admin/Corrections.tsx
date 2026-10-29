import { useState, useCallback, useEffect, useRef } from 'react'
import L from 'leaflet'
import { adminApi } from '../../api/admin'
import type { CorrectionItem } from '../../types/admin'

interface Props {
  onAuthError: () => void
}

type StatusTab = '' | 'pending' | 'adopted' | 'rejected'

const STATUS_TABS: [StatusTab, string][] = [
  ['pending', '待审核'],
  ['adopted', '已采纳'],
  ['rejected', '已驳回'],
  ['', '全部'],
]

const AMap_URL =
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'

function fmtShape(shapeType: string | null | undefined, radiusKm: number | null | undefined) {
  if (!shapeType) return null
  if (shapeType === 'point') return '点'
  if (shapeType === 'circle') return `圆形（半径 ${radiusKm ?? '?'} km）`
  if (shapeType === 'polygon') return '多边形'
  return shapeType
}

// ===== 地图对照弹窗：蓝=当前值，橙=纠正后（按采纳写回规则合成快照与当前值） =====
function CorrectionMapModal({ item, onClose }: { item: CorrectionItem; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center: [35, 105], zoom: 4, worldCopyJump: true })
    L.tileLayer(AMap_URL, { subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '高德地图' }).addTo(map)
    mapRef.current = map

    const cur = item.poi_current
    // 合成"纠正后"形态：快照未提交的字段沿用当前值（与采纳写回逻辑一致）
    const finalLng = item.lng ?? cur?.lng
    const finalLat = item.lat ?? cur?.lat
    const finalShape = item.suggested_shape_type ?? cur?.shape_type ?? 'point'
    const finalRadius = item.suggested_radius_km ?? cur?.radius_km ?? 0
    const finalGeo = item.suggested_area_geojson ?? cur?.area_geojson ?? null

    const bounds = L.latLngBounds([])

    // 当前形态（蓝色）
    if (cur) {
      if (cur.shape_type === 'circle') {
        const c = L.circle([cur.lat, cur.lng], {
          radius: Math.max(1, cur.radius_km) * 1000,
          color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.08, weight: 1.5, dashArray: '6 4',
        }).addTo(map)
        bounds.extend(c.getBounds())
      } else if (cur.shape_type === 'polygon' && cur.area_geojson) {
        try {
          L.geoJSON(JSON.parse(cur.area_geojson), {
            style: { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.08, weight: 1.5, dashArray: '6 4' },
          }).addTo(map).eachLayer((l) => {
            const b = (l as L.Polygon).getBounds?.()
            if (b) bounds.extend(b)
          })
        } catch { /* 忽略解析失败 */ }
      } else {
        L.circleMarker([cur.lat, cur.lng], { radius: 7, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 2 }).addTo(map)
        bounds.extend([cur.lat, cur.lng])
      }
    }

    // 纠正后形态（橙色）
    const ORANGE = '#f59e0b'
    if (finalShape === 'circle' && finalLng != null && finalLat != null) {
      const c = L.circle([finalLat, finalLng], {
        radius: Math.max(0.5, finalRadius) * 1000,
        color: ORANGE, fillColor: ORANGE, fillOpacity: 0.2, weight: 2,
      }).addTo(map)
      bounds.extend(c.getBounds())
      L.circleMarker([finalLat, finalLng], { radius: 4, color: ORANGE, fillColor: ORANGE, fillOpacity: 1 }).addTo(map)
    } else if (finalShape === 'polygon' && finalGeo) {
      try {
        L.geoJSON(JSON.parse(finalGeo), {
          style: { color: ORANGE, fillColor: ORANGE, fillOpacity: 0.2, weight: 2 },
        }).addTo(map).eachLayer((l) => {
          const b = (l as L.Polygon).getBounds?.()
          if (b) bounds.extend(b)
        })
      } catch { /* 忽略解析失败 */ }
    } else if (finalLng != null && finalLat != null) {
      const icon = L.divIcon({
        className: '',
        html:
          '<svg width="40" height="40" viewBox="0 0 24 24">' +
          '<path d="M12 1.6C7.4 1.6 3.7 5.3 3.7 9.9c0 5.6 8.3 12.5 8.3 12.5s8.3-6.9 8.3-12.5c0-4.6-3.7-8.3-8.3-8.3z" fill="#f59e0b" stroke="#ffffff" stroke-width="1.5"/>' +
          '<circle cx="12" cy="9.5" r="2.8" fill="#ffffff"/></svg>',
        iconSize: [40, 40],
        iconAnchor: [20, 37],
      })
      L.marker([finalLat, finalLng], { icon }).addTo(map)
      bounds.extend([finalLat, finalLng])
    }

    setTimeout(() => {
      map.invalidateSize()
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.25))
    }, 50)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [item])

  return (
    <div className="fixed inset-0 z-[2000] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <div className="text-sm font-bold text-slate-100">
            地图对照 — {item.poi_current?.name ?? `POI #${item.poi_id}`}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 mr-1 align-middle" />当前值
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 mx-1 ml-3 align-middle" />纠正后
            </span>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
          </div>
        </div>
        <div ref={containerRef} className="w-full h-[460px]" />
        <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-700">
          蓝色虚线 = POI 当前形态范围；橙色 = 采纳后将写回的形态范围（未纠正的字段沿用当前值）
        </div>
      </div>
    </div>
  )
}

export default function Corrections({ onAuthError }: Props) {
  const [statusTab, setStatusTab] = useState<StatusTab>('pending')
  const [items, setItems] = useState<CorrectionItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rejectingId, setRejectingId] = useState<number | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [acting, setActing] = useState(false)
  const [mapItem, setMapItem] = useState<CorrectionItem | null>(null)
  const pageSize = 20

  const load = useCallback(async (p: number, st: StatusTab) => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApi.listCorrections(st, p, pageSize)
      setItems(res.items)
      setTotal(res.total)
      setPage(p)
    } catch (e: any) {
      if (e.message?.includes('未登录')) onAuthError()
      else setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [onAuthError])

  useEffect(() => { load(1, 'pending') }, [load])

  const handleTabChange = (st: StatusTab) => {
    setStatusTab(st)
    load(1, st)
  }

  const handleAdopt = useCallback(async (id: number) => {
    if (!confirm('确认采纳该纠正？采纳后对应字段将写回 POI 并立即生效。')) return
    setActing(true)
    try {
      await adminApi.adoptCorrection(id)
      load(page, statusTab)
    } catch (e: any) {
      alert(e.message || '采纳失败')
    } finally {
      setActing(false)
    }
  }, [load, page, statusTab])

  const openReject = useCallback((id: number) => {
    setRejectingId(id)
    setRejectNote('')
  }, [])

  const cancelReject = useCallback(() => {
    setRejectingId(null)
    setRejectNote('')
  }, [])

  const handleRejectSave = useCallback(async (id: number) => {
    setActing(true)
    try {
      await adminApi.rejectCorrection(id, rejectNote.trim())
      setRejectingId(null)
      setRejectNote('')
      load(page, statusTab)
    } catch (e: any) {
      alert(e.message || '驳回失败')
    } finally {
      setActing(false)
    }
  }, [rejectNote, load, page, statusTab])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // 对照渲染：建议值 vs 原值
  const renderCompare = (c: CorrectionItem) => {
    const cur = c.poi_current
    const rows: { label: string; old: string; new: string }[] = []
    if (c.name != null) rows.push({ label: '名称', old: cur?.name ?? '-', new: c.name })
    if (c.category != null) rows.push({ label: '分类', old: cur?.category ?? '-', new: c.category })
    if (c.lng != null || c.lat != null)
      rows.push({
        label: '坐标',
        old: cur ? `${cur.lng}, ${cur.lat}` : '-',
        new: `${c.lng ?? cur?.lng}, ${c.lat ?? cur?.lat}`,
      })
    if (c.description != null) rows.push({ label: '简介', old: cur?.summary ?? '-', new: c.description })
    if (c.cover_url != null) rows.push({ label: '封面图', old: cur?.cover_url ?? '-', new: c.cover_url })
    const newShape = fmtShape(c.suggested_shape_type, c.suggested_radius_km)
    if (newShape != null)
      rows.push({
        label: '形态范围',
        old: cur ? fmtShape(cur.shape_type, cur.radius_km) ?? '-' : '-',
        new: newShape,
      })
    return rows
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">纠正审核</h2>
        <div className="flex items-center gap-1">
          {STATUS_TABS.map(([st, name]) => (
            <button
              key={st || 'all'}
              onClick={() => handleTabChange(st)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                statusTab === st ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >{name}</button>
          ))}
          <button
            onClick={() => load(page, statusTab)}
            disabled={loading}
            className="ml-2 px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg transition-colors"
          >刷新</button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="space-y-3">
        {loading ? (
          <div className="text-center text-slate-500 py-10">加载中…</div>
        ) : items.length === 0 ? (
          <div className="text-center text-slate-500 py-10">暂无纠正记录</div>
        ) : (
          items.map((c) => {
            const rows = renderCompare(c)
            return (
              <div key={c.id} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-cyan-300">#{c.id}</span>
                    <span className="text-sm text-slate-300">
                      纠正 POI <span className="text-slate-100 font-medium">{c.poi_current?.name ?? `#${c.poi_id}`}</span>（ID {c.poi_id}）
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      c.status === 'adopted' ? 'bg-green-500/20 text-green-300'
                      : c.status === 'rejected' ? 'bg-red-500/20 text-red-300'
                      : 'bg-yellow-500/20 text-yellow-300'
                    }`}>
                      {c.status === 'adopted' ? '已采纳' : c.status === 'rejected' ? '已驳回' : '待审核'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {c.nickname && <span>提交者：{c.nickname}</span>}
                    <span>session: {c.session_id.slice(0, 8)}…</span>
                    <span>{c.created_at}</span>
                    <button
                      onClick={() => setMapItem(c)}
                      className="px-2.5 py-1 bg-slate-700 hover:bg-cyan-600/70 text-slate-200 rounded-lg transition-colors"
                    >🗺️ 地图对照</button>
                  </div>
                </div>

                {/* 原值 vs 纠正快照 对照 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-xs text-slate-500">
                        <th className="text-left font-normal px-3 py-1.5 w-20">字段</th>
                        <th className="text-left font-normal px-3 py-1.5">当前值</th>
                        <th className="text-left font-normal px-3 py-1.5 text-amber-300">纠正为</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.label} className="border-t border-slate-700/50">
                          <td className="px-3 py-2 text-slate-400 align-top">{r.label}</td>
                          <td className="px-3 py-2 text-slate-300 align-top break-all whitespace-pre-wrap">{r.old}</td>
                          <td className="px-3 py-2 text-amber-300 align-top break-all whitespace-pre-wrap">{r.new}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 操作 */}
                {c.status === 'pending' ? (
                  rejectingId === c.id ? (
                    <div className="mt-3">
                      <input
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        maxLength={256}
                        placeholder="驳回备注（可选，用户端可见）"
                        className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={cancelReject}
                          className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg"
                        >取消</button>
                        <button
                          onClick={() => handleRejectSave(c.id)}
                          disabled={acting}
                          className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg"
                        >{acting ? '提交中…' : '确认驳回'}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleAdopt(c.id)}
                        disabled={acting}
                        className="px-4 py-1.5 text-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                      >采纳（写回 POI）</button>
                      <button
                        onClick={() => openReject(c.id)}
                        className="px-4 py-1.5 text-xs bg-slate-700 hover:bg-red-600/80 text-slate-200 rounded-lg transition-colors"
                      >驳回</button>
                    </div>
                  )
                ) : (
                  <div className="mt-2 text-xs text-slate-500">
                    {c.status === 'adopted'
                      ? `已于 ${c.adopted_at} 采纳写回`
                      : c.reviewer_note ? `驳回备注：${c.reviewer_note}` : '已驳回'}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => load(page - 1, statusTab)}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg transition-colors"
          >上一页</button>
          <span className="text-sm text-slate-400">{page} / {totalPages}</span>
          <button
            onClick={() => load(page + 1, statusTab)}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg transition-colors"
          >下一页</button>
        </div>
      )}

      {/* 地图对照弹窗 */}
      {mapItem && <CorrectionMapModal item={mapItem} onClose={() => setMapItem(null)} />}
    </div>
  )
}

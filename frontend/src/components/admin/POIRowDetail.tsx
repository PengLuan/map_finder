import { useMemo } from 'react'
import type { AdminPOI } from '../../types/admin'

// 解析 GeoJSON 为多边形顶点数组（支持 Polygon / MultiPolygon）
type Ring = [number, number][] // [lng, lat][]

function parseGeojsonRings(geojson: string | null): Ring[] {
  if (!geojson) return []
  try {
    const geo = JSON.parse(geojson) as { type: string; coordinates: number[][][] | number[][][][] }
    const rings: Ring[] = []
    if (geo.type === 'Polygon' && Array.isArray(geo.coordinates)) {
      ;(geo.coordinates as number[][][]).forEach((ring) => {
        if (Array.isArray(ring) && ring.length > 0) {
          rings.push(ring.map((p) => [p[0], p[1]] as [number, number]))
        }
      })
    } else if (geo.type === 'MultiPolygon' && Array.isArray(geo.coordinates)) {
      ;(geo.coordinates as number[][][][]).forEach((poly) => {
        poly.forEach((ring) => {
          if (Array.isArray(ring) && ring.length > 0) {
            rings.push(ring.map((p) => [p[0], p[1]] as [number, number]))
          }
        })
      })
    }
    return rings
  } catch {
    return []
  }
}

// 将经纬度顶点归一化到 SVG viewBox（保持纵横比）
function normalizeToViewBox(rings: Ring[], width: number, height: number, padding: number) {
  if (rings.length === 0 || rings.every((r) => r.length === 0)) return [] as { x: number; y: number }[][]
  const allPts = rings.flat()
  const lngs = allPts.map((p) => p[0])
  const lats = allPts.map((p) => p[1])
  const minX = Math.min(...lngs)
  const maxX = Math.max(...lngs)
  const minY = Math.min(...lats)
  const maxY = Math.max(...lats)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const scale = Math.min((width - padding * 2) / rangeX, (height - padding * 2) / rangeY)
  const offsetX = (width - rangeX * scale) / 2
  const offsetY = (height - rangeY * scale) / 2
  return rings.map((ring) =>
    ring.map(([lng, lat]) => ({
      x: offsetX + (lng - minX) * scale,
      // 纬度方向反转（SVG y 向下）
      y: offsetY + (maxY - lat) * scale,
    }))
  )
}

export function POIRowDetail({ poi }: { poi: AdminPOI }) {
  const rings = useMemo(() => parseGeojsonRings(poi.area_geojson), [poi.area_geojson])
  const vertexCount = useMemo(() => rings.reduce((sum, r) => sum + r.length, 0), [rings])

  // 多边形 SVG 缩略图
  const svgPaths = useMemo(() => {
    const W = 220
    const H = 140
    const padding = 12
    const normalized = normalizeToViewBox(rings, W, H, padding)
    return normalized.map((pts) => {
      if (pts.length === 0) return ''
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z'
      return d
    })
  }, [rings])

  return (
    <div className="flex gap-5 items-start">
      {/* 范围缩略图 */}
      <div className="shrink-0">
        <div className="text-[11px] text-slate-500 mb-1">范围缩略图</div>
        <div className="w-[220px] h-[140px] bg-slate-900 border border-slate-700 rounded-lg overflow-hidden flex items-center justify-center">
          {poi.shape_type === 'point' && (
            <svg width="220" height="140" viewBox="0 0 220 140">
              <circle cx="110" cy="70" r="6" fill="#06b6d4" stroke="#fff" strokeWidth="2" />
            </svg>
          )}
          {poi.shape_type === 'circle' && (
            <svg width="220" height="140" viewBox="0 0 220 140">
              <circle cx="110" cy="70" r="55" fill="#06b6d4" fillOpacity="0.18" stroke="#06b6d4" strokeWidth="2" />
              <circle cx="110" cy="70" r="3" fill="#06b6d4" />
            </svg>
          )}
          {poi.shape_type === 'polygon' &&
            (svgPaths.length > 0 ? (
              <svg width="220" height="140" viewBox="0 0 220 140">
                {svgPaths.map((d, i) => (
                  <path key={i} d={d} fill="#8b5cf6" fillOpacity="0.18" stroke="#8b5cf6" strokeWidth="2" />
                ))}
              </svg>
            ) : (
              <span className="text-xs text-slate-500">无 GeoJSON</span>
            ))}
        </div>
      </div>

      {/* 详细信息 */}
      <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        <div>
          <span className="text-slate-500">形态：</span>
          <span className="text-slate-200">{poi.shape_type}</span>
        </div>
        {poi.shape_type === 'circle' && (
          <div>
            <span className="text-slate-500">半径：</span>
            <span className="text-cyan-300">{poi.radius_km} km</span>
          </div>
        )}
        {poi.shape_type === 'polygon' && (
          <div>
            <span className="text-slate-500">顶点数：</span>
            <span className="text-violet-300">{vertexCount}</span>
          </div>
        )}
        <div>
          <span className="text-slate-500">坐标：</span>
          <span className="text-slate-300 font-mono">
            {poi.lng.toFixed(6)}, {poi.lat.toFixed(6)}
          </span>
        </div>
        <div>
          <span className="text-slate-500">区域核定：</span>
          <span className={poi.area_review === 1 ? 'text-yellow-300' : 'text-green-300'}>
            {poi.area_review === 1 ? '待核定' : '已确认'}
          </span>
        </div>
        <div>
          <span className="text-slate-500">使用次数：</span>
          <span className="text-slate-300">{poi.used_count}</span>
        </div>
        <div>
          <span className="text-slate-500">来源：</span>
          <span className="text-slate-300">{poi.source ?? '-'}</span>
        </div>
        {poi.contributor_nickname && (
          <div>
            <span className="text-slate-500">贡献者：</span>
            <span className="text-amber-300">{poi.contributor_nickname}</span>
          </div>
        )}
        {poi.summary && (
          <div className="col-span-2">
            <span className="text-slate-500">简介：</span>
            <span className="text-slate-300">{poi.summary}</span>
          </div>
        )}
        {poi.shape_type === 'polygon' && poi.area_geojson && (
          <div className="col-span-2">
            <span className="text-slate-500">GeoJSON：</span>
            <span className="text-slate-400 font-mono text-[10px] break-all line-clamp-2">
              {poi.area_geojson.slice(0, 200)}
              {poi.area_geojson.length > 200 ? '…' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

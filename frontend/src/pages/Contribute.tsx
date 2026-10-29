import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet-draw/dist/leaflet.draw.css'
import '../utils/leafletDrawPatch' // 修复 leaflet-draw 1.0.4 矩形绘制崩溃（#1026），需在 leaflet-draw 之后导入
import { api, getSessionId } from '../api'
import type { SubmissionHistoryItem, CorrectionHistoryItem, PoiPublic } from '../api'
import type { Region, Theme } from '../types'

interface Props {
  onBack: () => void
  /** 纠正模式：要纠正的 POI id（从结算面板/足迹跳入） */
  correctionPoiId?: number | null
}
type ShapeType = 'point' | 'circle' | 'polygon'

// 深拷贝 latlngs 并叠加偏移（拖动水滴整体平移图形用，兼容嵌套环结构）
function offsetLatLngs(lls: unknown[], dlat: number, dlng: number): unknown[] {
  return lls.map((ll) =>
    Array.isArray(ll)
      ? offsetLatLngs(ll, dlat, dlng)
      : L.latLng((ll as L.LatLng).lat + dlat, (ll as L.LatLng).lng + dlng)
  )
}

// 计算圆上边缘点：沿 ref 相对圆心的方向（ref 缺省或与圆心重合时取正东），距离为半径
function circleEdgePoint(circle: L.Circle, ref?: L.LatLng | [number, number]): L.LatLng {
  const center = circle.getLatLng()
  const radiusM = circle.getRadius()
  const c = L.CRS.EPSG3857.project(center)
  let dx = 1
  let dy = 0
  if (ref) {
    const r = L.CRS.EPSG3857.project(L.latLng(ref))
    const vx = r.x - c.x
    const vy = r.y - c.y
    const d = Math.sqrt(vx * vx + vy * vy)
    if (d > 1e-9) {
      dx = vx / d
      dy = vy / d
    }
  }
  return L.CRS.EPSG3857.unproject(L.point(c.x + dx * radiusM, c.y + dy * radiusM))
}

const RADIUS_HANDLE_ICON = L.divIcon({
  className: '',
  html:
    '<div style="width:14px;height:14px;border-radius:50%;background:#e63946;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6);cursor:grab"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

export default function Contribute({ onBack, correctionPoiId }: Props) {
  const [themes, setThemes] = useState<Theme[]>([])
  const [provinces, setProvinces] = useState<Region[]>([])
  const [name, setName] = useState('')
  const [provinceCode, setProvinceCode] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [nickname, setNickname] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [lng, setLng] = useState(116.397)
  const [lat, setLat] = useState(39.908)
  const [shapeType, setShapeType] = useState<ShapeType>('point')
  const [radiusKm, setRadiusKm] = useState(3)
  const [areaGeojson, setAreaGeojson] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  // 纠正模式
  const [correctionPoi, setCorrectionPoi] = useState<PoiPublic | null>(null)
  // 地点搜索
  const [searchText, setSearchText] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<{ address: string; lng: number; lat: number }[]>([])
  // 我的投稿
  const [mySubs, setMySubs] = useState<SubmissionHistoryItem[] | null>(null)
  const [myCorrections, setMyCorrections] = useState<CorrectionHistoryItem[] | null>(null)
  const [showMySubs, setShowMySubs] = useState(false)
  const [loadingSubs, setLoadingSubs] = useState(false)

  const isCorrection = correctionPoiId != null && correctionPoi != null

  const loadMySubs = useCallback(async () => {
    setLoadingSubs(true)
    try {
      const res = await api.getMySubmissions()
      setMySubs(res.items)
      setMyCorrections(res.corrections ?? [])
    } catch {
      setMySubs([])
      setMyCorrections([])
    } finally {
      setLoadingSubs(false)
    }
  }, [])

  const toggleMySubs = useCallback(() => {
    const next = !showMySubs
    setShowMySubs(next)
    if (next) loadMySubs()
  }, [showMySubs, loadMySubs])

  // 纠正模式：加载 POI 并预填表单
  useEffect(() => {
    if (!correctionPoiId) return
    api.getPoiPublic(correctionPoiId).then((poi) => {
      setCorrectionPoi(poi)
      setName(poi.name)
      setCategory(poi.category ?? '')
      setDescription(poi.summary ?? '')
      setCoverUrl(poi.cover_url ?? '')
      setLng(poi.lng)
      setLat(poi.lat)
      setShapeType(poi.shape_type as ShapeType)
      if (poi.shape_type === 'circle' && poi.radius_km > 0) setRadiusKm(poi.radius_km)
      if (poi.shape_type === 'polygon' && poi.area_geojson) setAreaGeojson(poi.area_geojson)
    }).catch(() => {
      setMsg({ type: 'err', text: '加载地点信息失败，请返回重试' })
    })
  }, [correctionPoiId])

  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)
  const radiusHandleRef = useRef<L.Marker | null>(null)
  const handleDraggingRef = useRef(false)
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)
  const drawControlRef = useRef<L.Control.Draw | null>(null)
  const drawingRef = useRef(false) // leaflet-draw 绘制中（期间点击地图不应移动标记）
  const shapeLayerRef = useRef<L.Polygon | null>(null) // 当前面图形（水滴拖动/点击移动时图形跟随）
  const shapeTypeRef = useRef<ShapeType>('point')
  shapeTypeRef.current = shapeType

  useEffect(() => {
    api.getThemes().then(setThemes).catch(() => {})
    api.getRegions(1).then(setProvinces).catch(() => {})
  }, [])

  // 初始化地图
  useEffect(() => {
    if (mapRef.current) return
    const map = L.map('contribute-map', { center: [lat, lng], zoom: 5, worldCopyJump: true })
    L.tileLayer(
      `https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}`,
      { subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '高德地图' }
    ).addTo(map)
    mapRef.current = map

    const fg = L.featureGroup().addTo(map)
    featureGroupRef.current = fg

    const icon = L.divIcon({
      className: '',
      html:
        '<svg width="40" height="40" viewBox="0 0 24 24">' +
        '<path d="M12 1.6C7.4 1.6 3.7 5.3 3.7 9.9c0 5.6 8.3 12.5 8.3 12.5s8.3-6.9 8.3-12.5c0-4.6-3.7-8.3-8.3-8.3z" fill="#e63946" stroke="#ffffff" stroke-width="1.5"/>' +
        '<circle cx="12" cy="9.5" r="2.8" fill="#ffffff"/></svg>',
      iconSize: [40, 40],
      iconAnchor: [20, 37],
    })
    const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map)
    markerRef.current = marker
    // 图形跟随水滴：水滴拖动/点击移动后，矩形整体平移到以水滴为中心
    // （暂只支持矩形跟随；多边形跟随交互较繁琐，暂不启用）
    const moveShapeWithMarker = (target: L.LatLng) => {
      const layer = shapeLayerRef.current
      if (!layer || !(layer instanceof L.Rectangle)) return
      const center = layer.getBounds().getCenter()
      const dlat = target.lat - center.lat
      const dlng = target.lng - center.lng
      if (!dlat && !dlng) return
      // Rectangle.getBounds 读缓存 _bounds，须用 setBounds 同步更新
      layer.setBounds(L.latLngBounds(offsetLatLngs(layer.getLatLngs(), dlat, dlng)[0] as L.LatLngExpression[]))
      ;(layer as unknown as { editing?: { updateMarkers?: () => void } }).editing?.updateMarkers?.()
    }
    marker.on('drag', () => moveShapeWithMarker(marker.getLatLng()))
    marker.on('dragend', () => {
      const p = marker.getLatLng()
      setLng(+p.lng.toFixed(6))
      setLat(+p.lat.toFixed(6))
      if (circleRef.current) {
        circleRef.current.setLatLng(p)
        if (radiusHandleRef.current) {
          radiusHandleRef.current.setLatLng(circleEdgePoint(circleRef.current, radiusHandleRef.current.getLatLng()))
        }
      }
      // 平移图形后刷新 GeoJSON
      const layer = shapeLayerRef.current
      if (layer) setAreaGeojson(JSON.stringify(layer.toGeoJSON()))
    })
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (drawingRef.current) return // 绘制多边形/矩形期间，点击是加顶点，不移动标记
      marker.setLatLng(e.latlng)
      setLng(+e.latlng.lng.toFixed(6))
      setLat(+e.latlng.lat.toFixed(6))
      if (circleRef.current) {
        circleRef.current.setLatLng(e.latlng)
        if (radiusHandleRef.current) {
          radiusHandleRef.current.setLatLng(circleEdgePoint(circleRef.current, radiusHandleRef.current.getLatLng()))
        }
      }
      moveShapeWithMarker(e.latlng) // 图形跟随水滴移动
    })

    // leaflet-draw（仅在"多边形范围"形态下显示，见下方 shapeType effect）
    const DrawControl = (L as any).Control.Draw
    const drawControl = new DrawControl({
      edit: { featureGroup: fg, remove: true },
      draw: {
        polygon: { allowIntersection: false, showArea: true },
        rectangle: true,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
    })
    drawControlRef.current = drawControl
    // 绘制开始/结束：期间禁用标记点击移动，避免干扰加顶点/完成绘制
    map.on('draw:drawstart draw:editstart', () => { drawingRef.current = true })
    map.on('draw:drawstop draw:created draw:editstop draw:deleted', () => { drawingRef.current = false })
    // 图层被移除时（clearLayers/切换形态）关闭其编辑状态，避免残留孤儿手柄
    fg.on('layerremove', (e: any) => {
      if (e.layer?.editing?.enabled?.()) e.layer.editing.disable()
      if (shapeLayerRef.current === e.layer) shapeLayerRef.current = null
    })
    map.on('draw:created', (e: any) => {
      const layer = e.layer
      fg.clearLayers()
      fg.addLayer(layer)
      shapeLayerRef.current = layer
      const edit = layer.editing
      if (edit?.enable) {
        // 中心小白块由水滴标记承担（拖水滴即移动图形），不再生成默认手柄
        edit._createMoveMarker = function () { this._moveMarker = marker }
        edit.enable()
      }
      // 水滴标记自动放到图形中心，并同步经纬度
      const center = (layer as L.Polygon).getBounds().getCenter()
      marker.setLatLng(center)
      setLng(+center.lng.toFixed(6))
      setLat(+center.lat.toFixed(6))
      const geojson = JSON.stringify(layer.toGeoJSON())
      setAreaGeojson(geojson)
      setShapeType('polygon')
    })
    // 缩放/顶点编辑时，水滴与 GeoJSON 实时跟随图形
    map.on('draw:editmove draw:editresize draw:editvertex', (e: any) => {
      const layer = e.layer ?? e.poly
      if (!layer?.getBounds) return
      const c = (layer as L.Polygon).getBounds().getCenter()
      setLng(+c.lng.toFixed(6))
      setLat(+c.lat.toFixed(6))
      setAreaGeojson(JSON.stringify(layer.toGeoJSON()))
    })
    map.on('draw:edited', () => {
      const layers: any[] = []
      fg.eachLayer((l: any) => layers.push(l))
      if (layers.length) {
        setAreaGeojson(JSON.stringify(layers[0].toGeoJSON()))
        // 编辑后图形变化，水滴标记跟随图形中心
        const center = (layers[0] as L.Polygon).getBounds().getCenter()
        marker.setLatLng(center)
        setLng(+center.lng.toFixed(6))
        setLat(+center.lat.toFixed(6))
      } else {
        setAreaGeojson(null)
      }
    })
    map.on('draw:deleted', () => {
      setAreaGeojson(null)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 形态切换时刷新图形
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (circleRef.current) {
      map.removeLayer(circleRef.current)
      circleRef.current = null
    }
    if (radiusHandleRef.current) {
      map.removeLayer(radiusHandleRef.current)
      radiusHandleRef.current = null
    }
    if (shapeType === 'circle') {
      const circle = L.circle([lat, lng], {
        radius: radiusKm * 1000,
        color: '#e63946',
        fillColor: '#e63946',
        fillOpacity: 0.15,
      }).addTo(map)
      circleRef.current = circle
      // 半径手柄：拖动缩放圆
      const handle = L.marker(circleEdgePoint(circle, [lat, lng]), {
        icon: RADIUS_HANDLE_ICON,
        draggable: true,
      }).addTo(map)
      handle.on('dragstart', () => {
        handleDraggingRef.current = true
      })
      handle.on('drag', () => {
        const dist = map.distance(circle.getLatLng(), handle.getLatLng())
        circle.setRadius(Math.max(0.5, dist))
        setRadiusKm(Number((dist / 1000).toFixed(2)))
      })
      handle.on('dragend', () => {
        handleDraggingRef.current = false
        const dist = map.distance(circle.getLatLng(), handle.getLatLng())
        setRadiusKm(Number((dist / 1000).toFixed(2)))
      })
      radiusHandleRef.current = handle
      // 按住圆形本体任意位置拖动整个圆
      const circleEl = circle.getElement() as HTMLElement | undefined
      if (circleEl) {
        circleEl.style.cursor = 'move'
        circleEl.addEventListener('mousedown', (ev: MouseEvent) => {
          if (ev.button !== 0) return
          ev.stopPropagation()
          ev.preventDefault()
          const container = mapRef.current?.getContainer()
          if (!container) return
          const rect = container.getBoundingClientRect()
          const startPt = L.point(ev.clientX - rect.left, ev.clientY - rect.top)
          const startCenterPt = map.latLngToContainerPoint(circle.getLatLng())
          let moved = false
          const onMove = (me: MouseEvent) => {
            const curPt = L.point(me.clientX - rect.left, me.clientY - rect.top)
            const dp = curPt.subtract(startPt)
            if (!dp.x && !dp.y) return
            moved = true
            const newCenter = map.containerPointToLatLng(startCenterPt.add(dp))
            circle.setLatLng(newCenter)
            if (markerRef.current) markerRef.current.setLatLng(newCenter)
            const handle2 = radiusHandleRef.current
            if (handle2) handle2.setLatLng(circleEdgePoint(circle, handle2.getLatLng()))
          }
          const onUp = () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            if (moved) {
              const ll = circle.getLatLng()
              setLng(+ll.lng.toFixed(6))
              setLat(+ll.lat.toFixed(6))
            }
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        })
      }
    }
    if (shapeType !== 'polygon' && featureGroupRef.current) {
      featureGroupRef.current.clearLayers()
      setAreaGeojson(null)
    }
    // 绘制工具栏仅在"多边形范围"形态下显示
    const ctrl = drawControlRef.current
    if (ctrl) {
      const hasCtrl = (map as unknown as { hasControl?: (c: unknown) => boolean }).hasControl?.call(map, ctrl) ?? false
      if (shapeType === 'polygon' && !hasCtrl) {
        map.addControl(ctrl)
      } else if (shapeType !== 'polygon' && hasCtrl) {
        map.removeControl(ctrl)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeType])

  // 半径变化更新圆（手柄沿当前方向跟随，拖拽中不回弹）
  useEffect(() => {
    const circle = circleRef.current
    if (!circle) return
    circle.setRadius(radiusKm * 1000)
    const handle = radiusHandleRef.current
    if (handle && !handleDraggingRef.current) {
      handle.setLatLng(circleEdgePoint(circle, handle.getLatLng()))
    }
  }, [radiusKm])

  // 纠正模式：POI 加载后回显地图（水滴定位到当前坐标 + 已有范围渲染，仿后台 POIEditor）
  useEffect(() => {
    const poi = correctionPoi
    const map = mapRef.current
    if (!poi || !map) return
    markerRef.current?.setLatLng([poi.lat, poi.lng])
    if (poi.shape_type === 'polygon' && poi.area_geojson) {
      const fg = featureGroupRef.current
      if (fg) {
        try {
          fg.clearLayers()
          L.geoJSON(JSON.parse(poi.area_geojson)).eachLayer((l) => {
            fg.addLayer(l)
            const edit = (l as unknown as { editing?: { enable?: () => void; _createMoveMarker?: () => void } }).editing
            if (edit?.enable) {
              // 中心小白块由水滴标记承担（拖水滴即移动图形），与绘制完成行为一致
              edit._createMoveMarker = function (this: { _moveMarker?: L.Marker | null }) { this._moveMarker = markerRef.current }
              edit.enable()
            }
          })
          shapeLayerRef.current = (fg.getLayers()[0] as L.Polygon) ?? null
          if (fg.getLayers().length) {
            map.fitBounds(fg.getBounds(), { padding: [40, 40] })
            return
          }
        } catch { /* geojson 解析失败则退回普通定位 */ }
      }
    }
    map.setView([poi.lat, poi.lng], 13)
  }, [correctionPoi])

  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadPct(0)
    try {
      const res = await api.uploadCover(file, (pct) => setUploadPct(pct))
      setCoverUrl(res.url)
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message || '上传失败' })
    } finally {
      setUploading(false)
      setUploadPct(0)
    }
  }

  // 地点搜索：调用后端地理编码代理
  const handleGeocodeSearch = async () => {
    const kw = searchText.trim()
    if (!kw) return
    setSearching(true)
    try {
      const res = await fetch(`/api/geocode?keyword=${encodeURIComponent(kw)}`)
      const data = await res.json()
      setSearchResults(data.items ?? [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  // 选择搜索结果：地图定位到该地点
  const handleSelectPlace = (r: { address: string; lng: number; lat: number }) => {
    setLng(r.lng)
    setLat(r.lat)
    if (mapRef.current) {
      mapRef.current.setView([r.lat, r.lng], 13)
    }
    setSearchResults([])
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setMsg({ type: 'err', text: '请填写地点名称' })
      return
    }
    if (!isCorrection && !coverUrl.trim()) {
      setMsg({ type: 'err', text: '请上传封面图' })
      return
    }
    if (!(73 <= lng && lng <= 135 && 18 <= lat && lat <= 54)) {
      setMsg({ type: 'err', text: '坐标需在中国境内' })
      return
    }
    setSubmitting(true)
    setMsg(null)
    try {
      if (correctionPoiId != null && correctionPoi) {
        // 纠正提交：仅提交与当前值不同的字段（快照存档，采纳后写回）
        await api.submitCorrection({
          poi_id: correctionPoiId,
          session_id: getSessionId(),
          nickname: nickname || undefined,
          name: name.trim() !== correctionPoi.name ? name.trim() : undefined,
          category: category !== (correctionPoi.category ?? '') ? category || undefined : undefined,
          lng: lng !== correctionPoi.lng ? lng : undefined,
          lat: lat !== correctionPoi.lat ? lat : undefined,
          description: description !== (correctionPoi.summary ?? '') ? description || undefined : undefined,
          cover_url: coverUrl !== (correctionPoi.cover_url ?? '') ? coverUrl || undefined : undefined,
          suggested_shape_type: shapeType !== correctionPoi.shape_type ? shapeType : undefined,
          suggested_radius_km: shapeType === 'circle' && radiusKm !== correctionPoi.radius_km ? radiusKm : undefined,
          suggested_area_geojson: shapeType === 'polygon' && areaGeojson !== (correctionPoi.area_geojson ?? null) ? areaGeojson || undefined : undefined,
        })
        setMsg({ type: 'ok', text: '感谢纠正！审核采纳后生效，可在下方「我的投稿」中查看进度。' })
        if (showMySubs) loadMySubs()
        return
      }
      await api.contribute({
        session_id: getSessionId(),
        nickname: nickname || undefined,
        name: name.trim(),
        province_code: provinceCode || undefined,
        category: category || undefined,
        lng,
        lat,
        description: description || undefined,
        cover_url: coverUrl || undefined,
        suggested_shape_type: shapeType,
        suggested_radius_km: shapeType === 'circle' ? radiusKm : 0,
        suggested_area_geojson: shapeType === 'polygon' ? areaGeojson || undefined : undefined,
      })
      setMsg({ type: 'ok', text: '感谢贡献！审核通过后将出现在题库中。' })
      setName(''); setDescription(''); setCoverUrl(''); setAreaGeojson(null)
      if (featureGroupRef.current) featureGroupRef.current.clearLayers()
      if (showMySubs) loadMySubs() // 刷新我的投稿列表
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message || '提交失败' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full w-full overflow-auto bg-slate-900 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">贡献地点</h1>
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm"
          >
            {isCorrection ? '取消纠正' : '返回首页'}
          </button>
        </div>

        {correctionPoiId != null && (
          <div className="mb-6 bg-amber-500/10 border border-amber-500/40 rounded-lg px-4 py-3">
            {correctionPoi ? (
              <>
                <div className="text-sm font-bold text-amber-300 mb-0.5">✎ 纠正此地点：{correctionPoi.name}</div>
                <div className="text-xs text-amber-200/70">表单已预填当前信息，直接修改需要纠正的项后提交；纠正不会立即生效，审核采纳后才写回。</div>
              </>
            ) : (
              <div className="text-sm text-amber-200/70">正在加载地点信息…</div>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* 左侧表单 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">地点名称 *</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：石臼湖"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-slate-400 mb-1">所在省份</label>
                <select
                  className="input"
                  value={provinceCode}
                  onChange={(e) => setProvinceCode(e.target.value)}
                >
                  <option value="">不限</option>
                  {provinces.map((p) => (
                    <option key={p.code} value={p.code}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">建议主题</label>
                <select
                  className="input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">不限</option>
                  {themes.map((t) => (
                    <option key={t.code} value={t.code}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">简单描述</label>
              <textarea
                className="input min-h-[80px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="一句话介绍这个地点"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">封面图 *</label>
              <div className="flex gap-2">
                {coverUrl ? (
                  <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-slate-700">
                    <img src={coverUrl} alt="封面" className="w-full h-full object-cover" />
                    <button
                      onClick={() => setCoverUrl('')}
                      className="absolute top-0 right-0 bg-red-500/80 text-white text-xs w-5 h-5 flex items-center justify-center rounded-bl-lg hover:bg-red-400"
                    >×</button>
                  </div>
                ) : (
                  <label className={`w-24 h-24 flex items-center justify-center rounded-lg border border-dashed border-slate-600 cursor-pointer hover:border-cyan-500 transition-colors ${uploading ? 'opacity-50' : ''}`}>
                    {uploading ? (
                      <span className="text-xs text-cyan-400 font-medium">{uploadPct}%</span>
                    ) : (
                      <span className="text-2xl text-slate-500">+</span>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                    />
                  </label>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">目标形态</label>
              <div className="flex gap-2">
                {(['point', 'circle', 'polygon'] as ShapeType[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setShapeType(s)}
                    className={`px-3 py-1.5 rounded-lg text-sm ${
                      shapeType === s ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {s === 'point' ? '点' : s === 'circle' ? '圆形范围' : '多边形范围'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {shapeType === 'circle' && '适合湖泊/景区，下方可设半径'}
                {shapeType === 'polygon' && '适合河流/保护区，在右侧地图用绘制工具勾画边界'}
              </p>
            </div>
            {shapeType === 'circle' && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">半径 (km)</label>
                <input
                  type="number"
                  min={0.5}
                  max={50}
                  step={0.5}
                  className="input"
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(parseFloat(e.target.value) || 1)}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-slate-400 mb-1">经度</label>
                <input
                  className="input"
                  type="number"
                  step={0.000001}
                  value={lng}
                  onChange={(e) => setLng(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">纬度</label>
                <input
                  className="input"
                  type="number"
                  step={0.000001}
                  value={lat}
                  onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            {isCorrection && correctionPoi && (
              <p className="text-xs text-slate-500 -mt-2">
                当前坐标：{correctionPoi.lng.toFixed(6)}，{correctionPoi.lat.toFixed(6)}（修改后提交，审核采纳才写回）
              </p>
            )}
            <div>
              <label className="block text-sm text-slate-400 mb-1">你的昵称（可选，审核通过后展示）</label>
              <input
                className="input"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="匿名也可"
              />
            </div>

            {msg && (
              <div
                className={`px-3 py-2 rounded-lg text-sm ${
                  msg.type === 'ok' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                }`}
              >
                {msg.text}
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 font-medium"
            >
              {submitting ? '提交中…' : isCorrection ? '提交纠正' : '提交贡献'}
            </button>
          </div>

          {/* 右侧地图 */}
          <div className="space-y-2">
            <p className="text-sm text-slate-400">
              点击地图放置标记，可拖拽微调。选择"多边形范围"后用右上角绘制工具勾画边界（矩形需按住左键拖拽绘制）。
              绘制完成后中心圆点可拖动移动，四角/顶点可拖动缩放。
            </p>
            {/* 地点搜索 */}
            <div className="relative">
              <div className="flex gap-2">
                <input type="text" value={searchText}
                  onChange={(e) => { setSearchText(e.target.value); setSearchResults([]) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleGeocodeSearch() }}
                  placeholder="搜索地点…"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500" />
                <button onClick={handleGeocodeSearch} disabled={searching}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
                  {searching ? '搜索中…' : '搜索'}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="absolute z-[1100] top-full left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-slate-800 border border-slate-600 rounded-lg shadow-lg">
                  {searchResults.map((r, idx) => (
                    <button key={idx} onClick={() => handleSelectPlace(r)}
                      className="block w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 border-b border-slate-700/60 last:border-0">
                      {r.address || `${r.lng.toFixed(5)}, ${r.lat.toFixed(5)}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div id="contribute-map" className="w-full h-[480px] rounded-lg overflow-hidden border border-slate-700" />
          </div>
        </div>

        {/* 我的投稿（含纠正记录） */}
        <div className="mt-8 border-t border-slate-700 pt-4">
          <button
            onClick={toggleMySubs}
            className="w-full flex items-center justify-between text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <span className="font-medium">
              📋 我的投稿{mySubs || myCorrections ? `（${(mySubs?.length ?? 0) + (myCorrections?.length ?? 0)}）` : ''}
            </span>
            <span>{showMySubs ? '收起 ▲' : '展开 ▼'}</span>
          </button>
          {showMySubs && (
            <div className="mt-3 space-y-2">
              {loadingSubs ? (
                <div className="text-center text-sm text-slate-500 py-6">加载中…</div>
              ) : !mySubs || (mySubs.length === 0 && (myCorrections?.length ?? 0) === 0) ? (
                <div className="text-center text-sm text-slate-500 py-6">暂无投稿记录</div>
              ) : (
                <>
                  {mySubs.map((s) => (
                    <div key={`sub-${s.id}`} className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">投稿</span>
                          <span className="text-sm font-medium text-slate-100">{s.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            s.status === 'approved' ? 'bg-green-500/20 text-green-300'
                            : s.status === 'rejected' ? 'bg-red-500/20 text-red-300'
                            : 'bg-yellow-500/20 text-yellow-300'
                          }`}>
                            {s.status === 'approved' ? '已通过' : s.status === 'rejected' ? '未通过' : '待审核'}
                          </span>
                        </div>
                        {s.status === 'rejected' && s.reviewer_note && (
                          <div className="text-xs text-red-300/80 mt-0.5">审核备注：{s.reviewer_note}</div>
                        )}
                        <div className="text-xs text-slate-500 mt-0.5">{s.submitted_at}</div>
                      </div>
                    </div>
                  ))}
                  {(myCorrections ?? []).map((c) => (
                    <div key={`cor-${c.id}`} className={`rounded-lg p-3 flex items-start justify-between gap-3 border ${
                      c.status === 'adopted' ? 'bg-green-500/10 border-green-500/50' : 'bg-slate-800/60 border-slate-700/60'
                    }`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">纠正</span>
                          <span className="text-sm font-medium text-slate-100">
                            {c.name || `地点 #${c.poi_id}`}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                            c.status === 'adopted' ? 'bg-green-400/30 text-green-200 ring-1 ring-green-400/60'
                            : c.status === 'rejected' ? 'bg-red-500/20 text-red-300'
                            : 'bg-yellow-500/20 text-yellow-300'
                          }`}>
                            {c.status === 'adopted' ? '✓ 已采纳生效' : c.status === 'rejected' ? '未通过' : '待审核'}
                          </span>
                        </div>
                        {c.status === 'rejected' && c.reviewer_note && (
                          <div className="text-xs text-red-300/80 mt-0.5">审核备注：{c.reviewer_note}</div>
                        )}
                        <div className="text-xs text-slate-500 mt-0.5">{c.created_at}</div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

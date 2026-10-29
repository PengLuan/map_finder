import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet-draw/dist/leaflet.draw.css'
import '../../utils/leafletDrawPatch' // 修复 leaflet-draw 1.0.4 矩形绘制崩溃（#1026），需在 leaflet-draw 之后导入
import { api } from '../../api'
import type { AdminPOI, AdminPOIInput, AdminTheme } from '../../types/admin'

interface Props {
  poi: AdminPOI | null
  themes: AdminTheme[]
  onSave: (data: AdminPOIInput) => void
  onCancel: () => void
}

type ShapeType = 'point' | 'circle' | 'polygon'

const AMAP_TILE_URL =
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'
const AMAP_SUBDOMAINS = ['1', '2', '3', '4']
const DEFAULT_CENTER: [number, number] = [39.9087, 116.3975] // [lat, lng] 北京天安门

const MARKER_ICON = L.divIcon({
  className: '',
  html:
    '<svg width="36" height="36" viewBox="0 0 24 24" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,0.5))">' +
    '<path d="M12 1.6C7.4 1.6 3.7 5.3 3.7 9.9c0 5.6 8.3 12.5 8.3 12.5s8.3-6.9 8.3-12.5c0-4.6-3.7-8.3-8.3-8.3z" fill="#06b6d4" stroke="#ffffff" stroke-width="1.5"/>' +
    '<circle cx="12" cy="9.5" r="2.8" fill="#ffffff"/>' +
    '</svg>',
  iconSize: [36, 36],
  iconAnchor: [18, 34],
})

const RADIUS_HANDLE_ICON = L.divIcon({
  className: '',
  html:
    '<div style="width:14px;height:14px;border-radius:50%;background:#06b6d4;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6);cursor:grab"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

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

// 深拷贝 latlngs 并叠加偏移（拖动水滴整体平移图形用，兼容嵌套环结构）
function offsetLatLngs(lls: unknown[], dlat: number, dlng: number): unknown[] {
  return lls.map((ll) =>
    Array.isArray(ll)
      ? offsetLatLngs(ll, dlat, dlng)
      : L.latLng((ll as L.LatLng).lat + dlat, (ll as L.LatLng).lng + dlng)
  )
}

// 设置 leaflet-draw 中文文案
// 注意：必须合并进原有嵌套结构（handlers.X.tooltip.start），
// 不能整体替换 handlers.polygon / handlers.rectangle，否则构造绘制 handler 时读不到 tooltip.start 会崩溃
function setupDrawLocale() {
  const drawLocal = (L as unknown as {
    drawLocal?: {
      draw?: {
        handlers?: Record<string, { tooltip?: Record<string, string> } | undefined>
        toolbar?: { buttons?: Record<string, string> }
      }
    }
  }).drawLocal
  const handlers = drawLocal?.draw?.handlers
  if (!handlers) return
  try {
    if (handlers.polygon?.tooltip) {
      Object.assign(handlers.polygon.tooltip, {
        start: '点击开始绘制多边形',
        cont: '点击继续绘制（双击结束）',
        end: '点击第一个点闭合多边形',
      })
    }
    if (handlers.rectangle?.tooltip) {
      Object.assign(handlers.rectangle.tooltip, { start: '点击并拖拽绘制矩形' })
    }
    const buttons = drawLocal?.draw?.toolbar?.buttons
    if (buttons) {
      Object.assign(buttons, { polygon: '绘制多边形', rectangle: '绘制矩形' })
    }
  } catch {
    // 忽略文案设置失败
  }
}

export default function POIEditor({ poi, themes, onSave, onCancel }: Props) {
  // 表单字段
  const [name, setName] = useState(poi?.name ?? '')
  const [category, setCategory] = useState(poi?.category ?? '')
  const [adcode, setAdcode] = useState(poi?.adcode ?? '')
  const [difficulty, setDifficulty] = useState<number>(poi?.difficulty ?? 3)
  const [coverUrl, setCoverUrl] = useState(poi?.cover_url ?? '')
  const [summary, setSummary] = useState(poi?.summary ?? '')
  const [hintText, setHintText] = useState(poi?.hint_text ?? '')
  const [contributorNickname, setContributorNickname] = useState(poi?.contributor_nickname ?? '')
  const [shapeType, setShapeType] = useState<ShapeType>(poi?.shape_type ?? 'point')
  const [radiusKm, setRadiusKm] = useState<number>(poi?.radius_km ?? 0.5)
  const [lng, setLng] = useState<number>(poi?.lng ?? DEFAULT_CENTER[1])
  const [lat, setLat] = useState<number>(poi?.lat ?? DEFAULT_CENTER[0])

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  // 封面 hover 放大预览
  const [hoverPreview, setHoverPreview] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // GeoJSON 导入/导出文本
  const [geojsonText, setGeojsonText] = useState(poi?.area_geojson ?? '')
  const [geojsonError, setGeojsonError] = useState('')
  // 地点搜索
  const [searchText, setSearchText] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<{ address: string; lng: number; lat: number }[]>([])

  // 地图相关 refs
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)
  const radiusHandleRef = useRef<L.Marker | null>(null)
  const handleDraggingRef = useRef(false)
  const drawControlRef = useRef<L.Control.Draw | null>(null)
  const shapeLayerRef = useRef<L.Polygon | null>(null) // 当前面图形（水滴拖动/经纬度变化时图形跟随）
  const moveShapeWithMarkerRef = useRef<((target: L.LatLng) => void) | null>(null)
  // 标记是否已加载过已有 geojson（避免重复）
  const geojsonLoadedRef = useRef(false)

  // 初始化地图（仅一次）
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    setupDrawLocale()

    const map = L.map(mapContainerRef.current, {
      center: [lat, lng],
      zoom: 13,
      scrollWheelZoom: true,
    })
    mapRef.current = map

    L.tileLayer(AMAP_TILE_URL, {
      subdomains: AMAP_SUBDOMAINS,
      maxZoom: 18,
    }).addTo(map)

    // 可绘制图层组
    const fg = L.featureGroup().addTo(map)
    featureGroupRef.current = fg

    // 可拖拽中心点标记
    const marker = L.marker([lat, lng], {
      icon: MARKER_ICON,
      draggable: true,
    }).addTo(map)
    // 图形跟随水滴：水滴拖动/经纬度变化后，矩形整体平移到以水滴为中心
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
      const ll = marker.getLatLng()
      setLng(ll.lng)
      setLat(ll.lat)
    })
    markerRef.current = marker
    // 供 lng/lat 变化的 effect 使用（经纬度输入框改动时图形跟随）
    moveShapeWithMarkerRef.current = moveShapeWithMarker

    // 绘制工具
    const DrawControl = (L as unknown as { Control: { Draw: new (opts: unknown) => L.Control.Draw } }).Control.Draw
    const drawControl = new DrawControl({
      edit: { featureGroup: fg, remove: true },
      draw: {
        polygon: true,
        rectangle: true,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
    })
    drawControlRef.current = drawControl

    // 图层被移除时（clearLayers/重新绘制）关闭其编辑状态，避免残留孤儿手柄
    fg.on('layerremove', (e) => {
      const layer = (e as unknown as { layer?: { editing?: { enabled?: () => boolean; disable?: () => void } } }).layer
      if (layer?.editing?.enabled?.()) layer.editing.disable?.()
      if (shapeLayerRef.current === layer) shapeLayerRef.current = null
    })

    // 监听绘制完成
    map.on('draw:created', (e: L.LeafletEvent) => {
      const ev = e as L.DrawEvents.Created
      fg.clearLayers()
      fg.addLayer(ev.layer)
      const layer = ev.layer as unknown as L.Polygon
      shapeLayerRef.current = layer
      // 绘制完成后立即开启编辑手柄（角点/顶点拖动可缩放），无需再点工具栏铅笔按钮
      const edit = (layer as unknown as { editing?: { enable?: () => void; _createMoveMarker?: (this: { _moveMarker?: L.Marker | null }) => void } }).editing
      if (edit?.enable) {
        // 中心小白块由水滴标记承担（拖水滴即移动图形），不再生成默认手柄
        edit._createMoveMarker = function (this: { _moveMarker?: L.Marker | null }) { this._moveMarker = marker }
        edit.enable()
      }
      // 水滴标记自动放到图形中心（state 变化经 effect 同步标记与坐标）
      const center = layer.getBounds().getCenter()
      setLng(center.lng)
      setLat(center.lat)
    })

    // 缩放/顶点编辑时，水滴标记实时跟随图形中心
    map.on('draw:editmove draw:editresize draw:editvertex', (e) => {
      const ev = e as unknown as { layer?: L.Polygon; poly?: L.Polygon }
      const layer = ev.layer ?? ev.poly
      if (!layer?.getBounds) return
      const center = layer.getBounds().getCenter()
      setLng(center.lng)
      setLat(center.lat)
    })

    // 防止地图初始化后尺寸异常；延迟加载 geojson 到 invalidateSize 之后，避免容器尺寸为 0 致 fitBounds 失效（多边形回显 bug 根因 1）
    setTimeout(() => {
      if (!mapRef.current) return
      mapRef.current.invalidateSize()
      if (poi?.area_geojson && !geojsonLoadedRef.current) {
        try {
          const geo = JSON.parse(poi.area_geojson)
          const geoLayer = L.geoJSON(geo)
          geoLayer.eachLayer((l) => {
            featureGroupRef.current?.addLayer(l)
            // 回显图层同样开启编辑（顶点拖动调整形状）
            const anyLayer = l as unknown as { editing?: { enable?: () => void } }
            if (anyLayer.editing?.enable) anyLayer.editing.enable()
          })
          shapeLayerRef.current = (featureGroupRef.current?.getLayers()[0] as L.Polygon) ?? null
          geojsonLoadedRef.current = true
          // 视图自适应到已有图形（容器尺寸已就绪，fitBounds 可正确计算）
          if (featureGroupRef.current?.getLayers().length) {
            mapRef.current.fitBounds(featureGroupRef.current.getBounds(), { padding: [40, 40] })
          }
        } catch (e) {
          // 暴露解析错误（根因 4），便于排查 Polygon 闭合/坐标顺序问题
          console.warn('[POIEditor] geojson parse failed', e)
        }
      }
    }, 100)

    return () => {
      map.remove()
      mapRef.current = null
      featureGroupRef.current = null
      markerRef.current = null
      circleRef.current = null
      radiusHandleRef.current = null
      drawControlRef.current = null
      moveShapeWithMarkerRef.current = null
      // 重置加载标记：组件卸载/POI 切换后允许重新加载（根因 2）
      geojsonLoadedRef.current = false
    }
    // 依赖 poi?.id：POI 切换时重新执行加载（根因 3）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poi?.id])

  // shape_type 变化：切换显示
  useEffect(() => {
    const map = mapRef.current
    const fg = featureGroupRef.current
    if (!map || !fg) return

    if (shapeType === 'point') {
      // 清除圆和多边形
      if (circleRef.current) {
        circleRef.current.remove()
        circleRef.current = null
      }
      if (radiusHandleRef.current) {
        radiusHandleRef.current.remove()
        radiusHandleRef.current = null
      }
      fg.clearLayers()
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current)
      }
    } else if (shapeType === 'circle') {
      // 清除多边形
      fg.clearLayers()
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current)
      }
      // 创建/更新圆 + 半径手柄，并让视图完整显示整圆
      if (!circleRef.current) {
        const circle = L.circle([lat, lng], {
          radius: Math.max(1, radiusKm) * 1000,
          color: '#06b6d4',
          fillColor: '#06b6d4',
          fillOpacity: 0.15,
        }).addTo(map)
        circleRef.current = circle
        const handle = L.marker(circleEdgePoint(circle, [lat, lng]), {
          icon: RADIUS_HANDLE_ICON,
          draggable: true,
        }).addTo(map)
        handle.on('dragstart', () => {
          handleDraggingRef.current = true
        })
        handle.on('drag', () => {
          const dist = map.distance(circle.getLatLng(), handle.getLatLng())
          circle.setRadius(Math.max(1, dist))
          setRadiusKm(Number((dist / 1000).toFixed(2)))
        })
        handle.on('dragend', () => {
          handleDraggingRef.current = false
          const dist = map.distance(circle.getLatLng(), handle.getLatLng())
          setRadiusKm(Number((dist / 1000).toFixed(2)))
        })
        radiusHandleRef.current = handle
        // 支持按住圆形本体任意位置拖动整个圆
        // 用原生监听并阻止冒泡，避免同时触发地图平移
        const circleEl = circle.getElement() as HTMLElement | undefined
        if (circleEl) {
          circleEl.style.cursor = 'move'
          circleEl.addEventListener('mousedown', (ev: MouseEvent) => {
            if (ev.button !== 0) return
            ev.stopPropagation()
            ev.preventDefault()
            const rect = mapContainerRef.current?.getBoundingClientRect()
            if (!rect) return
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
                setLng(ll.lng)
                setLat(ll.lat)
              }
            }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          })
        }
        // 等弹窗内地图尺寸就绪后再自适应到整圆（圆若已被移除则跳过）
        setTimeout(() => {
          if (circleRef.current !== circle) return
          map.invalidateSize()
          map.fitBounds(circle.getBounds(), { padding: [30, 30] })
        }, 120)
      }
    } else if (shapeType === 'polygon') {
      // 清除圆
      if (circleRef.current) {
        circleRef.current.remove()
        circleRef.current = null
      }
      if (radiusHandleRef.current) {
        radiusHandleRef.current.remove()
        radiusHandleRef.current = null
      }
      // 添加绘制工具
      if (drawControlRef.current) {
        map.addControl(drawControlRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeType])

  // lng/lat 变化：移动标记和圆心（手柄跟随），面图形也跟随水滴
  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng])
    }
    if (circleRef.current) {
      circleRef.current.setLatLng([lat, lng])
      if (radiusHandleRef.current) {
        radiusHandleRef.current.setLatLng(
          circleEdgePoint(circleRef.current, radiusHandleRef.current.getLatLng())
        )
      }
    }
    moveShapeWithMarkerRef.current?.(L.latLng(lat, lng))
  }, [lng, lat])

  // radiusKm 变化：更新圆半径（手柄沿当前方向跟随，拖拽中不回弹）
  useEffect(() => {
    const circle = circleRef.current
    if (!circle) return
    circle.setRadius(Math.max(0.001, radiusKm) * 1000)
    const handle = radiusHandleRef.current
    if (handle && !handleDraggingRef.current) {
      handle.setLatLng(circleEdgePoint(circle, handle.getLatLng()))
    }
  }, [radiusKm])

  const handleUploadCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError('')
    api
      .uploadCover(file)
      .then((res) => setCoverUrl(res.url))
      .catch((err: Error) => setUploadError(err.message))
      .finally(() => setUploading(false))
  }

  // 导入 GeoJSON：校验并渲染到地图
  const handleImportGeojson = () => {
    setGeojsonError('')
    const fg = featureGroupRef.current
    const map = mapRef.current
    if (!fg || !map) return
    const text = geojsonText.trim()
    if (!text) {
      setGeojsonError('请粘贴 GeoJSON 文本')
      return
    }
    let geo: unknown
    try {
      geo = JSON.parse(text)
    } catch {
      setGeojsonError('JSON 解析失败，请检查格式')
      return
    }
    if (typeof geo !== 'object' || geo === null) {
      setGeojsonError('GeoJSON 格式无效')
      return
    }
    const t = (geo as { type?: string }).type
    if (t !== 'Polygon' && t !== 'MultiPolygon') {
      setGeojsonError('仅支持 Polygon 或 MultiPolygon')
      return
    }
    fg.clearLayers()
    try {
      const layer = L.geoJSON(geo as GeoJSON.Geometry)
      layer.eachLayer((l) => {
        fg.addLayer(l)
        const anyLayer = l as unknown as { editing?: { enable?: () => void } }
        if (anyLayer.editing?.enable) anyLayer.editing.enable()
      })
      shapeLayerRef.current = (fg.getLayers()[0] as L.Polygon) ?? null
      if (fg.getLayers().length > 0) {
        map.fitBounds(fg.getBounds(), { padding: [40, 40] })
      }
    } catch {
      setGeojsonError('渲染失败，请检查坐标格式 [lng, lat]')
    }
  }

  // 导出 GeoJSON：从地图当前图形序列化
  const handleExportGeojson = () => {
    setGeojsonError('')
    const fg = featureGroupRef.current
    if (!fg) return
    const layers = fg.getLayers()
    if (layers.length === 0) {
      setGeojsonError('地图上没有多边形，请先绘制')
      return
    }
    const layer = layers[0] as L.Polygon
    if (typeof layer.toGeoJSON !== 'function') {
      setGeojsonError('当前图层不支持导出')
      return
    }
    const geo = layer.toGeoJSON()
    setGeojsonText(JSON.stringify(geo))
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

  const handleSave = () => {
    // 序列化 area_geojson
    let areaGeojson: string | null = null
    if (shapeType === 'polygon') {
      const fg = featureGroupRef.current
      if (fg) {
        const layers = fg.getLayers()
        if (layers.length > 0) {
          const layer = layers[0] as L.Polygon
          if (typeof layer.toGeoJSON === 'function') {
            const geo = layer.toGeoJSON()
            // 校验并补闭合 Polygon（防解析失败）：首尾顶点不同则补闭合点
            try {
              const fixRing = (ring: [number, number][]) => {
                if (ring.length >= 2) {
                  const first = ring[0]
                  const last = ring[ring.length - 1]
                  if (first[0] !== last[0] || first[1] !== last[1]) {
                    ring.push([first[0], first[1]])
                  }
                }
              }
              const g = geo as unknown as { type: string; coordinates: number[][][] | number[][][][] }
              if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
                g.coordinates.forEach((ring) => fixRing(ring as [number, number][]))
              } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
                g.coordinates.forEach((poly) => {
                  ;(poly as [number, number][][]).forEach((ring) => fixRing(ring))
                })
              }
            } catch {
              // 闭合校验失败不阻断保存（toGeoJSON 通常已闭合）
            }
            areaGeojson = JSON.stringify(geo)
          }
        }
      }
    }

    const data: AdminPOIInput = {
      name: name.trim(),
      category: category || null,
      lng,
      lat,
      adcode: adcode || null,
      summary: summary || null,
      cover_url: coverUrl || null,
      hint_text: hintText || null,
      difficulty: Number(difficulty) || 3,
      source: poi?.source ?? 'admin',
      shape_type: shapeType,
      radius_km: shapeType === 'circle' ? Math.max(0.001, Number(radiusKm) || 0) : 0,
      area_geojson: areaGeojson,
      contributor_nickname: contributorNickname || null,
      verify_status: poi?.verify_status ?? 'approved',
    }
    onSave(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 sticky top-0 bg-slate-800 z-10">
          <h3 className="text-base font-semibold text-slate-100">
            {poi ? '编辑 POI' : '新增 POI'}
          </h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
        <div className="p-5 grid grid-cols-2 gap-5">
          {/* 左侧表单 */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">名称 *</label>
              <input type="text" value={name}
                onChange={(e) => setName(e.target.value)}
                className="input" placeholder="POI 名称" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">主题分类</label>
                <select value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="input">
                  <option value="">无</option>
                  {themes.map((t) => (
                    <option key={t.code} value={t.code}>{t.name} ({t.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">adcode</label>
                <input type="text" value={adcode}
                  onChange={(e) => setAdcode(e.target.value)}
                  className="input" placeholder="行政区编码" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">难度 (1-5)</label>
                <input type="number" min={1} max={5} value={difficulty}
                  onChange={(e) => setDifficulty(Number(e.target.value))}
                  className="input" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">贡献者昵称</label>
                <input type="text" value={contributorNickname}
                  onChange={(e) => setContributorNickname(e.target.value)}
                  className="input" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">封面图片</label>
              {coverUrl ? (
                <div className="relative inline-block group"
                  onMouseEnter={() => setHoverPreview(true)}
                  onMouseLeave={() => setHoverPreview(false)}>
                  <img src={coverUrl} alt="封面"
                    className="max-h-44 max-w-full object-contain rounded-lg border border-slate-700 bg-slate-900" />
                  <div className="absolute inset-x-0 bottom-0 flex gap-2 p-2 rounded-b-lg bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="px-2 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded">
                      {uploading ? '上传中…' : '替换图片'}
                    </button>
                  </div>
                  {/* 隐藏的替换用文件选择 */}
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                    onChange={handleUploadCover} disabled={uploading} />
                </div>
              ) : (
                <label className="inline-block px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg cursor-pointer">
                  {uploading ? '上传中…' : '上传封面'}
                  <input type="file" accept="image/*" className="hidden"
                    onChange={handleUploadCover} disabled={uploading} />
                </label>
              )}
              {uploadError && <div className="text-xs text-red-400 mt-1">{uploadError}</div>}
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">简介</label>
              <textarea value={summary} rows={2}
                onChange={(e) => setSummary(e.target.value)}
                className="input" placeholder="POI 简介" />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">提示文案</label>
              <textarea value={hintText} rows={2}
                onChange={(e) => setHintText(e.target.value)}
                className="input" placeholder="游戏内提示" />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">形态 (shape_type)</label>
              <div className="flex gap-2">
                {(['point', 'circle', 'polygon'] as ShapeType[]).map((s) => (
                  <button key={s} type="button"
                    onClick={() => {
                      if (s === 'circle' && radiusKm <= 0) setRadiusKm(0.5)
                      setShapeType(s)
                    }}
                    className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${
                      shapeType === s
                        ? 'bg-cyan-600 border-cyan-500 text-white'
                        : 'bg-slate-900 border-slate-600 text-slate-300 hover:border-slate-500'
                    }`}>
                    {s === 'point' ? '点' : s === 'circle' ? '圆' : '多边形'}
                  </button>
                ))}
              </div>
            </div>

            {shapeType === 'circle' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">半径 (km)</label>
                <input type="number" min={0.001} step="any" value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className="input" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">经度 (lng)</label>
                <input type="number" step={0.0001} value={lng}
                  onChange={(e) => setLng(Number(e.target.value))}
                  className="input" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">纬度 (lat)</label>
                <input type="number" step={0.0001} value={lat}
                  onChange={(e) => setLat(Number(e.target.value))}
                  className="input" />
              </div>
            </div>
          </div>

          {/* 右侧地图 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400">地图（拖拽中心点更新坐标）</label>
              <span className="text-xs text-slate-500">
                {shapeType === 'polygon' ? '使用左上角工具绘制多边形' : shapeType === 'circle' ? '按住圆形拖动可移动，拖拽边缘圆点或改半径数值调整大小' : '仅中心点'}
              </span>
            </div>
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
            <div
              ref={mapContainerRef}
              className="h-[420px] w-full rounded-lg border border-slate-700 overflow-hidden bg-slate-900"
            />

            {/* GeoJSON 导入/导出（仅多边形形态） */}
            {shapeType === 'polygon' && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleImportGeojson}
                    className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg"
                  >
                    导入 GeoJSON
                  </button>
                  <button
                    onClick={handleExportGeojson}
                    className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg"
                  >
                    导出 GeoJSON
                  </button>
                  <span className="text-[11px] text-slate-500">支持 Polygon / MultiPolygon</span>
                </div>
                <textarea
                  value={geojsonText}
                  onChange={(e) => setGeojsonText(e.target.value)}
                  rows={3}
                  placeholder='{"type":"Polygon","coordinates":[[[lng,lat],...]]}'
                  className="input font-mono text-[11px]"
                />
                {geojsonError && <div className="text-xs text-red-400">{geojsonError}</div>}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-700 sticky bottom-0 bg-slate-800">
          <button type="button" onClick={onCancel}
            className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg">取消</button>
          <button type="submit"
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg">保存</button>
        </div>
        </form>
      </div>

      {/* 封面 hover 放大预览（最顶层，需高于 Leaflet 内部 z-index ~800；pointer-events-none 避免抢占鼠标导致抖动） */}
      {hoverPreview && coverUrl && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 pointer-events-none">
          <img src={coverUrl} alt="封面预览"
            className="max-w-[96vw] max-h-[96vh] object-contain shadow-2xl" />
        </div>
      )}
    </div>
  )
}

import L from 'leaflet'

// 地图瓦片源配置：arcgis（默认）/ tianditu / amap
export const TILE_SOURCE: 'arcgis' | 'tianditu' | 'amap' = 'amap'
export const TIANDITU_KEY = '' // 天地图审核通过后填入
export const AMAP_KEY = '98b2baa96f7dad370b90f22ec5d3f92a'

/**
 * 添加卫星瓦片底图和标注层到地图
 * 返回标注层引用，供巡航降级时移除（隐藏地名文字增加猜测感）
 */
export function addTileLayers(map: L.Map): L.TileLayer | null {
  let labelLayer: L.TileLayer | null = null
  if (TILE_SOURCE === 'tianditu' && TIANDITU_KEY) {
    // 天地图卫星影像
    L.tileLayer(
      'https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=' + TIANDITU_KEY,
      { subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'], maxZoom: 18 }
    ).addTo(map)
    // 天地图影像注记
    labelLayer = L.tileLayer(
      'https://t{s}.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=' + TIANDITU_KEY,
      { subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'] }
    ).addTo(map)
  } else if (TILE_SOURCE === 'amap' && AMAP_KEY) {
    // 高德卫星瓦片
    L.tileLayer(
      'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
      { subdomains: ['1', '2', '3', '4'], maxZoom: 18 }
    ).addTo(map)
    // 高德标注层
    labelLayer = L.tileLayer(
      'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
      { subdomains: ['1', '2', '3', '4'] }
    ).addTo(map)
  } else {
    // ArcGIS World Imagery（默认，免费无需 Key）
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18, attribution: 'Esri, Maxar, Earthstar Geographics' }
    ).addTo(map)
    // ArcGIS 标注层
    labelLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri, Maxar, Earthstar Geographics' }
    ).addTo(map)
  }
  return labelLayer
}

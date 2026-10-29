// leaflet-draw 1.0.4 兼容性补丁
//
// 修复 bug（上游 issue Leaflet/Leaflet.draw#1026）：
// L.GeometryUtil.readableArea 内 `type = typeof isMetric` 给未声明的全局变量赋值，
// 在 ESM 严格模式下抛 `ReferenceError: type is not defined`，
// 导致矩形工具（showArea 默认开启）绘制时 tooltip 计算崩溃、无法完成绘制。
//
// 用法：`import '../utils/leafletDrawPatch'` 替代直接 `import 'leaflet-draw'`。
import L from 'leaflet'
import 'leaflet-draw'

/* eslint-disable @typescript-eslint/no-explicit-any */
const GeometryUtil = (L as any).GeometryUtil

if (GeometryUtil && typeof GeometryUtil.readableArea === 'function') {
  GeometryUtil.readableArea = function (area: number, isMetric: boolean | string | string[], precision?: Record<string, number>) {
    const defaultPrecision = { km: 2, ha: 2, m: 0, mi: 2, ac: 2, yd: 0 }
    const prec = { ...defaultPrecision, ...precision }
    const fmt = (n: number, p: number) => GeometryUtil.formattedNumber(n, p) as string
    let areaStr: string
    let units: string[]
    if (isMetric) {
      units = ['ha', 'm']
      // 修复点：原文是 `type = typeof isMetric`（未声明变量），此处改为局部变量
      const type = typeof isMetric
      if (type === 'string') {
        units = [isMetric as string]
      } else if (type !== 'boolean') {
        units = isMetric as string[]
      }
      if (area >= 1000000 && units.indexOf('km') !== -1) {
        areaStr = fmt(area * 0.000001, prec.km) + ' km²'
      } else if (area >= 10000 && units.indexOf('ha') !== -1) {
        areaStr = fmt(area * 0.0001, prec.ha) + ' ha'
      } else {
        areaStr = fmt(area, prec.m) + ' m²'
      }
    } else {
      area /= 0.836127 // Square yards in 1 meter
      if (area >= 3097600) { // 3097600 square yards in 1 square mile
        areaStr = fmt(area / 3097600, prec.mi) + ' mi²'
      } else if (area >= 4840) { // 4840 square yards in 1 acre
        areaStr = fmt(area / 4840, prec.ac) + ' acres'
      } else {
        areaStr = fmt(area, prec.yd) + ' yd²'
      }
    }
    return areaStr
  }
}

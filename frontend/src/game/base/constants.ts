import L from 'leaflet'

// 8 方向定义（行列布局用于仪表盘按钮）
export const DIRECTIONS = [
  { key: 'NW', label: '西北', row: 0, col: 0 },
  { key: 'N', label: '北', row: 0, col: 1 },
  { key: 'NE', label: '东北', row: 0, col: 2 },
  { key: 'W', label: '西', row: 1, col: 0 },
  { key: 'E', label: '东', row: 1, col: 2 },
  { key: 'SW', label: '西南', row: 2, col: 0 },
  { key: 'S', label: '南', row: 2, col: 1 },
  { key: 'SE', label: '东南', row: 2, col: 2 },
]

// 简单模式快捷距离（单人独有，PK 无）
export const QUICK_DISTANCES = [10, 50, 100, 500]

// 巡航加速：第 1~7 次点击对应速度（km/秒），按模式缩放
export const CRUISE_SPEEDS_BY_MODE: Record<string, number[]> = {
  national: [10, 20, 40, 80, 160, 320, 640],
  provincial: [2, 4, 8, 16, 32, 64, 128],
}

// 巡航速度档位 → zoom 降级数（速度越快降级越多，瓦片覆盖更大区域加速加载）
// 第 6/7 档维持最大 5 级：速度更快但视野不再扩大（zoom 锁 15 时最低到 10）
export const ZOOM_REDUCE_BY_SPEED_IDX = [1, 2, 3, 4, 5, 5, 5]

// 方向 → 屏幕像素向量（斜向归一化）
export const DIR_VEC: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NW: [-0.7071, -0.7071], NE: [0.7071, -0.7071],
  SW: [-0.7071, 0.7071], SE: [0.7071, 0.7071],
}

export const DIR_LABEL: Record<string, string> = {
  N: '北', S: '南', E: '东', W: '西',
  NW: '西北', NE: '东北', SW: '西南', SE: '东南',
}

export const OPPOSITE: Record<string, string> = {
  N: 'S', S: 'N', E: 'W', W: 'E',
  NW: 'SE', SE: 'NW', NE: 'SW', SW: 'NE',
}

// 方向 → 飞机图标旋转角度（0° 朝上 = 北）
export const DIR_ANGLE: Record<string, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
}

// 键盘按键 → 方向
export const KEY_DIR: Record<string, string> = {
  w: 'N', arrowup: 'N',
  s: 'S', arrowdown: 'S',
  a: 'W', arrowleft: 'W',
  d: 'E', arrowright: 'E',
  q: 'NW', e: 'NE', z: 'SW', c: 'SE',
}

// 仪表盘快捷跳转距离（km），6 个分两排，按模式缩放
export const JUMP_DISTANCES_BY_MODE: Record<string, number[]> = {
  national: [10, 50, 100, 200, 500, 1000],
  provincial: [1, 5, 10, 20, 50, 100],
}

// 边缘 8 方向按钮贴边位置（紧贴地图最边缘）
export const EDGE_DIRS = [
  { key: 'NW', icon: '↖', pos: 'top-12 left-2' },
  { key: 'N', icon: '↑', pos: 'top-12 left-1/2 -translate-x-1/2' },
  { key: 'NE', icon: '↗', pos: 'top-12 right-2' },
  { key: 'W', icon: '←', pos: 'left-2 top-1/2 -translate-y-1/2' },
  { key: 'E', icon: '→', pos: 'right-2 top-1/2 -translate-y-1/2' },
  { key: 'SW', icon: '↙', pos: 'bottom-2 left-2' },
  { key: 'S', icon: '↓', pos: 'bottom-2 left-1/2 -translate-x-1/2' },
  { key: 'SE', icon: '↘', pos: 'bottom-2 right-2' },
]

// 各模式的固定缩放级别
export const ZOOM_CONFIG: Record<string, { start: number }> = {
  national: { start: 15 },
  provincial: { start: 16 },
  city: { start: 16 },
}

// 简单模式的落点标记图标（倒水滴形状）
export const PICK_ICON = L.divIcon({
  className: '',
  html:
    '<svg width="48" height="48" viewBox="0 0 24 24" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,0.55))">' +
    '<path d="M12 1.6C7.4 1.6 3.7 5.3 3.7 9.9c0 5.6 8.3 12.5 8.3 12.5s8.3-6.9 8.3-12.5c0-4.6-3.7-8.3-8.3-8.3z" fill="#e63946" stroke="#ffffff" stroke-width="1.5"/>' +
    '<circle cx="12" cy="9.5" r="2.8" fill="#ffffff"/>' +
    '</svg>',
  iconSize: [48, 48],
  iconAnchor: [24, 45],
})

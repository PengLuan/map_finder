import { useState, useMemo, useRef, useEffect } from 'react'
import L from 'leaflet'
import { getGameRecords, clearGameRecords, type GameRecordItem } from '../utils/gameRecords'

interface Props {
  onClose: () => void
}

const MODE_LABEL: Record<string, string> = {
  national: '全国',
  provincial: '省市',
  city: '城市',
}

const DIFF_LABEL: Record<string, string> = {
  easy: '点选',
  hard: '巡航',
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

function formatDuration(sec: number): string {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}分${s}秒` : `${s}秒`
}

export default function GameRecordsModal({ onClose }: Props) {
  const [list, setList] = useState<GameRecordItem[]>(() => getGameRecords())
  const [detail, setDetail] = useState<GameRecordItem | null>(null)

  const stats = useMemo(() => {
    if (!list.length) return null
    const wins = list.filter((r) => r.hit).length
    const avgScore = Math.round(list.reduce((s, r) => s + r.score, 0) / list.length)
    return { total: list.length, wins, avgScore }
  }, [list])

  const handleClear = () => {
    if (!confirm('确定清空所有游戏记录？此操作不可恢复。')) return
    clearGameRecords()
    setList([])
  }

  if (detail) {
    return <RecordDetail record={detail} onBack={() => setDetail(null)} onClose={onClose} />
  }

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="font-hud text-lg text-cyan-400">📜 游戏记录</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        {stats && (
          <div className="px-4 py-2 bg-slate-800/50 text-xs text-slate-300 flex gap-4 border-b border-slate-700">
            <span>共 {stats.total} 局</span>
            <span className="text-emerald-400">命中 {stats.wins}</span>
            <span>平均分 {stats.avgScore}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {list.length === 0 ? (
            <div className="text-center text-slate-500 py-12 text-sm">
              还没有游戏记录
              <div className="mt-1 text-xs">完成一局后将自动记录最近 20 局</div>
            </div>
          ) : (
            list.map((r, i) => (
              <button
                key={i}
                onClick={() => setDetail(r)}
                className={`w-full text-left rounded-lg p-2.5 text-xs border transition-colors hover:bg-slate-700/50 ${
                  r.hit
                    ? 'bg-emerald-900/20 border-emerald-700/50'
                    : 'bg-slate-800/50 border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 truncate flex-1">
                    {r.target_name || '未知目标'}
                  </span>
                  <span
                    className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      r.hit ? 'bg-emerald-600 text-white' : 'bg-slate-600 text-slate-200'
                    }`}
                  >
                    {r.hit ? '命中' : '未中'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-slate-400 text-[11px]">
                  <span>{formatTime(r.ts)}</span>
                  <span>{MODE_LABEL[r.mode] || r.mode} · {DIFF_LABEL[r.difficulty] || r.difficulty}</span>
                  <span className="text-amber-400">分数 {r.score}</span>
                  {/* 困难模式命中后不显示"距目标"——已找到即无距离可言 */}
                  {!(r.difficulty !== 'easy' && r.hit) && (
                    <span>{r.hit ? '点击精度' : '距目标'} {r.distance_km.toFixed(1)}km</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {list.length > 0 && (
          <div className="p-3 border-t border-slate-700">
            <button
              onClick={handleClear}
              className="w-full py-1.5 text-xs bg-slate-700 hover:bg-red-700/60 rounded-lg text-slate-300 hover:text-white transition-colors"
            >
              清空记录
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 复盘详情视图 =====

function RecordDetail({ record, onBack, onClose }: { record: GameRecordItem; onBack: () => void; onClose: () => void }) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (record.target_lng == null || record.target_lat == null) return

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([record.target_lat, record.target_lng], 14)
    mapRef.current = map

    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8', {
      subdomains: ['1', '2', '3', '4'],
      maxZoom: 18,
    }).addTo(map)

    // 目标点 🎯 标记
    const icon = L.divIcon({
      className: '',
      html:
        '<div class="relative w-16 h-16">' +
        '<span class="absolute inset-0 rounded-full bg-green-500/50 animate-ping"></span>' +
        '<span class="absolute inset-3 rounded-full bg-green-500 border-2 border-white shadow-lg"></span>' +
        '<span class="absolute inset-0 flex items-center justify-center text-xl">🎯</span>' +
        '</div>',
      iconSize: [64, 64],
      iconAnchor: [32, 32],
    })
    L.marker([record.target_lat, record.target_lng], { icon }).addTo(map)

    setTimeout(() => map.invalidateSize(), 100)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [record])

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <button
            onClick={onBack}
            className="text-slate-300 hover:text-white text-sm flex items-center gap-1"
          >
            ← 返回列表
          </button>
          <h2 className="font-hud text-base text-cyan-400">游戏复盘</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* 小地图 */}
          {record.target_lng != null && record.target_lat != null ? (
            <div ref={containerRef} className="w-full h-64 bg-slate-800" />
          ) : (
            <div className="w-full h-32 flex items-center justify-center text-slate-500 text-sm">
              无坐标数据
            </div>
          )}

          {/* 结算信息 */}
          <div className="p-4 space-y-3">
            <div className="text-center">
              <h3 className="font-hud text-xl text-amber-400">{record.target_name || '未知目标'}</h3>
              <div className="text-xs text-slate-500 mt-1">{formatTime(record.ts)}</div>
            </div>

            {/* 命中状态 */}
            <div className={`text-center py-2 rounded-lg ${record.hit ? 'bg-emerald-900/30' : 'bg-slate-800'}`}>
              <div className={`text-lg font-bold ${record.hit ? 'text-emerald-400' : 'text-slate-400'}`}>
                {record.hit ? '🏆 命中目标' : '未命中'}
              </div>
            </div>

            {/* 数据网格 */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-800/50 rounded p-2">
                <div className="text-slate-500">分数</div>
                <div className="text-amber-400 font-bold text-base">{record.score}</div>
              </div>
              <div className="bg-slate-800/50 rounded p-2">
                <div className="text-slate-500">用时</div>
                <div className="text-slate-200 font-bold text-base">{formatDuration(record.duration_sec)}</div>
              </div>
              {/* 困难模式命中后不显示"距目标"——已找到即无距离可言；简单模式命中显示点击精度，未命中显示最终距离 */}
              {!(record.difficulty !== 'easy' && record.hit) && (
                <div className="bg-slate-800/50 rounded p-2">
                  <div className="text-slate-500">{record.hit ? '点击精度' : '距目标'}</div>
                  <div className="text-slate-200 font-bold">{record.distance_km.toFixed(1)} km</div>
                </div>
              )}
              <div className="bg-slate-800/50 rounded p-2">
                <div className="text-slate-500">累计移动</div>
                <div className="text-slate-200 font-bold">{record.total_distance_km.toFixed(0)} km</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-800/30 rounded p-2">
              <span>{MODE_LABEL[record.mode] || record.mode} · {DIFF_LABEL[record.difficulty] || record.difficulty}</span>
              {record.contributor && <span>贡献者：{record.contributor}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

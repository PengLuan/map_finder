import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '../../api/admin'
import type { Overview as OverviewData } from '../../types/admin'

interface Props {
  onAuthError: () => void
}

function formatDuration(sec: number): string {
  if (!sec || sec < 0) return '0秒'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (m === 0) return `${s}秒`
  return `${m}分${s}秒`
}

export default function Overview({ onAuthError }: Props) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    adminApi
      .overview()
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [onAuthError])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return <div className="p-8 text-slate-400">加载中…</div>
  }
  if (error) {
    return <div className="p-8 text-red-400 bg-red-500/10 m-4 rounded-lg">{error}</div>
  }
  if (!data) return null

  const maxTrend = Math.max(1, ...data.trend.map((t) => t.count))
  const maxMode = Math.max(1, ...data.mode_dist.map((m) => m.count))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">数据概览</h2>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
          {loading ? '刷新中…' : '↻ 刷新'}
        </button>
      </div>

      {/* 关键指标卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="今日 DAU" value={String(data.today_dau)} icon="👤" />
        <MetricCard label="今日对局数" value={String(data.today_games)} icon="🎮" />
        <MetricCard label="平均时长" value={formatDuration(data.avg_duration)} icon="⏱️" />
      </div>

      {/* 趋势 + 模式分布 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 近7天对局趋势 */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">近 7 天对局趋势</h3>
          <div className="flex items-end gap-2 h-40">
            {data.trend.map((t) => (
              <div key={t.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-xs text-slate-400">{t.count}</div>
                <div
                  className="w-full bg-gradient-to-t from-cyan-600 to-cyan-400 rounded-t min-h-[2px]"
                  style={{ height: `${(t.count / maxTrend) * 100}%` }}
                />
                <div className="text-xs text-slate-500">
                  {t.date.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 模式分布 */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">模式分布</h3>
          <div className="space-y-3">
            {data.mode_dist.length === 0 && (
              <div className="text-sm text-slate-500">暂无数据</div>
            )}
            {data.mode_dist.map((m) => (
              <div key={m.mode}>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{m.mode}</span>
                  <span>{m.count}</span>
                </div>
                <div className="w-full h-2.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-400 rounded-full"
                    style={{ width: `${(m.count / maxMode) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* IP 汇总表格 */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">IP 汇总</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="py-2 px-3 font-medium">IP</th>
                <th className="py-2 px-3 font-medium">对局数</th>
                <th className="py-2 px-3 font-medium">总时长</th>
                <th className="py-2 px-3 font-medium">最后活跃</th>
              </tr>
            </thead>
            <tbody>
              {data.ip_summary.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-500">
                    暂无数据
                  </td>
                </tr>
              )}
              {data.ip_summary.map((ip) => (
                <tr key={ip.ip} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="py-2 px-3 text-slate-200 font-mono">{ip.ip}</td>
                  <td className="py-2 px-3 text-slate-300">{ip.games}</td>
                  <td className="py-2 px-3 text-slate-300">{formatDuration(ip.total_duration)}</td>
                  <td className="py-2 px-3 text-slate-400">{ip.last_active ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-400">{label}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <div className="text-2xl font-bold text-slate-100">{value}</div>
    </div>
  )
}

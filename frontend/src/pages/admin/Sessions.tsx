import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '../../api/admin'
import type { SessionList, SessionItem } from '../../types/admin'

interface Props {
  onAuthError: () => void
}

interface Filters {
  start: string
  end: string
  ip: string
  ip_region: string
  nickname: string
  mode: string
  difficulty: string
  game_type: string
}

const MODES = ['', 'national', 'provincial', 'theme']
const DIFFICULTIES = ['', 'easy', 'hard']
const GAME_TYPES = ['', 'solo', 'pk']

function formatDuration(sec: number): string {
  if (!sec || sec < 0) return '-'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (m === 0) return `${s}秒`
  return `${m}分${s}秒`
}

export default function Sessions({ onAuthError }: Props) {
  const [filters, setFilters] = useState<Filters>({
    start: '', end: '', ip: '', ip_region: '', nickname: '', mode: '', difficulty: '', game_type: '',
  })
  const [applied, setApplied] = useState<Filters>(filters)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<SessionList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    adminApi
      .listSessions({
        start: applied.start || undefined,
        end: applied.end || undefined,
        ip: applied.ip || undefined,
        ip_region: applied.ip_region || undefined,
        nickname: applied.nickname || undefined,
        mode: applied.mode || undefined,
        difficulty: applied.difficulty || undefined,
        game_type: applied.game_type || undefined,
        page,
        page_size: 20,
      })
      .then((d) => setData(d))
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [applied, page, onAuthError])

  useEffect(() => {
    load()
  }, [load])

  const handleSearch = () => {
    setApplied(filters)
    setPage(1)
  }

  const handleReset = () => {
    const empty: Filters = {
      start: '', end: '', ip: '', ip_region: '', nickname: '', mode: '', difficulty: '', game_type: '',
    }
    setFilters(empty)
    setApplied(empty)
    setPage(1)
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">玩家会话</h2>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
          {loading ? '刷新中…' : '↻ 刷新'}
        </button>
      </div>

      {/* 筛选区 */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-4 gap-3">
          <Field label="开始时间">
            <input type="datetime-local" value={filters.start}
              onChange={(e) => setFilters({ ...filters, start: e.target.value })}
              className="input" />
          </Field>
          <Field label="结束时间">
            <input type="datetime-local" value={filters.end}
              onChange={(e) => setFilters({ ...filters, end: e.target.value })}
              className="input" />
          </Field>
          <Field label="IP">
            <input type="text" value={filters.ip} placeholder="如 1.2.3.4"
              onChange={(e) => setFilters({ ...filters, ip: e.target.value })}
              className="input" />
          </Field>
          <Field label="IP归属地">
            <input type="text" value={filters.ip_region} placeholder="如 江苏"
              onChange={(e) => setFilters({ ...filters, ip_region: e.target.value })}
              className="input" />
          </Field>
          <Field label="昵称">
            <input type="text" value={filters.nickname}
              onChange={(e) => setFilters({ ...filters, nickname: e.target.value })}
              className="input" />
          </Field>
          <Field label="模式">
            <select value={filters.mode}
              onChange={(e) => setFilters({ ...filters, mode: e.target.value })}
              className="input">
              {MODES.map((m) => <option key={m} value={m}>{m || '全部'}</option>)}
            </select>
          </Field>
          <Field label="难度">
            <select value={filters.difficulty}
              onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })}
              className="input">
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d || '全部'}</option>)}
            </select>
          </Field>
          <Field label="游戏类型">
            <select value={filters.game_type}
              onChange={(e) => setFilters({ ...filters, game_type: e.target.value })}
              className="input">
              {GAME_TYPES.map((g) => <option key={g} value={g}>{g || '全部'}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSearch}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg">
            搜索
          </button>
          <button onClick={handleReset}
            className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg">
              重置
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      {/* 表格 */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 bg-slate-800 border-b border-slate-700">
                <th className="py-2.5 px-3 font-medium">IP</th>
                <th className="py-2.5 px-3 font-medium">IP归属地</th>
                <th className="py-2.5 px-3 font-medium">昵称</th>
                <th className="py-2.5 px-3 font-medium">模式</th>
                <th className="py-2.5 px-3 font-medium">难度</th>
                <th className="py-2.5 px-3 font-medium">类型</th>
                <th className="py-2.5 px-3 font-medium">结果</th>
                <th className="py-2.5 px-3 font-medium">得分</th>
                <th className="py-2.5 px-3 font-medium">时长</th>
                <th className="py-2.5 px-3 font-medium">开始时间</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="py-6 text-center text-slate-400">加载中…</td></tr>
              )}
              {!loading && data && data.items.length === 0 && (
                <tr><td colSpan={10} className="py-6 text-center text-slate-500">暂无数据</td></tr>
              )}
              {!loading && data && data.items.map((s: SessionItem) => (
                <tr key={s.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="py-2 px-3 text-slate-300 font-mono text-xs">{s.ip}</td>
                  <td className="py-2 px-3 text-slate-300 text-xs">{s.ip_region ?? '-'}</td>
                  <td className="py-2 px-3 text-slate-300">{s.nickname ?? '-'}</td>
                  <td className="py-2 px-3 text-slate-300">{s.mode}</td>
                  <td className="py-2 px-3 text-slate-300">{s.difficulty}</td>
                  <td className="py-2 px-3 text-slate-300">{s.game_type}</td>
                  <td className="py-2 px-3">
                    {s.won
                      ? <span className="text-green-400">胜</span>
                      : <span className="text-red-400">负</span>}
                  </td>
                  <td className="py-2 px-3 text-slate-300">{s.score}</td>
                  <td className="py-2 px-3 text-slate-300">{formatDuration(s.duration_sec)}</td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{s.started_at ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
          <span className="text-xs text-slate-400">
            共 {data?.total ?? 0} 条 · 第 {page}/{totalPages} 页
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg"
            >
              上一页
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

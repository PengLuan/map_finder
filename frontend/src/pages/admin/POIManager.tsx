import { useState, useEffect, useCallback, Fragment } from 'react'
import { adminApi } from '../../api/admin'
import type { AdminPOI, AdminPOIList, AdminPOIInput, AdminTheme, POILeaderRow } from '../../types/admin'
import POIEditor from '../../components/admin/POIEditor'
import { POIRowDetail } from '../../components/admin/POIRowDetail'

interface Props {
  onAuthError: () => void
}

interface Filters {
  category: string
  adcode: string
  difficulty: string
  verify_status: string
  shape_type: string
  area_review: string
  keyword: string
}

const DIFFICULTIES = ['', '1', '2', '3', '4', '5']
const VERIFY_STATUSES = ['', 'pending', 'approved', 'rejected']
const SHAPE_TYPES = ['', 'point', 'circle', 'polygon']
const AREA_REVIEWS = [
  { value: '', label: '全部' },
  { value: '0', label: '已确认' },
  { value: '1', label: '待核定' },
]

export default function POIManager({ onAuthError }: Props) {
  const [themes, setThemes] = useState<AdminTheme[]>([])
  const [filters, setFilters] = useState<Filters>({
    category: '', adcode: '', difficulty: '', verify_status: '', shape_type: '', area_review: '', keyword: '',
  })
  const [applied, setApplied] = useState<Filters>(filters)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AdminPOIList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editorPoi, setEditorPoi] = useState<AdminPOI | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<AdminPOI | null>(null)
  const [confirmArea, setConfirmArea] = useState<AdminPOI | null>(null)
  const [lbPOI, setLbPOI] = useState<AdminPOI | null>(null)
  const [lbCollId, setLbCollId] = useState<number | null>(null)
  const [lbDifficulty, setLbDifficulty] = useState<'easy' | 'hard'>('easy')
  const [lbRows, setLbRows] = useState<POILeaderRow[]>([])
  const [lbLoading, setLbLoading] = useState(false)
  // 行展开（显示形态标签 + radius + 范围缩略图）
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const toggleRow = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 加载主题列表用于下拉
  useEffect(() => {
    adminApi
      .listThemes(true)
      .then(setThemes)
      .catch((e: Error) => {
        if (e.message.includes('未登录')) onAuthError()
      })
  }, [onAuthError])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    adminApi
      .listPois({
        category: applied.category || undefined,
        adcode: applied.adcode || undefined,
        difficulty: applied.difficulty || undefined,
        verify_status: applied.verify_status || undefined,
        shape_type: applied.shape_type || undefined,
        area_review: applied.area_review || undefined,
        keyword: applied.keyword || undefined,
        page,
        page_size: 20,
      })
      .then(setData)
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

  // 下拉筛选项变更立即生效，无需点搜索按钮
  const applySelect = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setApplied((a) => ({ ...a, [key]: value }))
    setPage(1)
  }

  const handleReset = () => {
    const empty: Filters = { category: '', adcode: '', difficulty: '', verify_status: '', shape_type: '', area_review: '', keyword: '' }
    setFilters(empty)
    setApplied(empty)
    setPage(1)
  }

  const openCreate = () => {
    setEditorPoi(null)
    setShowEditor(true)
  }

  const openEdit = (poi: AdminPOI) => {
    setEditorPoi(poi)
    setShowEditor(true)
  }

  const handleSave = (input: AdminPOIInput) => {
    setSaving(true)
    const action = editorPoi
      ? adminApi.updatePoi(editorPoi.id, input)
      : adminApi.createPoi(input)
    action
      .then(() => {
        setShowEditor(false)
        load()
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setSaving(false))
  }

  const handleConfirmArea = (poi: AdminPOI) => {
    setSaving(true)
    adminApi
      .confirmPoiArea(poi.id)
      .then(() => {
        setConfirmArea(null)
        load()
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setSaving(false))
  }

  const handleDelete = (poi: AdminPOI) => {
    setSaving(true)
    adminApi
      .deletePoi(poi.id)
      .then(() => {
        setConfirmDelete(null)
        load()
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setSaving(false))
  }

  const openLeaderboard = (poi: AdminPOI) => {
    setLbPOI(poi)
    setLbCollId(poi.collections[0]?.id ?? null)
    setLbDifficulty('easy')
    setLbRows([])
  }

  const loadPOILeaderboard = (collId: number, difficulty: 'easy' | 'hard') => {
    if (!lbPOI) return
    setLbLoading(true)
    setError('')
    adminApi
      .getPOILeaderboard(lbPOI.id, collId, difficulty)
      .then(setLbRows)
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
        setLbRows([])
      })
      .finally(() => setLbLoading(false))
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      approved: 'text-green-400 bg-green-500/10',
      pending: 'text-yellow-400 bg-yellow-500/10',
      rejected: 'text-red-400 bg-red-500/10',
    }
    return map[s] ?? 'text-slate-400 bg-slate-500/10'
  }

  // 形态标签颜色：point 灰、circle 青、polygon 紫
  const shapeBadge = (s: string) => {
    const map: Record<string, string> = {
      point: 'text-slate-300 bg-slate-500/15 border-slate-500/30',
      circle: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30',
      polygon: 'text-violet-300 bg-violet-500/15 border-violet-500/30',
    }
    return map[s] ?? 'text-slate-400 bg-slate-500/10 border-slate-600/40'
  }

  const shapeLabel = (s: string) => (s === 'point' ? '点' : s === 'circle' ? '圆' : s === 'polygon' ? '多边形' : s)

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">POI 管理</h2>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
            {loading ? '刷新中…' : '↻ 刷新'}
          </button>
          <button onClick={openCreate}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg">
            + 新增 POI
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex gap-4">
        {/* 左侧筛选 */}
        <div className="w-60 shrink-0 bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3 h-fit">
          <h3 className="text-sm font-semibold text-slate-200">筛选</h3>
          <div>
            <label className="block text-xs text-slate-400 mb-1">主题</label>
            <select value={filters.category}
              onChange={(e) => applySelect('category', e.target.value)}
              className="input">
              <option value="">全部</option>
              {themes.map((t) => (
                <option key={t.code} value={t.code}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">adcode 前缀</label>
            <input type="text" value={filters.adcode}
              onChange={(e) => setFilters({ ...filters, adcode: e.target.value })}
              className="input" placeholder="如 11" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">难度</label>
            <select value={filters.difficulty}
              onChange={(e) => applySelect('difficulty', e.target.value)}
              className="input">
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d || '全部'}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">审核状态</label>
            <select value={filters.verify_status}
              onChange={(e) => applySelect('verify_status', e.target.value)}
              className="input">
              {VERIFY_STATUSES.map((s) => <option key={s} value={s}>{s || '全部'}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">形态</label>
            <select value={filters.shape_type}
              onChange={(e) => applySelect('shape_type', e.target.value)}
              className="input">
              {SHAPE_TYPES.map((s) => <option key={s} value={s}>{s || '全部'}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">区域核定</label>
            <select value={filters.area_review}
              onChange={(e) => applySelect('area_review', e.target.value)}
              className="input">
              {AREA_REVIEWS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">关键字</label>
            <input type="text" value={filters.keyword}
              onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
              className="input" placeholder="名称/简介" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleSearch}
              className="flex-1 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg">搜索</button>
            <button onClick={handleReset}
              className="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg">重置</button>
          </div>
        </div>

        {/* 右侧表格 */}
        <div className="flex-1 bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 bg-slate-800 border-b border-slate-700">
                  <th className="py-2.5 px-3 font-medium w-8"></th>
                  <th className="py-2.5 px-3 font-medium">名称</th>
                  <th className="py-2.5 px-3 font-medium">坐标</th>
                  <th className="py-2.5 px-3 font-medium">形态</th>
                  <th className="py-2.5 px-3 font-medium">难度</th>
                  <th className="py-2.5 px-3 font-medium">主题</th>
                  <th className="py-2.5 px-3 font-medium">所属专题</th>
                  <th className="py-2.5 px-3 font-medium">审核</th>
                  <th className="py-2.5 px-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={9} className="py-6 text-center text-slate-400">加载中…</td></tr>
                )}
                {!loading && data && data.items.length === 0 && (
                  <tr><td colSpan={9} className="py-6 text-center text-slate-500">暂无数据</td></tr>
                )}
                {!loading && data && data.items.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      <td className="py-2 px-2 text-slate-500">
                        <button
                          onClick={() => toggleRow(p.id)}
                          className="text-xs hover:text-cyan-300 transition-colors w-5 h-5 flex items-center justify-center"
                          title={expandedRows.has(p.id) ? '收起' : '展开范围缩略图'}
                        >
                          {expandedRows.has(p.id) ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-slate-200">
                        <div>{p.name}</div>
                        <div className="text-xs text-slate-500">#{p.id}</div>
                      </td>
                      <td className="py-2 px-3 text-slate-400 font-mono text-xs">
                        {p.lng.toFixed(4)}, {p.lat.toFixed(4)}
                      </td>
                      <td className="py-2 px-3 text-slate-300">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded border ${shapeBadge(p.shape_type)}`}>
                          {shapeLabel(p.shape_type)}
                        </span>
                        {p.shape_type === 'circle' && (
                          <span className="ml-2 text-xs text-cyan-300">{p.radius_km}km</span>
                        )}
                        {p.area_review === 1 && (
                          <button onClick={() => setConfirmArea(p)}
                            className="ml-2 text-xs px-2 py-0.5 bg-yellow-500/15 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/40 rounded">
                            待核定
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-300">{p.difficulty}</td>
                      <td className="py-2 px-3 text-slate-300">{p.category ?? '-'}</td>
                      <td className="py-2 px-3 text-slate-300">
                        {(p.collections ?? []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(p.collections ?? []).map((c) => (
                              <span key={c.id} className="inline-block text-xs px-1.5 py-0.5 bg-slate-700/60 text-slate-200 rounded">
                                {c.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded ${statusBadge(p.verify_status)}`}>
                          {p.verify_status}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex gap-2">
                          <button onClick={() => openLeaderboard(p)}
                            className="text-xs px-2 py-1 bg-amber-700/70 hover:bg-amber-600 text-white rounded">排行</button>
                          <button onClick={() => openEdit(p)}
                            className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded">编辑</button>
                          <button onClick={() => setConfirmDelete(p)}
                            className="text-xs px-2 py-1 bg-red-600/80 hover:bg-red-500 text-white rounded">删除</button>
                        </div>
                      </td>
                    </tr>
                    {expandedRows.has(p.id) && (
                      <tr className="bg-slate-900/40 border-b border-slate-700/50">
                        <td colSpan={9} className="py-3 px-6">
                          <POIRowDetail poi={p} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
            <span className="text-xs text-slate-400">
              共 {data?.total ?? 0} 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg">
                上一页
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg">
                下一页
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 编辑器弹窗：传 key 强制 POI 切换时重建组件（根因 2 修复） */}
      {showEditor && (
        <POIEditor
          key={editorPoi ? `poi-${editorPoi.id}` : 'new'}
          poi={editorPoi}
          themes={themes}
          onSave={handleSave}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {/* 区域核定确认 */}
      {confirmArea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmArea(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-100 mb-3">区域核定</h3>
            <p className="text-sm text-slate-300">
              确认「<span className="text-cyan-300">{confirmArea.name}</span>」(#{confirmArea.id}) 的区域/半径无误，标记为已确认？
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setConfirmArea(null)} disabled={saving}
                className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg">取消</button>
              <button onClick={() => handleConfirmArea(confirmArea)} disabled={saving}
                className="px-4 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm rounded-lg">
                {saving ? '确认中…' : '确认核定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-100 mb-3">确认删除</h3>
            <p className="text-sm text-slate-300">
              确定删除 POI「<span className="text-cyan-300">{confirmDelete.name}</span>」(#{confirmDelete.id}) 吗？
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setConfirmDelete(null)} disabled={saving}
                className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg">取消</button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={saving}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded-lg">
                {saving ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POI 用时排行 */}
      {lbPOI && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setLbPOI(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-100">「{lbPOI.name}」用时排行</h3>
              <button onClick={() => setLbPOI(null)} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
            </div>

            <div className="flex gap-3 mb-3 items-center">
              <div>
                <label className="block text-xs text-slate-400 mb-1">专题</label>
                <select
                  value={lbCollId ?? ''}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setLbCollId(v)
                    if (v) loadPOILeaderboard(v, lbDifficulty)
                  }}
                  className="px-3 py-1.5 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-cyan-400 min-w-40"
                >
                  {lbPOI.collections.length === 0 && <option value="">未加入专题</option>}
                  {lbPOI.collections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">难度</label>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setLbDifficulty('easy'); if (lbCollId) loadPOILeaderboard(lbCollId, 'easy') }}
                    className={`px-3 py-1.5 text-xs rounded-lg font-bold transition-colors ${
                      lbDifficulty === 'easy'
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >点选</button>
                  <button
                    onClick={() => { setLbDifficulty('hard'); if (lbCollId) loadPOILeaderboard(lbCollId, 'hard') }}
                    className={`px-3 py-1.5 text-xs rounded-lg font-bold transition-colors ${
                      lbDifficulty === 'hard'
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >巡航</button>
                </div>
              </div>
            </div>

            {lbLoading ? (
              <p className="text-sm text-slate-400 py-4 text-center">加载中…</p>
            ) : lbRows.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">
                {lbCollId ? '暂无排行数据' : '请先选择专题'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-700">
                      <th className="py-2 pr-2 font-medium w-8">#</th>
                      <th className="py-2 px-2 font-medium">用户</th>
                      <th className="py-2 px-2 font-medium">POI用时</th>
                      <th className="py-2 px-2 font-medium">专题总用时</th>
                      <th className="py-2 px-2 font-medium">日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lbRows.map((r) => (
                      <tr key={r.user_id} className="border-b border-slate-700/50">
                        <td className="py-2 pr-2 text-slate-500 font-mono">{r.rank}</td>
                        <td className="py-2 px-2 text-slate-200">{r.nickname}</td>
                        <td className="py-2 px-2 text-slate-300 font-mono">{r.poi_time_sec}s</td>
                        <td className="py-2 px-2 text-slate-400 font-mono">{r.total_time_sec}s</td>
                        <td className="py-2 px-2 text-slate-400 text-xs">{r.earned_at ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

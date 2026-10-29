import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '../../api/admin'
import type { AdminCollection, CollectionInput, CollectionLeaderRow } from '../../types/admin'
import CollectionPoisEditor from './CollectionPoisEditor'

interface Props {
  onAuthError: () => void
}

const PAGE_SIZE = 20

const EMPTY_FORM: CollectionInput = {
  code: '',
  name: '',
  description: '',
  icon: '',
  cover_url: '',
  geometry: '',
  difficulty_star: 1,
  unlock_require: 0,
  audit_status: 'pending',
  sort_order: 0,
  enabled: true,
}

export default function CollectionManager({ onAuthError }: Props) {
  const [items, setItems] = useState<AdminCollection[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [star, setStar] = useState<number | ''>('')
  const [auditFilter, setAuditFilter] = useState('')
  const [sortBy, setSortBy] = useState('code')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AdminCollection | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CollectionInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<AdminCollection | null>(null)
  const [poisEditing, setPoisEditing] = useState<AdminCollection | null>(null)
  const [quickUpdating, setQuickUpdating] = useState<Record<number, boolean>>({})
  const [lbView, setLbView] = useState<AdminCollection | null>(null)
  const [lbDifficulty, setLbDifficulty] = useState<'easy' | 'hard'>('easy')
  const [lbRows, setLbRows] = useState<CollectionLeaderRow[]>([])
  const [lbLoading, setLbLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    adminApi
      .listCollections({ keyword: keyword || undefined, star: star || undefined, audit_status: auditFilter || undefined, sort_by: sortBy, sort_order: sortOrder, page, page_size: PAGE_SIZE })
      .then((res) => {
        setItems(res.items)
        setTotal(res.total)
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [keyword, star, auditFilter, sortBy, sortOrder, page, onAuthError])

  const changeSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((order) => order === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
    setPage(1)
  }

  const sortArrow = (field: string) => (
    <span
      aria-hidden="true"
      className="ml-1 text-sm font-bold leading-none text-cyan-300"
    >
      {sortBy === field ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}
    </span>
  )

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setShowForm(true)
  }

  const openEdit = (c: AdminCollection) => {
    setEditing(c)
    setForm({
      code: c.code,
      name: c.name,
      description: c.description ?? '',
      icon: c.icon ?? '',
      cover_url: c.cover_url ?? '',
      geometry: c.geometry ?? '',
      difficulty_star: c.difficulty_star,
      unlock_require: c.unlock_require,
      audit_status: c.audit_status,
      sort_order: c.sort_order,
      enabled: c.enabled,
    })
    setFormError('')
    setShowForm(true)
  }

  const handleSave = () => {
    if (!form.code.trim() || !form.name.trim()) {
      setFormError('code 和 name 必填')
      return
    }
    setSaving(true)
    setFormError('')
    const payload: CollectionInput = {
      ...form,
      code: form.code.trim(),
      name: form.name.trim(),
      difficulty_star: Number(form.difficulty_star) || 1,
      unlock_require: Number(form.unlock_require) || 0,
      sort_order: Number(form.sort_order) || 0,
    }
    const action = editing
      ? adminApi.updateCollection(editing.id, payload)
      : adminApi.createCollection(payload)
    action
      .then(() => {
        setShowForm(false)
        load()
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setFormError(e.message)
      })
      .finally(() => setSaving(false))
  }

  const handleDelete = (c: AdminCollection) => {
    setSaving(true)
    adminApi
      .deleteCollection(c.id)
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

  // 快速更新单个字段（星级、审核状态、启用）
  const quickUpdate = (c: AdminCollection, field: string, value: unknown) => {
    setQuickUpdating((prev) => ({ ...prev, [c.id]: true }))
    const payload: CollectionInput = {
      code: c.code,
      name: c.name,
      description: c.description ?? '',
      icon: c.icon ?? '',
      cover_url: c.cover_url ?? '',
      geometry: c.geometry ?? '',
      difficulty_star: c.difficulty_star,
      unlock_require: c.unlock_require,
      audit_status: c.audit_status,
      sort_order: c.sort_order,
      enabled: c.enabled,
      [field]: value,
    }
    adminApi
      .updateCollection(c.id, payload)
      .then(() => load())
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setQuickUpdating((prev) => ({ ...prev, [c.id]: false })))
  }

  const openLeaderboard = (c: AdminCollection, difficulty: 'easy' | 'hard') => {
    setLbView(c)
    setLbDifficulty(difficulty)
    setLbRows([])
    setLbLoading(true)
    adminApi
      .getCollectionLeaderboard(c.id, difficulty)
      .then(setLbRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLbLoading(false))
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-slate-100">专题管理</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
            {loading ? '刷新中…' : '↻ 刷新'}
          </button>
          <button onClick={openCreate}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg">
            + 新增专题
          </button>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
          placeholder="按名称/code 搜索"
          className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 w-64 outline-none focus:border-cyan-400"
        />
        <select
          value={star}
          onChange={(e) => { setStar(e.target.value === '' ? '' : Number(e.target.value)); setPage(1) }}
          className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-cyan-400"
        >
          <option value="">全部星级</option>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
            <option key={s} value={s}>{'★'.repeat(s)}</option>
          ))}
        </select>
        <select
          value={auditFilter}
          onChange={(e) => { setAuditFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-cyan-400"
        >
          <option value="">全部审核</option>
          <option value="pending">待审核</option>
          <option value="approved">已审核</option>
        </select>
      </div>

      {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 bg-slate-800 border-b border-slate-700">
                <th className="py-2.5 px-3 font-medium">
                  <button type="button" onClick={() => changeSort('code')} title="按 code 排序">code{sortArrow('code')}</button>
                </th>
                <th className="py-2.5 px-3 font-medium">
                  <button type="button" onClick={() => changeSort('name')} title="按名称排序">名称{sortArrow('name')}</button>
                </th>
                <th className="py-2.5 px-3 font-medium">
                  <button type="button" onClick={() => changeSort('difficulty_star')} title="按星级排序">星级{sortArrow('difficulty_star')}</button>
                </th>
                <th className="py-2.5 px-3 font-medium">
                  <button type="button" onClick={() => changeSort('audit_status')} title="按审核状态排序">审核{sortArrow('audit_status')}</button>
                </th>
                <th className="py-2.5 px-3 font-medium">
                  <button type="button" onClick={() => changeSort('point_count')} title="按点位数量排序">点位{sortArrow('point_count')}</button>
                </th>
                <th className="py-2.5 px-3 font-medium">
                  <button type="button" onClick={() => changeSort('medal_count')} title="按勋章数量排序">勋章{sortArrow('medal_count')}</button>
                </th>
                <th className="py-2.5 px-3 font-medium">
                  <button type="button" onClick={() => changeSort('enabled')} title="按启用状态排序">启用{sortArrow('enabled')}</button>
                </th>
                <th className="py-2.5 px-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="py-6 text-center text-slate-400">加载中…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-slate-500">暂无数据</td></tr>
              )}
              {!loading && items.map((c) => (
                <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="py-2 px-3 text-cyan-300 font-mono">{c.code}</td>
                  <td className="py-2 px-3 text-slate-200">{c.name}</td>
                  <td className="py-2 px-3">
                    <select value={c.difficulty_star}
                      disabled={quickUpdating[c.id]}
                      onChange={(e) => quickUpdate(c, 'difficulty_star', Number(e.target.value))}
                      className="bg-slate-900 border border-slate-600 rounded text-amber-400 text-xs px-1 py-0.5 outline-none focus:border-cyan-500 disabled:opacity-50">
                      {[1,2,3,4,5,6,7,8].map((s) => (
                        <option key={s} value={s} className="text-amber-400">{'★'.repeat(s)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3">
                    <select value={c.audit_status}
                      disabled={quickUpdating[c.id]}
                      onChange={(e) => quickUpdate(c, 'audit_status', e.target.value)}
                      className="bg-slate-900 border border-slate-600 rounded text-xs px-1 py-0.5 outline-none focus:border-cyan-500 disabled:opacity-50">
                      <option value="pending" className="text-yellow-400">待审核</option>
                      <option value="approved" className="text-green-400">已审核</option>
                    </select>
                  </td>
                  <td className="py-2 px-3 text-slate-300">{c.point_count}</td>
                  <td className="py-2 px-3 text-slate-300">{c.medal_count}</td>
                  <td className="py-2 px-3">
                    <label className="inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={c.enabled}
                        disabled={quickUpdating[c.id]}
                        onChange={(e) => quickUpdate(c, 'enabled', e.target.checked)}
                        className="sr-only peer" />
                      <div className="relative w-9 h-5 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500" />
                    </label>
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex gap-2">
                      <button onClick={() => openLeaderboard(c, 'easy')}
                        className="text-xs px-2 py-1 bg-amber-700/70 hover:bg-amber-600 text-white rounded">排行</button>
                      <button onClick={() => setPoisEditing(c)}
                        className="text-xs px-2 py-1 bg-cyan-700/70 hover:bg-cyan-600 text-white rounded">点位</button>
                      <button onClick={() => openEdit(c)}
                        className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded">编辑</button>
                      <button onClick={() => setConfirmDelete(c)}
                        className="text-xs px-2 py-1 bg-red-600/80 hover:bg-red-500 text-white rounded">删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>共 {total} 个专题</span>
        <div className="flex gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded">上一页</button>
          <span className="py-1">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded">下一页</button>
        </div>
      </div>

      {showForm && (
        <Modal title={editing ? '编辑专题' : '新增专题'} onClose={() => setShowForm(false)}>
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="code">
              <input type="text" value={form.code}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="input" />
            </FormRow>
            <FormRow label="名称">
              <input type="text" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input" />
            </FormRow>
            <FormRow label="星级 (1-8)">
              <input type="number" min={1} max={8} value={form.difficulty_star}
                onChange={(e) => setForm({ ...form, difficulty_star: Number(e.target.value) })}
                className="input" />
            </FormRow>
            <FormRow label="解锁要求 (完成前一星级数)">
              <input type="number" min={0} value={form.unlock_require}
                onChange={(e) => setForm({ ...form, unlock_require: Number(e.target.value) })}
                className="input" />
            </FormRow>
            <FormRow label="审核状态">
              <select value={form.audit_status}
                onChange={(e) => setForm({ ...form, audit_status: e.target.value })}
                className="input">
                <option value="pending">待审核</option>
                <option value="approved">已审核</option>
              </select>
            </FormRow>
            <FormRow label="排序">
              <input type="number" value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className="input" />
            </FormRow>
            <FormRow label="图标 (emoji)">
              <input type="text" value={form.icon ?? ''}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                className="input" />
            </FormRow>
            <FormRow label="封面 url">
              <input type="text" value={form.cover_url ?? ''}
                onChange={(e) => setForm({ ...form, cover_url: e.target.value })}
                className="input" />
            </FormRow>
            <FormRow label="几何标识" full>
              <input type="text" value={form.geometry ?? ''}
                onChange={(e) => setForm({ ...form, geometry: e.target.value })}
                className="input" />
            </FormRow>
            <FormRow label="描述" full>
              <textarea value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="input" />
            </FormRow>
            <FormRow label="启用" full>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                启用该专题
              </label>
            </FormRow>
          </div>
          {formError && (
            <div className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{formError}</div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg">取消</button>
            <button type="submit" disabled={saving}
              className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm rounded-lg">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
          </form>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="确认删除" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-300">
            确定删除专题「<span className="text-cyan-300">{confirmDelete.name}</span>」
            (code: {confirmDelete.code}) 吗？将同时删除其 {confirmDelete.point_count} 个点位关联和 {confirmDelete.medal_count} 枚勋章。
          </p>
          {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setConfirmDelete(null)}
              className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg">取消</button>
            <button onClick={() => handleDelete(confirmDelete)} disabled={saving}
              className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded-lg">
              {saving ? '删除中…' : '确认删除'}
            </button>
          </div>
        </Modal>
      )}

      {poisEditing && (
        <CollectionPoisEditor
          collectionId={poisEditing.id}
          collectionName={poisEditing.name}
          onClose={() => setPoisEditing(null)}
          onSaved={() => {
            setPoisEditing(null)
            load()
          }}
          onAuthError={onAuthError}
        />
      )}

      {lbView && (
        <Modal title={`「${lbView.name}」用时排行`} onClose={() => setLbView(null)}>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => openLeaderboard(lbView, 'easy')}
              className={`px-3 py-1 text-xs rounded-lg font-bold transition-colors ${
                lbDifficulty === 'easy'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >点选</button>
            <button
              onClick={() => openLeaderboard(lbView, 'hard')}
              className={`px-3 py-1 text-xs rounded-lg font-bold transition-colors ${
                lbDifficulty === 'hard'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >巡航</button>
          </div>
          {lbLoading ? (
            <p className="text-sm text-slate-400 py-4 text-center">加载中…</p>
          ) : lbRows.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">暂无排行数据</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="py-2 pr-2 font-medium w-8">#</th>
                    <th className="py-2 px-2 font-medium">用户</th>
                    <th className="py-2 px-2 font-medium">用时</th>
                    <th className="py-2 px-2 font-medium">来源</th>
                    <th className="py-2 px-2 font-medium">日期</th>
                  </tr>
                </thead>
                <tbody>
                  {lbRows.map((r) => (
                    <tr key={r.user_id} className="border-b border-slate-700/50">
                      <td className="py-2 pr-2 text-slate-500 font-mono">{r.rank}</td>
                      <td className="py-2 px-2 text-slate-200">{r.nickname}</td>
                      <td className="py-2 px-2 text-slate-300 font-mono">{r.total_time_sec}s</td>
                      <td className="py-2 px-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          r.game_type === 'pk' ? 'bg-rose-500/20 text-rose-300' : 'bg-cyan-500/20 text-cyan-300'
                        }`}>{r.game_type.toUpperCase()}</span>
                      </td>
                      <td className="py-2 px-2 text-slate-400 text-xs">{r.earned_at ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

function FormRow({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

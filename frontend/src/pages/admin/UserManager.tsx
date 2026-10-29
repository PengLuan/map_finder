import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '../../api/admin'
import type { AdminUser, UserMedalItem } from '../../types/admin'

interface Props {
  onAuthError: () => void
}

const PAGE_SIZE = 20

export default function UserManager({ onAuthError }: Props) {
  const [items, setItems] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [form, setForm] = useState({ nickname: '', is_admin: false, total_medals: 0 })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null)
  const [medalView, setMedalView] = useState<AdminUser | null>(null)
  const [medalItems, setMedalItems] = useState<UserMedalItem[]>([])
  const [medalLoading, setMedalLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    adminApi
      .listUsers({ keyword: keyword || undefined, page, page_size: PAGE_SIZE })
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
  }, [keyword, page, onAuthError])

  useEffect(() => {
    load()
  }, [load])

  const openEdit = (u: AdminUser) => {
    setEditing(u)
    setForm({
      nickname: u.nickname,
      is_admin: u.is_admin,
      total_medals: u.total_medals,
    })
    setFormError('')
  }

  const handleSave = () => {
    if (!form.nickname.trim()) {
      setFormError('昵称不能为空')
      return
    }
    setSaving(true)
    setFormError('')
    adminApi
      .updateUser(editing!.id, {
        nickname: form.nickname.trim(),
        is_admin: form.is_admin,
        total_medals: Number(form.total_medals) || 0,
      })
      .then(() => {
        setEditing(null)
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

  const handleDelete = (u: AdminUser) => {
    setSaving(true)
    adminApi
      .deleteUser(u.id)
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

  const openMedal = (u: AdminUser) => {
    setMedalView(u)
    setMedalItems([])
    setMedalLoading(true)
    adminApi
      .getUserMedals(u.id)
      .then(setMedalItems)
      .catch((e: Error) => setError(e.message))
      .finally(() => setMedalLoading(false))
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fmtDate = (iso: string | null) => {
    if (!iso) return '-'
    try { return new Date(iso).toLocaleString('zh-CN') } catch { return '-' }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">用户管理</h2>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
          {loading ? '刷新中…' : '↻ 刷新'}
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
          placeholder="按邮箱/昵称搜索"
          className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 w-64 outline-none focus:border-cyan-400"
        />
      </div>

      {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 bg-slate-800 border-b border-slate-700">
                <th className="py-2.5 px-3 font-medium">ID</th>
                <th className="py-2.5 px-3 font-medium">邮箱</th>
                <th className="py-2.5 px-3 font-medium">昵称</th>
                <th className="py-2.5 px-3 font-medium">勋章数</th>
                <th className="py-2.5 px-3 font-medium">管理员</th>
                <th className="py-2.5 px-3 font-medium">最后登录</th>
                <th className="py-2.5 px-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">加载中…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-500">暂无数据</td></tr>
              )}
              {!loading && items.map((u) => (
                <tr key={u.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="py-2 px-3 text-slate-400 font-mono">{u.id}</td>
                  <td className="py-2 px-3 text-slate-200">{u.email ?? '-'}</td>
                  <td className="py-2 px-3 text-slate-200">{u.nickname}</td>
                  <td className="py-2 px-3 text-amber-300">🎖 {u.total_medals}</td>
                  <td className="py-2 px-3">
                    {u.is_admin
                      ? <span className="text-cyan-400">是</span>
                      : <span className="text-slate-500">否</span>}
                  </td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{fmtDate(u.last_login_at)}</td>
                  <td className="py-2 px-3">
                    <div className="flex gap-2">
                      <button onClick={() => openMedal(u)}
                        className="text-xs px-2 py-1 bg-amber-700/70 hover:bg-amber-600 text-white rounded">勋章</button>
                      <button onClick={() => openEdit(u)}
                        className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded">编辑</button>
                      <button onClick={() => setConfirmDelete(u)}
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
        <span>共 {total} 个用户</span>
        <div className="flex gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded">上一页</button>
          <span className="py-1">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded">下一页</button>
        </div>
      </div>

      {editing && (
        <Modal title={`编辑用户 #${editing.id}`} onClose={() => setEditing(null)}>
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">邮箱</label>
              <div className="text-sm text-slate-300">{editing.email ?? '-'}</div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">昵称</label>
              <input type="text" value={form.nickname}
                onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                className="input" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">勋章数</label>
              <input type="number" min={0} value={form.total_medals}
                onChange={(e) => setForm({ ...form, total_medals: Number(e.target.value) })}
                className="input" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={form.is_admin}
                onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} />
              设为管理员
            </label>
          </div>
          {formError && (
            <div className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{formError}</div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setEditing(null)}
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
            确定删除用户「<span className="text-cyan-300">{confirmDelete.nickname}</span>」
            ({confirmDelete.email ?? confirmDelete.id}) 吗？其勋章记录将一并删除。
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

      {medalView && (
        <Modal title={`${medalView.nickname} 的勋章列表`} onClose={() => setMedalView(null)}>
          {medalLoading ? (
            <p className="text-sm text-slate-400 py-4 text-center">加载中…</p>
          ) : medalItems.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">暂无勋章</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="py-2 pr-2 font-medium">专题</th>
                    <th className="py-2 px-2 font-medium">勋章</th>
                    <th className="py-2 px-2 font-medium">模式</th>
                    <th className="py-2 px-2 font-medium">用时</th>
                    <th className="py-2 px-2 font-medium">获得时间</th>
                  </tr>
                </thead>
                <tbody>
                  {medalItems.map((m, i) => (
                    <tr key={i} className="border-b border-slate-700/50">
                      <td className="py-2 pr-2 text-slate-200">{m.collection_name}</td>
                      <td className="py-2 px-2 text-amber-300">{m.medal_name}</td>
                      <td className="py-2 px-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          m.difficulty === 'easy' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {m.difficulty === 'easy' ? '点选' : '巡航'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-slate-300 font-mono">{m.total_time_sec}s</td>
                      <td className="py-2 px-2 text-slate-400 text-xs">{m.earned_at ?? '-'}</td>
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

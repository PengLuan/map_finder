import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '../../api/admin'
import type { AdminTheme, ThemeInput } from '../../types/admin'

interface Props {
  onAuthError: () => void
}

const EMPTY_FORM: ThemeInput = {
  code: '',
  name: '',
  description: '',
  icon: '',
  cover_url: '',
  group_name: '',
  sort_order: 0,
  enabled: true,
}

export default function Themes({ onAuthError }: Props) {
  const [list, setList] = useState<AdminTheme[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AdminTheme | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ThemeInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<AdminTheme | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    adminApi
      .listThemes(true)
      .then(setList)
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

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setShowForm(true)
  }

  const openEdit = (t: AdminTheme) => {
    setEditing(t)
    setForm({
      code: t.code,
      name: t.name,
      description: t.description ?? '',
      icon: t.icon ?? '',
      cover_url: t.cover_url ?? '',
      group_name: t.group_name ?? '',
      sort_order: t.sort_order,
      enabled: t.enabled,
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
    const payload: ThemeInput = {
      ...form,
      code: form.code.trim(),
      name: form.name.trim(),
      sort_order: Number(form.sort_order) || 0,
    }
    const action = editing
      ? adminApi.updateTheme(editing.code, payload)
      : adminApi.createTheme(payload)
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

  const handleDelete = (t: AdminTheme) => {
    setSaving(true)
    adminApi
      .deleteTheme(t.code)
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

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">主题管理</h2>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
            {loading ? '刷新中…' : '↻ 刷新'}
          </button>
          <button onClick={openCreate}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg">
            + 新增主题
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 bg-slate-800 border-b border-slate-700">
                <th className="py-2.5 px-3 font-medium">code</th>
                <th className="py-2.5 px-3 font-medium">名称</th>
                <th className="py-2.5 px-3 font-medium">分组</th>
                <th className="py-2.5 px-3 font-medium">排序</th>
                <th className="py-2.5 px-3 font-medium">启用</th>
                <th className="py-2.5 px-3 font-medium">POI数</th>
                <th className="py-2.5 px-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">加载中…</td></tr>
              )}
              {!loading && list.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-500">暂无数据</td></tr>
              )}
              {!loading && list.map((t) => (
                <tr key={t.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="py-2 px-3 text-cyan-300 font-mono">{t.code}</td>
                  <td className="py-2 px-3 text-slate-200">{t.name}</td>
                  <td className="py-2 px-3 text-slate-300">{t.group_name ?? '-'}</td>
                  <td className="py-2 px-3 text-slate-300">{t.sort_order}</td>
                  <td className="py-2 px-3">
                    {t.enabled
                      ? <span className="text-green-400">✓</span>
                      : <span className="text-slate-500">✗</span>}
                  </td>
                  <td className="py-2 px-3 text-slate-300">{t.poi_count}</td>
                  <td className="py-2 px-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(t)}
                        className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded">编辑</button>
                      <button onClick={() => setConfirmDelete(t)}
                        className="text-xs px-2 py-1 bg-red-600/80 hover:bg-red-500 text-white rounded">删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      {showForm && (
        <Modal title={editing ? '编辑主题' : '新增主题'} onClose={() => setShowForm(false)}>
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
            <FormRow label="分组">
              <input type="text" value={form.group_name ?? ''}
                onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                className="input" />
            </FormRow>
            <FormRow label="排序">
              <input type="number" value={form.sort_order ?? 0}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className="input" />
            </FormRow>
            <FormRow label="图标 (emoji/url)">
              <input type="text" value={form.icon ?? ''}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                className="input" />
            </FormRow>
            <FormRow label="封面 url">
              <input type="text" value={form.cover_url ?? ''}
                onChange={(e) => setForm({ ...form, cover_url: e.target.value })}
                className="input" />
            </FormRow>
            <FormRow label="描述" full>
              <textarea value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="input" />
            </FormRow>
            <FormRow label="启用">
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={form.enabled ?? true}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                启用该主题
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

      {/* 删除确认 */}
      {confirmDelete && (
        <Modal title="确认删除" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-300">
            确定删除主题「<span className="text-cyan-300">{confirmDelete.name}</span>
            」(code: {confirmDelete.code}) 吗？该主题下有 {confirmDelete.poi_count} 个 POI。
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

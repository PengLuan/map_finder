/**
 * DevPlans — 后台开发计划管理（第三期）
 * 计划 CRUD（保存即用户可见）+ 各计划评价查看（含已撤回存档）+ 删除违规评价
 */
import { useState, useEffect, useCallback } from 'react'
import { adminApi, type DevPlanAdminItem, type DevPlanFeedbackAdminItem, type DevPlanInput } from '../../api/admin'

interface Props {
  onAuthError: () => void
}

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  planning: { text: '计划中', cls: 'bg-cyan-500/20 text-cyan-300' },
  done: { text: '已上线', cls: 'bg-green-500/20 text-green-300' },
  abandoned: { text: '已放弃', cls: 'bg-slate-500/20 text-slate-400' },
}

const EMPTY_FORM: DevPlanInput = { title: '', content: '', status: 'planning', sort_order: 0 }

export default function DevPlans({ onAuthError }: Props) {
  const [items, setItems] = useState<DevPlanAdminItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  // 表单（新建/编辑）
  const [editing, setEditing] = useState<DevPlanAdminItem | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  // 评价查看
  const [fbPlan, setFbPlan] = useState<DevPlanAdminItem | null>(null)
  const [feedbacks, setFeedbacks] = useState<DevPlanFeedbackAdminItem[]>([])
  const [fbLoading, setFbLoading] = useState(false)

  const load = useCallback(async (p = 1) => {
    try {
      const res = await adminApi.listDevPlans(p)
      setItems(res.items)
      setTotal(res.total)
      setPage(p)
    } catch (e: any) {
      if (e.message.includes('登录')) onAuthError()
      else setError(e.message)
    }
  }, [onAuthError])

  useEffect(() => { load(1) }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }
  const openEdit = (item: DevPlanAdminItem) => {
    setEditing(item)
    setForm({ title: item.title, content: item.content, status: item.status, sort_order: item.sort_order })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setError('标题和内容不能为空')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editing) await adminApi.updateDevPlan(editing.id, form)
      else await adminApi.createDevPlan(form)
      setShowForm(false)
      load(page)
    } catch (e: any) {
      setError(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDeletePlan = async (item: DevPlanAdminItem) => {
    if (!window.confirm(`确认删除「${item.title}」？其下所有评价将一并删除。`)) return
    try {
      await adminApi.deleteDevPlan(item.id)
      load(page)
    } catch (e: any) {
      setError(e.message || '删除失败')
    }
  }

  const openFeedbacks = async (item: DevPlanAdminItem) => {
    setFbPlan(item)
    setFbLoading(true)
    try {
      const res = await adminApi.listDevPlanFeedbacks(item.id)
      setFeedbacks(res.items)
    } catch (e: any) {
      setError(e.message || '加载评价失败')
    } finally {
      setFbLoading(false)
    }
  }

  const handleDeleteFeedback = async (fb: DevPlanFeedbackAdminItem) => {
    if (!window.confirm('确认删除该评价？（物理删除，不可恢复）')) return
    try {
      await adminApi.deleteDevPlanFeedback(fb.id)
      setFeedbacks((prev) => prev.filter((f) => f.id !== fb.id))
      load(page) // 刷新计数
    } catch (e: any) {
      setError(e.message || '删除失败')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">开发计划</h2>
          <p className="text-xs text-slate-400 mt-0.5">保存即对用户可见 · 用户可评价（👍/👎）· 共 {total} 条</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium"
        >
          + 新建计划
        </button>
      </div>

      {error && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {/* 编辑/新建表单 */}
      {showForm && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100">{editing ? `编辑 #${editing.id}` : '新建计划'}</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white text-lg">×</button>
          </div>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={128}
            placeholder="计划标题（如：热点专题「小寻带你看新闻」）"
            className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={5}
            placeholder="计划内容，支持换行"
            className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
          />
          <div className="flex items-center gap-3">
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}
              className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="planning">计划中</option>
              <option value="done">已上线</option>
              <option value="abandoned">已放弃</option>
            </select>
            <label className="text-xs text-slate-400">排序权重</label>
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
              className="w-24 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
            />
            <span className="text-[10px] text-slate-500">越大越靠前</span>
            <button
              onClick={handleSave}
              disabled={saving}
              className="ml-auto px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
            >
              {saving ? '保存中…' : '保存（立即对用户可见）'}
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {items === null ? (
        <div className="text-center text-sm text-slate-500 py-10">加载中…</div>
      ) : items.length === 0 ? (
        <div className="text-center text-sm text-slate-500 py-10">暂无开发计划</div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.planning
            return (
              <div key={item.id} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-bold text-cyan-300">#{item.id}</span>
                    <span className="text-sm text-slate-100 font-medium">{item.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${badge.cls}`}>{badge.text}</span>
                    <span className="text-xs text-slate-400">👍 {item.like_count} · 👎 {item.dislike_count} · 评价 {item.feedback_total ?? 0}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openFeedbacks(item)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg">
                      查看评价
                    </button>
                    <button onClick={() => openEdit(item)} className="px-3 py-1.5 text-xs bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 rounded-lg">
                      编辑
                    </button>
                    <button onClick={() => handleDeletePlan(item)} className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg">
                      删除
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2 whitespace-pre-wrap break-words line-clamp-2">{item.content}</p>
                <div className="text-[10px] text-slate-500 mt-1">创建于 {item.created_at} · 排序 {item.sort_order}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* 分页 */}
      {total > 50 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => load(page - 1)}
            disabled={page <= 1}
            className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg"
          >
            上一页
          </button>
          <span className="text-xs text-slate-400">{page} / {Math.ceil(total / 50)}</span>
          <button
            onClick={() => load(page + 1)}
            disabled={page >= Math.ceil(total / 50)}
            className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg"
          >
            下一页
          </button>
        </div>
      )}

      {/* 评价查看弹窗 */}
      {fbPlan && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6" onClick={() => setFbPlan(null)}>
          <div className="bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-slate-800 flex items-center justify-between px-5 py-4 border-b border-slate-700 rounded-t-2xl">
              <h3 className="text-sm font-bold text-slate-100">「{fbPlan.title}」的用户评价</h3>
              <button onClick={() => setFbPlan(null)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="p-4 space-y-2.5">
              {fbLoading ? (
                <div className="text-center text-sm text-slate-500 py-8">加载中…</div>
              ) : feedbacks.length === 0 ? (
                <div className="text-center text-sm text-slate-500 py-8">暂无评价</div>
              ) : (
                feedbacks.map((fb) => (
                  <div key={fb.id} className={`bg-slate-900/60 border rounded-xl p-3 ${
                    fb.withdrawn ? 'border-slate-700/40 opacity-70' : 'border-slate-700/60'
                  }`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-200 font-medium">{fb.nickname || '路人'}</span>
                        <span className="text-xs">{fb.attitude === 'like' ? '👍' : '👎'}</span>
                        {fb.withdrawn && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-600/40 text-slate-400">
                            已撤回{fb.withdrawn_at ? ` · ${fb.withdrawn_at}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500">{fb.created_at}</span>
                        <button
                          onClick={() => handleDeleteFeedback(fb)}
                          className="text-[10px] text-red-400 hover:text-red-300 underline"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    {fb.comment && (
                      <div className="text-xs text-slate-300 mt-1.5 whitespace-pre-wrap break-words">{fb.comment}</div>
                    )}
                    {fb.images.length > 0 && (
                      <div className="flex gap-1.5 mt-2">
                        {fb.images.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt="" className="w-14 h-14 object-cover rounded border border-slate-700" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

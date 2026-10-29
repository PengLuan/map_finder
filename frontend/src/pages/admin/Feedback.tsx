import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '../../api/admin'
import type { FeedbackItem } from '../../types/admin'

interface Props {
  onAuthError: () => void
}

export default function Feedback({ onAuthError }: Props) {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sort, setSort] = useState<'desc' | 'asc'>('desc')
  const [replied, setReplied] = useState<'' | 'yes' | 'no'>('')
  const [previewImg, setPreviewImg] = useState<string | null>(null)
  const [replyingId, setReplyingId] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySaving, setReplySaving] = useState(false)
  const pageSize = 20

  const load = useCallback(async (p: number, s: string, st: 'desc' | 'asc', rp: '' | 'yes' | 'no') => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApi.listFeedback(p, pageSize, s, st, rp)
      setItems(res.items)
      setTotal(res.total)
      setPage(p)
    } catch (e: any) {
      if (e.message?.includes('未登录')) onAuthError()
      else setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [onAuthError])

  useEffect(() => { load(1, '', 'desc', '') }, [load])

  const handleSearch = () => {
    setSearch(searchInput)
    load(1, searchInput, sort, replied)
  }

  const handleSortChange = (st: 'desc' | 'asc') => {
    setSort(st)
    load(1, search, st, replied)
  }

  const handleRepliedChange = (rp: '' | 'yes' | 'no') => {
    setReplied(rp)
    load(1, search, sort, rp)
  }

  const openReply = useCallback((fb: FeedbackItem) => {
    setReplyingId(fb.id)
    setReplyText(fb.admin_reply || '')
  }, [])

  const cancelReply = useCallback(() => {
    setReplyingId(null)
    setReplyText('')
  }, [])

  const handleReplySave = useCallback(async (id: number) => {
    if (!replyText.trim()) {
      alert('回复内容不能为空')
      return
    }
    setReplySaving(true)
    try {
      await adminApi.replyFeedback(id, replyText.trim())
      setReplyingId(null)
      setReplyText('')
      load(page, search, sort, replied)
    } catch (e: any) {
      alert(e.message || '回复失败')
    } finally {
      setReplySaving(false)
    }
  }, [replyText, load, page, search, sort, replied])

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm('确定删除这条留言？')) return
    try {
      await adminApi.deleteFeedback(id)
      setItems((prev) => prev.filter((f) => f.id !== id))
      setTotal((prev) => prev - 1)
    } catch (e: any) {
      alert(e.message || '删除失败')
    }
  }, [])

  const totalPages = Math.ceil(total / pageSize) || 1

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold">📝 意见留言</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">共 {total} 条</span>
          <button onClick={() => load(page, search, sort, replied)} disabled={loading}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 rounded-lg">
            {loading ? '刷新中…' : '↻ 刷新'}
          </button>
        </div>
      </div>

      {/* 搜索 + 排序 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索内容/称呼/联系方式/IP…"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >搜索</button>
          {search && (
            <button
              onClick={() => { setSearchInput(''); setSearch(''); load(1, '', sort, replied) }}
              className="px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors"
            >清除</button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleRepliedChange('')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${replied === '' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >全部</button>
          <button
            onClick={() => handleRepliedChange('no')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${replied === 'no' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >未回复</button>
          <button
            onClick={() => handleRepliedChange('yes')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${replied === 'yes' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >已回复</button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleSortChange('desc')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${sort === 'desc' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >最新优先</button>
          <button
            onClick={() => handleSortChange('asc')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${sort === 'asc' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >最早优先</button>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">{error}</div>
      )}

      {/* 留言列表 */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">加载中…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-500">暂无留言</div>
      ) : (
        <div className="space-y-2">
          {items.map((fb) => (
            <div
              key={fb.id}
              className="flex gap-3 bg-slate-800/60 rounded-lg p-3 border border-slate-700 hover:border-slate-600 transition-colors"
            >
              {/* 左侧：缩略图 */}
              {fb.image_urls.length > 0 ? (
                <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-slate-600 cursor-pointer"
                  onClick={() => setPreviewImg(fb.image_urls[0])}
                >
                  <img src={fb.image_urls[0]} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-slate-700/40 flex items-center justify-center text-slate-500 text-xs">
                  无图
                </div>
              )}

              {/* 中间：内容 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-medium text-cyan-300">{fb.nickname || '匿名'}</span>
                  {fb.contact && (
                    <span className="text-xs text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded">{fb.contact}</span>
                  )}
                  <span className="text-xs text-slate-500">{fb.created_at}</span>
                  <span className="text-xs text-slate-600">IP: {fb.ip}</span>
                  {fb.admin_reply ? (
                    <span className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded">已回复</span>
                  ) : (
                    <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded">未回复</span>
                  )}
                </div>
                <p className="text-sm text-slate-200 line-clamp-2 whitespace-pre-wrap break-words">
                  {fb.content}
                </p>
                {fb.image_urls.length > 1 && (
                  <div className="flex gap-1 mt-1">
                    {fb.image_urls.slice(1).map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt=""
                        className="w-10 h-10 object-cover rounded border border-slate-600 cursor-pointer hover:opacity-80"
                        onClick={() => setPreviewImg(url)}
                      />
                    ))}
                  </div>
                )}
                {/* 已有回复展示 */}
                {fb.admin_reply && replyingId !== fb.id && (
                  <div className="mt-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2">
                    <div className="text-xs text-cyan-400 font-medium mb-0.5">官方回复 · {fb.replied_at}</div>
                    <div className="text-sm text-cyan-100 whitespace-pre-wrap break-words">{fb.admin_reply}</div>
                  </div>
                )}
                {/* 回复编辑框 */}
                {replyingId === fb.id && (
                  <div className="mt-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder="输入回复内容（将展示给用户）"
                      className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-slate-500">{replyText.length}/500</span>
                      <div className="flex gap-2">
                        <button
                          onClick={cancelReply}
                          className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
                        >取消</button>
                        <button
                          onClick={() => handleReplySave(fb.id)}
                          disabled={replySaving || !replyText.trim()}
                          className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                        >{replySaving ? '保存中…' : '保存回复'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 右侧：操作 */}
              <div className="flex-shrink-0 flex flex-col items-end gap-1">
                <button
                  onClick={() => openReply(fb)}
                  className="text-xs text-slate-400 hover:text-cyan-400 px-2 py-1 rounded hover:bg-cyan-500/10 transition-colors"
                >{fb.admin_reply ? '修改回复' : '回复'}</button>
                <button
                  onClick={() => handleDelete(fb.id)}
                  className="text-xs text-slate-400 hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                >删除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => load(page - 1, search, sort, replied)}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg transition-colors"
          >上一页</button>
          <span className="text-sm text-slate-400">{page} / {totalPages}</span>
          <button
            onClick={() => load(page + 1, search, sort, replied)}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg transition-colors"
          >下一页</button>
        </div>
      )}

      {/* 图片预览 */}
      {previewImg && (
        <div
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImg(null)}
        >
          <img src={previewImg} alt="预览" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  )
}

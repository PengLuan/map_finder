/**
 * AuthModal — 邮箱验证码登录弹窗
 * 流程：输入邮箱 → 发送验证码 → 输入验证码 →（新用户）昵称沿用/输入 → 登录成功
 * 昵称冲突时显示推荐昵称列表（§7.3.2）
 */
import { useState, useCallback, useEffect } from 'react'
import { authApi, setToken, setStoredUser, type CollectionUser } from '../api/collection'
import { getSessionId } from '../api'

interface Props {
  onClose: () => void
  onSuccess?: (user: CollectionUser) => void
  /** 引导文案（如"绑定邮箱领取勋章"） */
  hint?: string
}

type Stage = 'email' | 'code' | 'nickname' | 'done'

export default function AuthModal({ onClose, onSuccess, hint }: Props) {
  const [stage, setStage] = useState<Stage>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [user, setUser] = useState<CollectionUser | null>(null)
  const [testCode, setTestCode] = useState('')

  // 验证码发送倒计时
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  // 1. 发送验证码
  const handleSendCode = useCallback(async () => {
    setError('')
    if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('请输入正确的邮箱')
      return
    }
    setSending(true)
    try {
      const res = await authApi.sendCode(email.trim())
      setTestCode((res as any).code || '')
      setStage('code')
      setCountdown(60)
    } catch (e: any) {
      setError(e.message || '验证码发送失败')
    } finally {
      setSending(false)
    }
  }, [email])

  // 2. 校验验证码并登录
  const handleLogin = useCallback(async () => {
    setError('')
    if (!code.trim()) {
      setError('请输入验证码')
      return
    }
    setLoading(true)
    try {
      const res = await authApi.login(email.trim(), code.trim(), undefined, getSessionId())
      // 老用户：直接登录成功
      setToken(res.token)
      setStoredUser(res.user)
      setUser(res.user)
      setStage('done')
      onSuccess?.(res.user)
    } catch (e: any) {
      // 新用户需要设置昵称：后端在未提供 nickname 且无历史时已自动生成，
      // 但此处仍提供昵称沿用/自定义入口（若后端返回 401 提示需要昵称）
      const msg = e.message || ''
      if (msg.includes('昵称')) {
        setStage('nickname')
      } else {
        setError(msg || '登录失败')
      }
    } finally {
      setLoading(false)
    }
  }, [email, code, onSuccess])

  // 3. 校验昵称可用性
  const checkAndSubmitNickname = useCallback(async (name: string) => {
    setError('')
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请输入昵称')
      return false
    }
    try {
      const res = await authApi.checkNickname(trimmed, trimmed)
      if (!res.available) {
        setSuggestions(res.suggestions || [])
        setError('该昵称已被占用，试试这些？')
        return false
      }
      return true
    } catch (e: any) {
      setError(e.message || '校验失败')
      return false
    }
  }, [])

  const handleNicknameSubmit = useCallback(async () => {
    const ok = await checkAndSubmitNickname(nickname)
    if (!ok) return
    setLoading(true)
    setError('')
    try {
      // 重新调用登录，带上昵称（验证码已消耗，后端测试模式可重复；生产可能需重新发送）
      const res = await authApi.login(email.trim(), code.trim(), nickname.trim(), getSessionId())
      setToken(res.token)
      setStoredUser(res.user)
      setUser(res.user)
      setStage('done')
      onSuccess?.(res.user)
    } catch (e: any) {
      const msg = e.message || ''
      if (msg.includes('昵称') || msg.includes('占用')) {
        setSuggestions((await authApi.checkNickname(nickname.trim(), nickname.trim()).catch(() => ({} as any))).suggestions || [])
      }
      setError(msg || '注册失败')
    } finally {
      setLoading(false)
    }
  }, [nickname, checkAndSubmitNickname, email, code, onSuccess])

  if (stage === 'done' && user) {
    return (
      <ModalShell onClose={onClose}>
        <div className="text-center py-6">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="text-xl font-bold text-cyan-300 mb-1">登录成功</h2>
          <p className="text-slate-400 text-sm">欢迎，{user.nickname}</p>
          <button
            onClick={onClose}
            className="mt-6 w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-sm font-bold text-white"
          >
            完成
          </button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="mb-4 text-center">
        <h2 className="text-xl font-bold text-cyan-300">邮箱登录</h2>
        {hint && <p className="text-xs text-amber-300 mt-1">{hint}</p>}
        {!hint && <p className="text-xs text-slate-400 mt-1">绑定邮箱后勋章永久保留、可上排行榜</p>}
      </div>

      {stage === 'email' && (
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="请输入邮箱"
            className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-600 rounded-xl text-white text-sm focus:border-cyan-400 outline-none"
            autoFocus
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={handleSendCode}
            disabled={sending}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-sm font-bold text-white disabled:opacity-60"
          >
            {sending ? '发送中...' : '发送验证码'}
          </button>
        </div>
      )}

      {stage === 'code' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">验证码已发送至 <span className="text-cyan-300">{email}</span></p>
          {testCode && (
            <p className="text-xs text-amber-400 bg-slate-900/60 rounded-lg px-3 py-2 text-center">
              测试模式验证码：<span className="font-mono text-lg tracking-widest">{testCode}</span>
            </p>
          )}
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6 位验证码"
            className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-600 rounded-xl text-white text-center text-lg tracking-widest focus:border-cyan-400 outline-none"
            autoFocus
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading || code.length !== 6}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-sm font-bold text-white disabled:opacity-60"
          >
            {loading ? '登录中...' : '登录 / 注册'}
          </button>
          <button
            onClick={handleSendCode}
            disabled={countdown > 0}
            className="w-full py-2 text-xs text-slate-400 hover:text-cyan-300 disabled:opacity-50"
          >
            {countdown > 0 ? `${countdown}s 后可重新发送` : '重新发送验证码'}
          </button>
        </div>
      )}

      {stage === 'nickname' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">设置你的昵称（全局唯一，大小写敏感）</p>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="2-16 个字符"
            maxLength={16}
            className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-600 rounded-xl text-white text-sm focus:border-cyan-400 outline-none"
            autoFocus
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => { setNickname(s); setSuggestions([]); setError('') }}
                  className="px-3 py-1 bg-slate-700 hover:bg-cyan-600/40 border border-slate-600 rounded-full text-xs text-cyan-200"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={handleNicknameSubmit}
            disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-sm font-bold text-white disabled:opacity-60"
          >
            {loading ? '提交中...' : '确认昵称'}
          </button>
        </div>
      )}
    </ModalShell>
  )
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[3000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-slate-800/95 rounded-2xl shadow-2xl border border-slate-700 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

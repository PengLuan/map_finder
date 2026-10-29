import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { Region } from '../types'
import ThemeSelector from '../components/ThemeSelector'
import ProvinceSelector from '../components/ProvinceSelector'
import GameRecordsModal from '../components/GameRecordsModal'
import FeedbackModal from '../components/FeedbackModal'
import DevPlansModal from '../components/DevPlansModal'
import AuthModal from '../components/AuthModal'
import ProfileModal from '../components/ProfileModal'
import { isLoggedIn, getStoredUser, collectionApi } from '../api/collection'
import type { MedalWallItem } from '../api/collection'

const DropIcon = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24">
    <path d="M12 1.6C7.4 1.6 3.7 5.3 3.7 9.9c0 5.6 8.3 12.5 8.3 12.5s8.3-6.9 8.3-12.5c0-4.6-3.7-8.3-8.3-8.3z" fill="#e63946" stroke="#ffffff" strokeWidth={1.5} />
    <circle cx="12" cy="9.5" r="3" fill="none" stroke="#ffffff" strokeWidth={2} />
  </svg>
)

interface Props {
  onStart: (
    mode: string,
    regionCode: string | undefined,
    difficulty: string,
    category?: string
  ) => void
  onPK: (
    mode: string,
    regionCode: string | undefined,
    difficulty: string,
    category?: string
  ) => void
  onCollection: () => void
  onNews: () => void
  onMedalWall: () => void
  onTracks: () => void
  onLeaderboard: () => void
}

const MODES: { key: string; name: string; icon: ReactNode; desc: string }[] = [
  {
    key: 'national',
    name: '自由模式',
    icon: '🌏',
    desc: '在全国范围内寻找目标',
  },
  {
    key: 'provincial',
    name: '省市挑战',
    icon: <DropIcon className="w-10 h-10 mx-auto" />,
    desc: '选择省份，缩小搜索范围',
  },
  {
    key: 'theme',
    name: '主题模式',
    icon: '🎯',
    desc: '选择一个主题进行挑战',
  },
  {
    key: 'collection',
    name: '专题模式',
    icon: '🗺️',
    desc: '100 个专题等你收集',
  },
]

export default function Home({ onStart, onPK, onCollection, onNews, onMedalWall, onTracks, onLeaderboard }: Props) {
  const [selectedMode, setSelectedMode] = useState<string | null>(null)
  const [provinces, setProvinces] = useState<Region[]>([])
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null)
  const [difficulty, setDifficulty] = useState<'easy' | 'hard'>('hard')
  const [theme, setTheme] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showRecords, setShowRecords] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showDevPlans, setShowDevPlans] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [authTick, setAuthTick] = useState(0)
  const [liveMedalCount, setLiveMedalCount] = useState<number | null>(null)

  const loggedIn = isLoggedIn()
  const currentUser = getStoredUser()
  const medalCount = loggedIn ? (liveMedalCount ?? currentUser?.total_medals ?? 0) : 0

  useEffect(() => {
    // 登录态变化时刷新已获勋章数
    api.getRegions(1).then(setProvinces).catch(console.error)
  }, [authTick])

  // 从后端实时拉取勋章数（合并 solo/pk 后计数），确保与勋章墙一致
  useEffect(() => {
    if (!isLoggedIn()) { setLiveMedalCount(null); return }
    collectionApi.medalWall()
      .then((res) => {
        // 合并同专题+难度的 solo/pk 勋章：二者达成其一即算已获得
        const merged = new Map<string, MedalWallItem>()
        for (const g of res.data) {
          for (const m of g.medals) {
            const key = `${m.collection_id}-${m.difficulty}`
            const existing = merged.get(key)
            if (!existing) {
              merged.set(key, { ...m })
            } else if (m.earned) {
              existing.earned = true
            }
          }
        }
        setLiveMedalCount(Array.from(merged.values()).filter((m) => m.earned).length)
      })
      .catch(() => setLiveMedalCount(null))
  }, [authTick])

  const handleStart = () => {
    if (selectedMode === 'collection') {
      onCollection()
      return
    }
    if (selectedMode === 'theme') {
      if (!theme) return
      // 主题挑战：固定全国模式
      onStart('national', undefined, difficulty, theme)
    } else if (selectedMode === 'national') {
      onStart('national', undefined, difficulty)
    } else if (selectedMode === 'provincial' && selectedProvince) {
      onStart('provincial', selectedProvince, difficulty)
    }
  }

  const handlePK = () => {
    if (selectedMode === 'theme' && theme) {
      onPK('national', undefined, difficulty, theme)
    } else if (selectedMode === 'provincial' && selectedProvince) {
      onPK('provincial', selectedProvince, difficulty)
    } else {
      onPK('national', undefined, difficulty)
    }
  }

  const canStart =
    selectedMode === 'national' ||
    (selectedMode === 'provincial' && !!selectedProvince) ||
    (selectedMode === 'theme' && !!theme)

  // 难度选择（两个界面复用）
  const difficultyBlock = (
    <div className="mb-6">
      <label className="block text-sm text-slate-400 mb-2">选择难度</label>
      <div className="flex gap-2">
        <button
          onClick={() => setDifficulty('easy')}
          className={`flex-1 p-2.5 rounded-lg border-2 transition-all text-sm font-bold ${
            difficulty === 'easy'
              ? 'border-emerald-400 bg-slate-700/80 text-emerald-300 shadow-lg shadow-emerald-500/20'
              : 'border-slate-600 bg-slate-800/60 text-slate-400 hover:border-slate-500'
          }`}
        >
          🌱 点选
          <span className="block text-[10px] font-normal mt-0.5 opacity-70">5次机会 · 150秒 · 更多提示</span>
        </button>
        <button
          onClick={() => setDifficulty('hard')}
          className={`flex-1 p-2.5 rounded-lg border-2 transition-all text-sm font-bold ${
            difficulty === 'hard'
              ? 'border-orange-400 bg-slate-700/80 text-orange-300 shadow-lg shadow-orange-500/20'
              : 'border-slate-600 bg-slate-800/60 text-slate-400 hover:border-slate-500'
          }`}
        >
          🔥 巡航
          <span className="block text-[10px] font-normal mt-0.5 opacity-70">3次机会 · 300秒 · 更少提示</span>
        </button>
      </div>
    </div>
  )

  // ===== 第二界面：主题模式 =====
  if (selectedMode === 'theme') {
    return (
      <div className="h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        {/* 顶部：返回 + 标题（固定） */}
        <div className="shrink-0 p-4 pb-0">
          <div className="max-w-5xl mx-auto">
            <button
              onClick={() => setSelectedMode(null)}
              className="mb-3 text-sm text-slate-400 hover:text-cyan-300 transition-colors"
            >
              ← 返回模式选择
            </button>
            <div className="text-center mb-4">
              <h1 className="font-hud text-2xl md:text-3xl text-cyan-400 glow-cyan">🎯 主题模式</h1>
              <p className="text-slate-400 mt-1 text-sm">选择一个主题，在全国该主题的目标中挑战</p>
            </div>
          </div>
        </div>

        {/* 中部：主题选择（可滚动） */}
        <div className="flex-1 overflow-y-auto p-4 pb-2 min-h-0">
          <div className="max-w-5xl mx-auto">
            <label className="block text-sm text-slate-400 mb-2">选择主题</label>
            <ThemeSelector value={theme} onChange={setTheme} />
          </div>
        </div>

        {/* 底部：难度 + 开始游戏 + 好友对战（固定常驻） */}
        <div className="shrink-0 p-4 pt-3 bg-slate-900/90 backdrop-blur border-t border-slate-700/60">
          <div className="max-w-5xl mx-auto">
            <div className="mb-4">{difficultyBlock}</div>
            <button
              onClick={handleStart}
              disabled={!canStart || loading}
              className={`w-full py-3 rounded-xl font-hud text-lg tracking-widest transition-all mb-3 ${
                canStart && !loading
                  ? 'btn-primary text-slate-900'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              {loading ? '正在出发...' : theme ? '开始游戏' : '请先选择主题'}
            </button>
            <button
              onClick={handlePK}
              className="w-full py-3 rounded-xl font-hud text-lg tracking-widest border-2 border-amber-500/60 text-amber-400 hover:bg-amber-500/10 transition-all"
            >
              ⚔️ 好友对战
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ===== 第二界面：省市模式 =====
  if (selectedMode === 'provincial') {
    return (
      <div className="h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        {/* 顶部：返回 + 标题（固定） */}
        <div className="shrink-0 p-4 pb-0">
          <div className="max-w-5xl mx-auto">
            <button
              onClick={() => setSelectedMode(null)}
              className="mb-3 text-sm text-slate-400 hover:text-cyan-300 transition-colors"
            >
              ← 返回模式选择
            </button>
            <div className="text-center mb-4">
              <h1 className="font-hud text-2xl md:text-3xl text-cyan-400 glow-cyan flex items-center justify-center gap-2">
                <DropIcon className="w-8 h-8 inline-block" /> 省市挑战
              </h1>
              <p className="text-slate-400 mt-1 text-sm">选择一个省份，在该省范围内寻找目标</p>
            </div>
          </div>
        </div>

        {/* 中部：省份选择（可滚动） */}
        <div className="flex-1 overflow-y-auto p-4 pb-2 min-h-0">
          <div className="max-w-5xl mx-auto">
            <label className="block text-sm text-slate-400 mb-2">选择省份</label>
            <ProvinceSelector
              provinces={provinces}
              value={selectedProvince}
              onChange={setSelectedProvince}
            />
          </div>
        </div>

        {/* 底部：难度 + 开始游戏 + 好友对战（固定常驻） */}
        <div className="shrink-0 p-4 pt-3 bg-slate-900/90 backdrop-blur border-t border-slate-700/60">
          <div className="max-w-5xl mx-auto">
            <div className="mb-4">{difficultyBlock}</div>
            <button
              onClick={handleStart}
              disabled={!canStart || loading}
              className={`w-full py-3 rounded-xl font-hud text-lg tracking-widest transition-all mb-3 ${
                canStart && !loading
                  ? 'btn-primary text-slate-900'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              {loading ? '正在出发...' : selectedProvince ? '开始游戏' : '请先选择省份'}
            </button>
            <button
              onClick={handlePK}
              className="w-full py-3 rounded-xl font-hud text-lg tracking-widest border-2 border-amber-500/60 text-amber-400 hover:bg-amber-500/10 transition-all"
            >
              ⚔️ 好友对战
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ===== 第一界面：模式选择 =====
  return (
    <div className="relative h-full overflow-y-auto flex flex-col items-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
      {/* 右上角登录（FE-02） */}
      <button
        onClick={() => (loggedIn ? setShowProfile(true) : setShowAuth(true))}
        className={`absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${
          loggedIn
            ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
            : 'border-slate-600 bg-slate-800/70 text-slate-400 hover:border-slate-500 hover:text-slate-200'
        }`}
      >
        {loggedIn ? (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="max-w-[7rem] truncate">{currentUser?.nickname}</span>
          </>
        ) : (
          <>
            <span className="text-base leading-none">👤</span>
            <span>登录</span>
          </>
        )}
      </button>

      <div className="max-w-2xl w-full my-auto">
        <div className="text-center mb-8">
          <img
            src="/logo.jpg"
            alt="地图寻踪"
            className="w-28 h-28 md:w-32 md:h-32 mx-auto rounded-3xl shadow-xl shadow-cyan-500/20 mb-3"
          />
          <p className="text-slate-400 mt-2">探索中国，寻找隐藏的目标</p>
        </div>

        {/* 模式选择（PC 端 2×2，移动端纵向堆叠） */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {MODES.map((m) => {
            const isCollection = m.key === 'collection'
            return (
              <button
                key={m.key}
                onClick={() => (isCollection ? onCollection() : setSelectedMode(m.key))}
                className={`relative p-4 rounded-xl border-2 text-center transition-all ${
                  selectedMode === m.key
                    ? 'border-cyan-400 bg-slate-700/80 shadow-lg shadow-cyan-500/20'
                    : 'border-slate-600 bg-slate-800/60 hover:border-slate-500'
                }`}
              >
                <div className="text-3xl mb-2">{m.icon}</div>
                <div className="font-bold text-white">{m.name}</div>
                <div className="text-xs text-slate-400 mt-1">{m.desc}</div>
                {isCollection && loggedIn && (
                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs">
                    🎖 {medalCount} 勋章
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* 新闻栏目入口（醒目按钮） */}
        <button
          onClick={onNews}
          className="w-full py-2.5 mt-3 rounded-xl bg-gradient-to-r from-rose-600/20 to-amber-500/10 border border-rose-500/50 text-rose-200 hover:from-rose-600/30 hover:to-amber-500/20 transition-all flex items-center justify-center gap-2 font-medium"
        >
          <span className="text-lg">📰</span>
          <span>小寻带你看新闻</span>
          <span className="text-xs text-rose-300/70">沿时间线找事件发生地</span>
        </button>

        {/* 难度选择 */}
        {difficultyBlock}

        {/* 开始按钮 */}
        <button
          onClick={handleStart}
          disabled={!canStart || loading}
          className={`w-full py-3 rounded-xl font-hud text-lg tracking-widest transition-all mb-4 ${
            canStart && !loading
              ? 'btn-primary text-slate-900'
              : 'bg-slate-700 text-slate-500 cursor-not-allowed'
          }`}
        >
          {loading ? '正在出发...' : '开始游戏'}
        </button>

        {/* PK 入口 */}
        <button
          onClick={handlePK}
          className="w-full py-3 rounded-xl font-hud text-lg tracking-widest border-2 border-amber-500/60 text-amber-400 hover:bg-amber-500/10 transition-all"
        >
          ⚔️ 好友对战
        </button>

        {/* 专题相关入口：勋章墙 / 足迹 / 排行榜 */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <button
            onClick={onMedalWall}
            className="py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-cyan-300 transition-all text-xs font-medium"
          >
            🎖 我的勋章
          </button>
          <button
            onClick={onTracks}
            className="py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-cyan-300 transition-all text-xs font-medium"
          >
            🗺️ 我的足迹
          </button>
          <button
            onClick={onLeaderboard}
            className="py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-cyan-300 transition-all text-xs font-medium"
          >
            🏆 排行榜
          </button>
        </div>

        {/* 贡献地点入口（醒目按钮） */}
        <a
          href="#/contribute"
          className="w-full py-2.5 mt-3 rounded-xl bg-gradient-to-r from-cyan-600/20 to-cyan-500/10 border border-cyan-500/50 text-cyan-300 hover:from-cyan-600/30 hover:to-cyan-500/20 transition-all flex items-center justify-center gap-2 font-medium"
        >
          <span className="text-lg">✨</span>
          <span>贡献新地点</span>
          <span className="text-xs text-cyan-500/70">丰富题库，署名展示</span>
        </a>

        {/* 游戏记录入口 */}
        <button
          onClick={() => setShowRecords(true)}
          className="w-full py-2.5 mt-2 rounded-xl bg-slate-700/50 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-all flex items-center justify-center gap-2 font-medium text-sm"
        >
          <span>📜</span>
          <span>游戏记录</span>
          <span className="text-xs text-slate-500">最近 20 局</span>
        </button>
        {showRecords && <GameRecordsModal onClose={() => setShowRecords(false)} />}

        {/* 意见留言 + 开发计划（一行两个） */}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            onClick={() => setShowFeedback(true)}
            className="py-2.5 rounded-xl bg-slate-700/50 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-all flex flex-col items-center justify-center gap-0.5 font-medium text-sm"
          >
            <span className="flex items-center gap-1.5">📝 意见留言</span>
            <span className="text-[10px] text-slate-500">建议/吐槽/反馈</span>
          </button>
          <button
            onClick={() => setShowDevPlans(true)}
            className="py-2.5 rounded-xl bg-slate-700/50 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-all flex flex-col items-center justify-center gap-0.5 font-medium text-sm"
          >
            <span className="flex items-center gap-1.5">🗺️ 开发计划</span>
            <span className="text-[10px] text-slate-500">等你来评价</span>
          </button>
        </div>
        {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
        {showDevPlans && <DevPlansModal onClose={() => setShowDevPlans(false)} />}

        {/* 感谢图寻 */}
        <p className="mt-4 text-center text-xs text-slate-500">
          特别感谢{' '}
          <a
            href="https://tuxun.fun/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-cyan-400 transition-colors"
          >图寻</a>
        </p>

        {/* 备案信息 */}
        <div className="mt-2 pt-4 border-t border-slate-800 text-center text-xs text-slate-500 space-y-1">
          <p>作者微信：taijunisme</p>
          <p>南京市江宁区算悟人工智能技术研发工作室（个体工商户）</p>
          <a
            href="https://beian.miit.gov.cn"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-cyan-400 transition-colors"
          >苏ICP备2026021945号</a>
        </div>
      </div>

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => { setShowAuth(false); setAuthTick((t) => t + 1) }}
        />
      )}
      {showProfile && currentUser && (
        <ProfileModal
          user={currentUser}
          onClose={() => setShowProfile(false)}
          onUpdated={() => { setShowProfile(false); setAuthTick((t) => t + 1) }}
        />
      )}
    </div>
  )
}

import { useState, useCallback, useEffect, useRef } from 'react'
import Home from './pages/Home'
import Game from './pages/Game'
import PKHome from './pages/PKHome'
import PKRoom from './pages/PKRoom'
import PKGame from './pages/PKGame'
import Contribute from './pages/Contribute'
import CollectionList from './pages/CollectionList'
import CollectionDetail from './pages/CollectionDetail'
import Collection from './pages/Collection'
import MedalWall from './pages/MedalWall'
import Leaderboard from './pages/Leaderboard'
import Tracks from './pages/Tracks'
import UserProfile from './pages/UserProfile'
import NewsList from './pages/NewsList'
import NewsTimeline from './pages/NewsTimeline'
import AdminApp from './pages/admin/AdminApp'
import AudioToggle from './components/AudioToggle'
import { pkApi, isLoggedIn } from './api/pk'

type View = 'home' | 'game' | 'pk-home' | 'pk-room' | 'pk-game' | 'admin' | 'contribute'
  | 'collection-list' | 'collection-detail' | 'collection-game' | 'medal-wall' | 'leaderboard' | 'tracks'
  | 'user-profile' | 'news-list' | 'news-game'

interface GameConfig {
  mode: string
  regionCode?: string
  difficulty: string
  category?: string
}

interface PKRoomInfo {
  roomId: number
  roomCode: string
  isHost: boolean
}

export interface PendingInvite {
  code: string
  error?: string
}

export default function App() {
  const [view, setView] = useState<View>('home')
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null)
  const [pkRoom, setPkRoom] = useState<PKRoomInfo | null>(null)
  const [pkGameId, setPkGameId] = useState<number | null>(null)
  // 开局目标封面图（PKStartResponse.target_cover，房主开局时下发，传给 PKGame）
  const [pkStartCover, setPkStartCover] = useState<string | null | undefined>(undefined)
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null)
  const [pkConfig, setPkConfig] = useState<GameConfig | null>(null)
  // 专题模式：当前专题 code + 难度
  const [collectionCode, setCollectionCode] = useState<string | null>(null)
  const [collectionDifficulty, setCollectionDifficulty] = useState<string>('hard')
  // 新闻栏目：当前时间线 code
  const [newsCode, setNewsCode] = useState<string | null>(null)
  // POI 纠正：从结算面板/足迹跳入贡献页纠正模式
  const [correctPoiId, setCorrectPoiId] = useState<number | null>(null)
  // 用户公开主页：#/user/:id
  const [profileUserId, setProfileUserId] = useState<number | null>(null)
  // 离开主页时恢复的上一视图
  const prevViewRef = useRef<View>('home')
  // 防止 StrictMode 下 effect 双调用导致重复 joinRoom（第二次会报"房间已满"并被踢回大厅）
  const inviteHandledRef = useRef(false)

  // hash 路由：#/admin → 后台，#/contribute → 贡献页，#/user/:id → 用户公开主页
  useEffect(() => {
    const syncHash = () => {
      const h = window.location.hash.replace(/^#\/?/, '')
      if (h === 'admin') setView('admin')
      else if (h === 'contribute') setView('contribute')
      else if (h.startsWith('user/')) {
        const id = Number(h.slice(5))
        if (Number.isInteger(id) && id > 0) {
          setProfileUserId(id)
          setView((prev) => {
            if (prev !== 'user-profile') prevViewRef.current = prev
            return 'user-profile'
          })
        }
      }
    }
    syncHash()
    window.addEventListener('hashchange', syncHash)
    return () => window.removeEventListener('hashchange', syncHash)
  }, [])

  // URL 参数自动加入 PK 房间（邀请链接 ?pk=XXXX）或刷新后恢复活跃房间
  useEffect(() => {
    if (inviteHandledRef.current) return
    inviteHandledRef.current = true

    const params = new URLSearchParams(window.location.search)
    const pkCode = params.get('pk')

    // 优先处理邀请链接
    if (pkCode && pkCode.length === 4) {
      const code = pkCode.toUpperCase()
      window.history.replaceState({}, '', window.location.pathname)
      setPkConfig((prev) => prev ?? { mode: 'national', difficulty: 'hard' })

      if (isLoggedIn()) {
        pkApi
          .joinRoom(code)
          .then((res) => {
            setPkRoom({ roomId: res.room_id, roomCode: code, isHost: false })
            setView('pk-room')
          })
          .catch((e) => {
            setPendingInvite({ code, error: e.message })
            setView('pk-home')
          })
      } else {
        setPendingInvite({ code })
        setView('pk-home')
      }
      return
    }

    // 没有邀请链接：检查是否有活跃的房间/游戏（刷新恢复）
    if (!isLoggedIn()) return

    pkApi
      .getUserStatus()
      .then((status) => {
        if (!status.active_room_id) return
        return pkApi.getRoomStatus(status.active_room_id).then((room) => {
          setPkRoom({
            roomId: status.active_room_id!,
            roomCode: room.room_code,
            isHost: status.is_host,
          })
          setPkConfig({
            mode: room.mode,
            regionCode: room.region_code || undefined,
            difficulty: room.difficulty,
            category: room.category || undefined,
          })

          if (status.active_game_id && (room.status === 'playing' || room.status === 'finished')) {
            setPkGameId(status.active_game_id)
            setView('pk-game')
          } else if (room.status === 'finished') {
            setView('pk-home')
          } else {
            setView('pk-room')
          }
        })
      })
      .catch(() => {})
  }, [])

  const handleStart = useCallback(
    (mode: string, regionCode: string | undefined, difficulty: string, category?: string) => {
      setGameConfig({ mode, regionCode, difficulty, category })
      setView('game')
    },
    []
  )

  const handleBack = useCallback(() => {
    setView('home')
    setGameConfig(null)
  }, [])

  const handleEnterPKRoom = useCallback((roomId: number, roomCode: string, isHost: boolean) => {
    setPkRoom({ roomId, roomCode, isHost })
    setView('pk-room')
  }, [])

  const handleLeavePKRoom = useCallback(() => {
    setPkRoom(null)
    setPkGameId(null)
    setView('pk-home')
  }, [])

  const handleEnterPKGame = useCallback((gameId: number, startCover?: string | null) => {
    setPkGameId(gameId)
    setPkStartCover(startCover ?? null)
    setView('pk-game')
  }, [])

  const handlePKNewGame = useCallback((gameId: number) => {
    setPkGameId(gameId)
    setView('pk-room')
    setTimeout(() => setView('pk-game'), 0)
  }, [])

  // ===== 专题模式导航 =====
  const handleOpenCollection = useCallback(() => setView('collection-list'), [])
  const handleOpenCollectionDetail = useCallback((code: string) => {
    setCollectionCode(code)
    setView('collection-detail')
  }, [])
  const handleStartCollection = useCallback((code: string, difficulty: string) => {
    setCollectionCode(code)
    setCollectionDifficulty(difficulty)
    setView('collection-game')
  }, [])
  const handleCollectionBack = useCallback(() => {
    setCollectionCode(null)
    setView('home')
  }, [])
  const handleCollectionToList = useCallback(() => {
    setCollectionCode(null)
    setView('collection-list')
  }, [])
  const handleOpenMedalWall = useCallback(() => setView('medal-wall'), [])
  const handleOpenLeaderboard = useCallback(() => setView('leaderboard'), [])
  const handleOpenTracks = useCallback(() => setView('tracks'), [])

  // ===== 新闻栏目导航 =====
  const handleOpenNews = useCallback(() => setView('news-list'), [])
  const handleOpenNewsTimeline = useCallback((code: string) => {
    setNewsCode(code)
    setView('news-game')
  }, [])
  const handleNewsBack = useCallback(() => {
    setNewsCode(null)
    setView('home')
  }, [])
  const handleNewsToList = useCallback(() => {
    setNewsCode(null)
    setView('news-list')
  }, [])

  // POI 纠正入口：结算面板/足迹 popup 派发 open-correction 事件
  useEffect(() => {
    const handler = (e: Event) => {
      const poiId = (e as CustomEvent<{ poiId: number }>).detail?.poiId
      if (poiId == null) return
      setCorrectPoiId(poiId)
      setView('contribute')
    }
    window.addEventListener('open-correction', handler)
    return () => window.removeEventListener('open-correction', handler)
  }, [])

  return (
    <div className="h-screen w-screen overflow-hidden">
      {view !== 'admin' && view !== 'contribute' && <AudioToggle />}
      {view === 'admin' && <AdminApp onExit={() => { window.location.hash = ''; setView('home') }} />}
      {view === 'contribute' && (
        <Contribute
          correctionPoiId={correctPoiId}
          onBack={() => {
            window.location.hash = ''
            setCorrectPoiId(null)
            setView('home')
          }}
        />
      )}
      {view === 'home' && <Home
        onStart={handleStart}
        onPK={(mode, regionCode, difficulty, category) => {
          setPkConfig({ mode, regionCode, difficulty, category })
          setView('pk-home')
        }}
        onCollection={handleOpenCollection}
        onNews={handleOpenNews}
        onMedalWall={handleOpenMedalWall}
        onTracks={handleOpenTracks}
        onLeaderboard={handleOpenLeaderboard}
      />}
      {view === 'game' && gameConfig && (
        <Game
          mode={gameConfig.mode}
          regionCode={gameConfig.regionCode}
          difficulty={gameConfig.difficulty}
          category={gameConfig.category}
          onBack={handleBack}
        />
      )}
      {view === 'pk-home' && pkConfig && (
        <PKHome
          pkConfig={pkConfig}
          onBack={handleBack}
          onEnterRoom={handleEnterPKRoom}
          invite={pendingInvite}
          onConsumeInvite={() => setPendingInvite(null)}
        />
      )}
      {view === 'pk-room' && pkRoom && (
        <PKRoom
          roomId={pkRoom.roomId}
          roomCode={pkRoom.roomCode}
          isHost={pkRoom.isHost}
          onLeave={handleLeavePKRoom}
          onEnterGame={handleEnterPKGame}
        />
      )}
      {view === 'pk-game' && pkGameId && pkRoom && (
        <PKGame
          key={pkGameId}
          gameId={pkGameId}
          roomId={pkRoom.roomId}
          onLeave={handleLeavePKRoom}
          onNewGame={handlePKNewGame}
          startCover={pkStartCover ?? null}
        />
      )}
      {view === 'collection-list' && (
        <CollectionList
          onBack={handleCollectionBack}
          onOpen={handleOpenCollectionDetail}
        />
      )}
      {view === 'collection-detail' && collectionCode && (
        <CollectionDetail
          code={collectionCode}
          onBack={() => setView('collection-list')}
          onStart={handleStartCollection}
        />
      )}
      {view === 'collection-game' && collectionCode && (
        <Collection
          key={`${collectionCode}-${collectionDifficulty}`}
          code={collectionCode}
          difficulty={collectionDifficulty}
          onBack={handleCollectionToList}
          onStartDifficulty={(nextDifficulty) => handleStartCollection(collectionCode, nextDifficulty)}
        />
      )}
      {view === 'news-list' && (
        <NewsList onBack={handleNewsBack} onOpen={handleOpenNewsTimeline} />
      )}
      {view === 'news-game' && newsCode && (
        <NewsTimeline
          key={newsCode}
          code={newsCode}
          onBack={handleNewsToList}
        />
      )}
      {view === 'medal-wall' && (
        <MedalWall onBack={handleCollectionBack} />
      )}
      {view === 'leaderboard' && (
        <Leaderboard onBack={handleCollectionBack} />
      )}
      {view === 'tracks' && (
        <Tracks onBack={handleCollectionBack} />
      )}
      {view === 'user-profile' && profileUserId != null && (
        <UserProfile
          userId={profileUserId}
          onBack={() => {
            window.location.hash = ''
            setView(prevViewRef.current)
          }}
        />
      )}
    </div>
  )
}

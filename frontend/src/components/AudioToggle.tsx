import { useAudio } from '../hooks/useAudio'

/** 右上角音效开关（仅 SFX，无 BGM） */
export default function AudioToggle() {
  const { sfxOn, toggleSfx } = useAudio()
  return (
    <button
      onClick={toggleSfx}
      className="fixed top-2 right-2 z-[5000] w-7 h-7 flex items-center justify-center
                 bg-black/30 backdrop-blur-sm rounded-full text-xs opacity-60 hover:opacity-100 transition-opacity"
      title={sfxOn ? '关闭音效' : '开启音效'}
    >
      {sfxOn ? '🔔' : '🔕'}
    </button>
  )
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { audioManager } from '../utils/audio'

export function useAudio() {
  const [sfxOn, setSfxOn] = useState(() => audioManager.sfxEnabled)
  const initedRef = useRef(false)

  useEffect(() => {
    const onFirstInteract = () => {
      if (initedRef.current) return
      initedRef.current = true
      audioManager.init()
    }
    window.addEventListener('pointerdown', onFirstInteract, { once: true })
    window.addEventListener('keydown', onFirstInteract, { once: true })
    return () => {
      window.removeEventListener('pointerdown', onFirstInteract)
      window.removeEventListener('keydown', onFirstInteract)
    }
  }, [])

  const toggleSfx = useCallback(() => {
    audioManager.init()
    const next = !audioManager.sfxEnabled
    audioManager.setSfxEnabled(next)
    setSfxOn(next)
    if (next) audioManager.click()
  }, [])

  return { sfxOn, toggleSfx }
}

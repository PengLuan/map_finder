/**
 * Web Audio API SFX 音效管理器（无 BGM）
 * 适用于猜地图游戏：按钮点击、命中、未命中、胜负、倒计时
 */

class AudioManager {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private _sfxEnabled = true
  private _initialized = false

  init() {
    if (this._initialized) return
    this._initialized = true
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = 0.6
    this.masterGain.connect(this.ctx.destination)
  }

  get sfxEnabled() { return this._sfxEnabled }

  private playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.3, delay = 0) {
    if (!this.ctx || !this.masterGain || !this._sfxEnabled) return
    const t = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(volume, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t + duration)
    osc.connect(g)
    g.connect(this.masterGain)
    osc.start(t)
    osc.stop(t + duration)
  }

  private playSequence(notes: { freq: number; dur: number; type?: OscillatorType; vol?: number }[], interval = 0.08) {
    let elapsed = 0
    for (const n of notes) {
      this.playTone(n.freq, n.dur, n.type ?? 'sine', n.vol ?? 0.3, elapsed)
      elapsed += interval
    }
  }

  setSfxEnabled(enabled: boolean) {
    this._sfxEnabled = enabled
  }

  /** UI 按钮点击 */
  click() { this.playTone(800, 0.06, 'sine', 0.15) }

  /** 命中目标（简单模式点击命中 / 困难模式视野命中） */
  hit() {
    this.playSequence([
      { freq: 523.25, dur: 0.12, vol: 0.3 }, { freq: 659.25, dur: 0.12, vol: 0.3 },
      { freq: 783.99, dur: 0.12, vol: 0.3 }, { freq: 1046.50, dur: 0.3, vol: 0.35 },
    ])
  }

  /** 未命中（简单模式点击未命中） */
  miss() {
    this.playTone(400, 0.12, 'sine', 0.2)
    this.playTone(350, 0.15, 'sine', 0.15, 0.08)
  }

  /** PK 胜利 */
  win() {
    this.playSequence([
      { freq: 523.25, dur: 0.12, vol: 0.3 }, { freq: 659.25, dur: 0.12, vol: 0.3 },
      { freq: 783.99, dur: 0.12, vol: 0.3 }, { freq: 1046.50, dur: 0.15, vol: 0.35 },
      { freq: 783.99, dur: 0.1, vol: 0.25 }, { freq: 1046.50, dur: 0.3, vol: 0.35 },
    ])
  }

  /** PK 失败 */
  lose() {
    this.playSequence([
      { freq: 523.25, dur: 0.15, vol: 0.25, type: 'triangle' },
      { freq: 440.00, dur: 0.15, vol: 0.25, type: 'triangle' },
      { freq: 349.23, dur: 0.4, vol: 0.25, type: 'triangle' },
    ], 0.12)
  }

  /** PK 平局/超时 */
  draw() {
    this.playTone(523.25, 0.2, 'sine', 0.25)
    this.playTone(523.25, 0.2, 'sine', 0.25, 0.25)
  }

  /** 倒计时 10 秒 */
  countdown() { this.playTone(880, 0.15, 'square', 0.15) }

  /** 游戏开始 */
  gameStart() {
    this.playSequence([
      { freq: 392.00, dur: 0.1, vol: 0.25 },
      { freq: 523.25, dur: 0.1, vol: 0.25 },
      { freq: 659.25, dur: 0.1, vol: 0.25 },
      { freq: 783.99, dur: 0.25, vol: 0.3 },
    ])
  }
}

export const audioManager = new AudioManager()

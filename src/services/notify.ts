/**
 * Lightweight completion notifications driven by the `notifications` settings.
 *
 * `playCompletionSound` emits a short two-tone chime via the Web Audio API
 * (no bundled asset) and only when `notifications.soundEnabled` is on.
 */
import { configManager } from './config-manager'

export function playCompletionSound(): void {
  if (!configManager.getConfig().notifications.soundEnabled) return
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    const tones = [660, 880]
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.12
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.12)
    })
    setTimeout(() => { void ctx.close() }, 500)
  } catch {
    // Audio not available (e.g. autoplay restrictions) — silently ignore.
  }
}

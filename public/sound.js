// 効果音と BGM。Web Audio で鳴らすだけ（音声ファイルなし）。最初に画面を触るまで鳴らない（ブラウザの決まり）。
const KEY = 'sc-mute'
let ac = null, master = null, muted = false, bgm = null, bgmWant = null
try { muted = localStorage.getItem(KEY) === '1' } catch {}

function ensure() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    try { ac = new AC(); master = ac.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ac.destination) } catch { ac = null; return null }
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {})
  return ac
}
export function unlock() { if (ensure() && bgmWant && !bgm) startBgm(bgmWant) }
addEventListener('pointerdown', unlock, { passive: true })
addEventListener('keydown', unlock)

function tone(f, dur, { type = 'square', vol = 0.06, to = 0, at = 0, attack = 0.005 } = {}) {
  if (muted || !ac) return
  const t0 = ac.currentTime + at
  const o = ac.createOscillator(), g = ac.createGain()
  o.type = type; o.frequency.setValueAtTime(f, t0)
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.03)
}
function noise(dur, { vol = 0.12, freq = 900, type = 'lowpass', at = 0, sweep = 0 } = {}) {
  if (muted || !ac) return
  const len = Math.max(1, Math.floor(ac.sampleRate * dur))
  const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 1.6
  const s = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter()
  const t0 = ac.currentTime + at
  f.type = type; f.frequency.setValueAtTime(freq, t0); if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur)
  s.buffer = buf; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start(t0)
}

// ---- BGM: 航路ごとに音の並びと速さを変える（ベース・アルペジオ・ふわっとした和音）
const SONGS = {
  moon: { bpm: 104, root: 57, scale: [0, 2, 4, 7, 9], prog: [0, 5, 3, 4], arp: [0, 2, 4, 2, 1, 2, 3, 2] },
  belt: { bpm: 122, root: 55, scale: [0, 3, 5, 7, 10], prog: [0, 0, 5, 3], arp: [0, 1, 2, 4, 2, 1, 3, 1] },
  storm: { bpm: 132, root: 52, scale: [0, 1, 5, 7, 8], prog: [0, 1, 0, 5], arp: [0, 3, 1, 4, 0, 3, 2, 4] },
  hole: { bpm: 96, root: 50, scale: [0, 3, 5, 6, 10], prog: [0, 3, 1, 4], arp: [0, 2, 1, 3, 0, 4, 2, 1] },
  galaxy: { bpm: 116, root: 59, scale: [0, 2, 4, 7, 11], prog: [0, 4, 5, 3], arp: [0, 1, 2, 3, 4, 3, 2, 1] }
}
const mtof = m => 440 * 2 ** ((m - 69) / 12)
export function startBgm(theme) {
  bgmWant = theme
  if (bgm && bgm.theme === theme) return
  stopBgm(true)
  if (!ensure()) return
  const S = SONGS[theme] || SONGS.belt
  const step = 60 / S.bpm / 2
  let next = ac.currentTime + 0.1, i = 0
  const note = (deg, oct = 0) => S.root + S.scale[((deg % 5) + 5) % 5] + 12 * (Math.floor(deg / 5) + oct)
  const timer = setInterval(() => {
    if (!ac || muted) { next = ac ? ac.currentTime + 0.1 : 0; return }
    while (next < ac.currentTime + 0.25) {
      const bar = Math.floor(i / 8) % S.prog.length, k = i % 8
      const base = S.prog[bar]
      const at = next - ac.currentTime
      if (k === 0 || k === 4) tone(mtof(note(base, -2)), step * 3.4, { type: 'triangle', vol: 0.07, at, attack: 0.01 })
      if (k === 2 || k === 6) tone(mtof(note(base + 2, -2)), step * 1.2, { type: 'triangle', vol: 0.04, at })
      tone(mtof(note(base + S.arp[k], 1)), step * 0.9, { type: 'square', vol: 0.016, at })
      if (k === 0) for (const d of [0, 2, 4]) tone(mtof(note(base + d, 0)), step * 7.5, { type: 'sine', vol: 0.014, at, attack: 0.2 })
      if (k === 4) noise(0.05, { vol: 0.03, freq: 6000, type: 'highpass', at })
      next += step; i++
    }
  }, 60)
  bgm = { theme, timer }
}
export function stopBgm(keepWant) { if (bgm) { clearInterval(bgm.timer); bgm = null } if (!keepWant) bgmWant = null }

export const isMuted = () => muted
export function toggleMute() {
  muted = !muted
  try { localStorage.setItem(KEY, muted ? '1' : '0') } catch {}
  if (ensure()) master.gain.value = muted ? 0 : 0.55
  return muted
}

// ---- 効果音
export const sfx = {
  fail() { tone(880, 0.12, { vol: 0.05 }); tone(660, 0.12, { vol: 0.05, at: 0.13 }); tone(880, 0.12, { vol: 0.05, at: 0.26 }) },
  fixed() { tone(660, 0.08, { type: 'triangle', vol: 0.08 }); tone(990, 0.16, { type: 'triangle', vol: 0.08, at: 0.08 }) },
  hit() { noise(0.45, { vol: 0.3, freq: 1200, sweep: 120 }); tone(110, 0.35, { type: 'sine', vol: 0.18, to: 40 }) },
  fire() { tone(1500, 0.14, { type: 'sawtooth', vol: 0.03, to: 260 }) },
  boom() { noise(0.25, { vol: 0.16, freq: 2400, sweep: 300 }) },
  tap() { tone(380 + Math.random() * 120, 0.05, { type: 'square', vol: 0.025 }) },
  clank() { noise(0.05, { vol: 0.12, freq: 3000, type: 'bandpass' }); tone(820 + Math.random() * 200, 0.06, { type: 'square', vol: 0.02 }) },
  lever(lv) { tone(200 + lv * 90, 0.09, { type: 'sawtooth', vol: 0.04, to: 260 + lv * 120 }) },
  steer() { tone(300, 0.06, { type: 'triangle', vol: 0.05, to: 420 }) },
  vent() { noise(0.6, { vol: 0.14, freq: 4000, type: 'highpass', sweep: 900 }) },
  mark() { tone(1200, 0.06, { type: 'sine', vol: 0.06 }); tone(1600, 0.08, { type: 'sine', vol: 0.05, at: 0.06 }) },
  call() { tone(990, 0.06, { type: 'sine', vol: 0.07 }); tone(1320, 0.09, { type: 'sine', vol: 0.06, at: 0.07 }) },
  pod() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.07, at: i * 0.06 })) },
  gate() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.16, { type: 'square', vol: 0.035, at: i * 0.07 })) },
  warn() { for (let i = 0; i < 3; i++) { tone(520, 0.18, { type: 'sawtooth', vol: 0.04, to: 780, at: i * 0.32 }) } },
  meow() { tone(700, 0.28, { type: 'triangle', vol: 0.08, to: 1100 }); tone(1100, 0.3, { type: 'triangle', vol: 0.06, to: 600, at: 0.22 }) },
  shoo() { tone(500 + Math.random() * 300, 0.07, { type: 'triangle', vol: 0.05, to: 900 }) },
  go() { tone(180, 0.7, { type: 'sawtooth', vol: 0.05, to: 720 }); noise(0.7, { vol: 0.1, freq: 400, sweep: 2000 }) },
  count() { tone(880, 0.1, { type: 'square', vol: 0.04 }) },
  rumble() { noise(0.6, { vol: 0.09, freq: 160 }) },
  win() {
    const seq = [523, 659, 784, 1046, 784, 1046, 1318]
    seq.forEach((f, i) => tone(f, 0.22, { type: 'square', vol: 0.045, at: i * 0.11 }))
    seq.forEach((f, i) => tone(f / 2, 0.22, { type: 'triangle', vol: 0.06, at: i * 0.11 }))
  },
  // 負けは「ぽわわわーん」（悲しいトロンボーン）
  lose() { [392, 370, 349].forEach((f, i) => tone(f, 0.42, { type: 'sawtooth', vol: 0.05, at: i * 0.45, to: f * 0.97 })); tone(330, 1.1, { type: 'sawtooth', vol: 0.05, at: 1.35, to: 300 }) },
  explode() { noise(1.4, { vol: 0.4, freq: 1800, sweep: 60 }); tone(80, 1.2, { type: 'sine', vol: 0.25, to: 25 }) }
}

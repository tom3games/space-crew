// 宇宙船クルーの画面。担当ごとに操作盤（パネル）を出し分ける。
// render(state, { send }) は状態が届くたびに呼ばれる（毎秒15回）。動きは届いた状態の間を補間して滑らかに描く。
const $ = s => document.querySelector(s)

const ROLE_NAMES = { helm: '操縦', engine: 'エンジン', repair: '修理', nav: 'ナビ', defense: '防衛' }
const ROLE_ORDER = ['helm', 'nav', 'engine', 'defense', 'repair']
const ROLE_DESC = {
  helm: '左右のボタンで船の向きを変える。危険地帯はあなたには見えない。ナビの声と目印を頼りに進む',
  engine: '出力を4段で切り替える。全開は速いが熱がたまり、100で故障。冷却で熱を下げる',
  repair: '壊れた装置をタップ連打で直す。どれから直すかはあなたが決める',
  nav: '岩場と電磁嵐が地図で見えるのはあなただけ。タップで目印を置き、声で進路を伝える',
  defense: 'レーダーをタップした方向に撃つ。隕石を船に当てない。撃つとエネルギーを使う'
}
const SYSTEMS = ['helm', 'engine', 'radar', 'cannon', 'life']
const SYSTEM_NAMES = { helm: '操舵装置', engine: 'エンジン', radar: 'センサー', cannon: '砲台', life: '生命維持' }
const SYSTEM_EFFECT = { helm: '舵が効かず勝手に曲がる', engine: '速度が出ない', radar: 'ナビの地図が消える', cannon: '撃てない', life: '酸素が減る' }
const CALL_TEXT = { left: '左へ', right: '右へ', straight: 'まっすぐ', slow: '減速して', fast: '加速して', meteor: '隕石が来る', power: '電力が足りない', help: '手伝って' }
const ROLE_CALLS = {
  helm: ['slow', 'fast', 'meteor'],
  nav: ['left', 'straight', 'right', 'slow'],
  engine: ['power'],
  defense: ['meteor', 'power'],
  repair: []
}
const SPEED_MAX = 105
const TICK_MS = 1000 / 15

// ---- アイコン（自前のSVG）
const I = {
  helm: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM12 3v5M12 16v5M3 12h5M16 12h5"/>',
  engine: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-5"/><circle cx="12" cy="15" r="1.4"/>',
  repair: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5Z"/>',
  nav: '<path d="M12 2l3 7-3 13-3-13Z"/><circle cx="12" cy="12" r="10"/>',
  defense: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/>',
  radar: '<path d="M12 12L19 5"/><path d="M3.5 12a8.5 8.5 0 1 0 8.5-8.5"/><path d="M7.5 12A4.5 4.5 0 1 0 12 7.5"/>',
  cannon: '<path d="M4 18h10l2-4H6Z"/><path d="M11 14l8-8M17 4l3 3"/>',
  life: '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  soundOn: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  soundOff: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9Z"/>'
}
const icon = (k, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`

// ---- 音（WebAudio で作る。ファイルなし）
const snd = (() => {
  let ac = null, master = null, bgm = null
  let muted = false
  try { muted = localStorage.getItem('sc-mute') === '1' } catch {}
  function ensure() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)() } catch { return null }
      master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination)
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {})
    return ac
  }
  function tone(f, dur, { type = 'square', vol = 0.05, to = 0, at = 0 } = {}) {
    if (muted || !ensure()) return
    const t0 = ac.currentTime + at
    const o = ac.createOscillator(), g = ac.createGain()
    o.type = type; o.frequency.setValueAtTime(f, t0)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur)
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02)
  }
  function noise(dur, vol = 0.12) {
    if (muted || !ensure()) return
    const len = Math.floor(ac.sampleRate * dur)
    const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
    const s = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter()
    f.type = 'lowpass'; f.frequency.value = 900
    s.buffer = buf; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start()
  }
  function startBgm() {
    if (bgm || muted || !ensure()) return
    // 低いうなり（船の機関音）。ごく小さく
    const g = ac.createGain(); g.gain.value = 0.022
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 140
    lfo.connect(lg); lg.connect(f.frequency)
    const os = [55, 82.4, 110.6].map((fr, i) => { const o = ac.createOscillator(); o.type = i ? 'triangle' : 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(); return o })
    f.connect(g); g.connect(master); lfo.start()
    bgm = { os, lfo, g }
  }
  return {
    get muted() { return muted },
    toggle() {
      muted = !muted
      try { localStorage.setItem('sc-mute', muted ? '1' : '0') } catch {}
      if (ensure()) master.gain.value = muted ? 0 : 1
      if (!muted) startBgm()
    },
    unlock() { if (!muted) { ensure(); startBgm() } },
    fail() { tone(880, 0.12, { vol: 0.05 }); tone(660, 0.18, { vol: 0.05, at: 0.13 }) },
    fixed() { tone(520, 0.08, { type: 'triangle', vol: 0.07 }); tone(780, 0.14, { type: 'triangle', vol: 0.07, at: 0.08 }) },
    hit() { noise(0.35, 0.22); tone(90, 0.3, { type: 'sine', vol: 0.12, to: 40 }) },
    fire() { tone(1200, 0.12, { type: 'sawtooth', vol: 0.03, to: 300 }) },
    tap() { tone(300 + Math.random() * 80, 0.04, { type: 'square', vol: 0.025 }) },
    call() { tone(990, 0.06, { type: 'sine', vol: 0.06 }); tone(1320, 0.08, { type: 'sine', vol: 0.05, at: 0.07 }) },
    go() { tone(220, 0.5, { type: 'sawtooth', vol: 0.04, to: 660 }) },
    end(win) {
      const seq = win ? [523, 659, 784, 1046] : [392, 330, 262, 196]
      seq.forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.07, at: i * 0.14 }))
    }
  }
})()

// ---- 補間用の状態
let snaps = []           // { at, g }
let mapCache = null
let trail = []
let curRound = -1
let tab = null
let sendFn = () => {}
let last = null          // 最新の state.game
let seen = new Set()
let firstState = true
let shotFx = []          // 自分が撃った直後の線（届くまでの間の見た目）
let built = false
let steerHeld = 0
let lastPhase = null
let endPlayed = -1

function reset() {
  snaps = []; mapCache = null; trail = []; tab = null; seen = new Set(); firstState = true; shotFx = []; steerHeld = 0; lastPhase = null
}

// ---- 組み立て
function build() {
  const root = $('#stage')
  root.innerHTML = `
  <div class="sc" id="sc">
    <div class="sc-hud">
      <div class="meters">
        <div class="meter" data-k="hull"><span class="ml">船体</span><i><b></b></i><span class="mv"></span></div>
        <div class="meter" data-k="energy"><span class="ml">電力</span><i><b></b></i><span class="mv"></span></div>
        <div class="meter" data-k="o2"><span class="ml">酸素</span><i><b></b></i><span class="mv"></span></div>
      </div>
      <div class="hud-r">
        <div class="readout"><span>目的地まで</span><strong id="sc-dist">-</strong></div>
        <div class="readout"><span>残り</span><strong id="sc-time">-</strong></div>
        <div class="hud-btns" id="sc-hudBtns"><button class="icon-btn" id="sc-mute" aria-label="音"></button></div>
      </div>
    </div>
    <div class="sc-alerts" id="sc-alerts" aria-live="polite"></div>
    <div class="sc-feed" id="sc-feed" aria-live="polite"></div>
    <div class="sc-body" id="sc-body">
      <section class="pn pn-helm" data-role="helm">
        <div class="cvw"><canvas class="cv" id="cv-helm" aria-label="前方の景色"></canvas></div>
        <div class="ctl steer">
          <button class="steer-btn" data-dir="-1" aria-label="左に曲がる">${icon('left')}<span>左</span></button>
          <div class="steer-mid"><span class="muted">押す間だけ曲がる</span><span id="helm-state" class="tag"></span></div>
          <button class="steer-btn" data-dir="1" aria-label="右に曲がる"><span>右</span>${icon('right')}</button>
        </div>
      </section>
      <section class="pn pn-nav" data-role="nav">
        <div class="cvw"><canvas class="cv" id="cv-nav" aria-label="航路の地図。タップで目印"></canvas></div>
        <p class="pn-hint">地図をタップすると、操縦の画面に目印が出る</p>
      </section>
      <section class="pn pn-defense" data-role="defense">
        <div class="cvw"><canvas class="cv" id="cv-defense" aria-label="レーダー。タップした方向に撃つ"></canvas></div>
        <p class="pn-hint" id="def-hint">レーダーをタップした方向に撃つ</p>
      </section>
      <section class="pn pn-engine" data-role="engine">
        <div class="eng">
          <div class="lever" role="group" aria-label="出力">
            <button data-lv="3"><span>全開</span><small>速い / 熱い</small></button>
            <button data-lv="2"><span>巡航</span><small>ふつう</small></button>
            <button data-lv="1"><span>低速</span><small>冷える</small></button>
            <button data-lv="0"><span>停止</span><small>止まる</small></button>
          </div>
          <div class="eng-r">
            <div class="big-read"><span>速度</span><strong id="eng-speed">0</strong></div>
            <div class="gauge" id="eng-heat"><span class="gl">熱</span><div class="gbar"><b></b><i class="gmark"></i></div><span class="gv"></span></div>
            <div class="gauge" id="eng-energy"><span class="gl">電力</span><div class="gbar"><b></b></div><span class="gv"></span></div>
            <button class="vent" id="eng-vent"><span>冷却</span><small>電力12で熱を下げる</small></button>
            <p class="eng-msg" id="eng-msg"></p>
          </div>
        </div>
      </section>
      <section class="pn pn-repair" data-role="repair">
        <div class="tiles" id="rep-tiles">
          ${SYSTEMS.map((s, i) => `<button class="tile" data-sys="${s}">${icon(s === 'helm' ? 'helm' : s)}<span class="tn">${SYSTEM_NAMES[s]}</span><span class="ts"></span><span class="tbar"><b></b></span><span class="tk">${i + 1}</span></button>`).join('')}
        </div>
        <p class="pn-hint" id="rep-hint">壊れた装置を連打して直す</p>
      </section>
    </div>
    <div class="sc-calls" id="sc-calls"></div>
    <nav class="sc-tabs" id="sc-tabs"></nav>
    <div class="sc-brief" id="sc-brief" hidden>
      <p class="brief-k">あなたの担当</p>
      <div class="brief-roles" id="brief-roles"></div>
      <ul class="brief-crew" id="brief-crew"></ul>
      <p class="brief-count" id="brief-count"></p>
    </div>
  </div>`

  // 退出ボタンを上の帯に移す（一画面に収めるため）
  const q = $('#quitBtn'); if (q) $('#sc-hudBtns').append(q)
  const mute = $('#sc-mute')
  const paintMute = () => { mute.innerHTML = icon(snd.muted ? 'soundOff' : 'soundOn'); mute.setAttribute('aria-label', snd.muted ? '音を出す' : '音を消す') }
  paintMute()
  mute.onclick = () => { snd.toggle(); paintMute() }

  // 操縦: 押す間だけ曲がる
  for (const b of document.querySelectorAll('.steer-btn')) {
    const dir = Number(b.dataset.dir)
    const down = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId) } catch {} setSteer(dir) }
    const up = e => { e.preventDefault(); if (steerHeld === dir) setSteer(0) }
    b.addEventListener('pointerdown', down)
    b.addEventListener('pointerup', up)
    b.addEventListener('pointercancel', up)
    b.addEventListener('lostpointercapture', up)
    b.addEventListener('contextmenu', e => e.preventDefault())
  }
  // エンジン
  for (const b of document.querySelectorAll('.lever button')) b.addEventListener('pointerdown', e => { e.preventDefault(); send({ type: 'throttle', level: Number(b.dataset.lv) }); snd.tap() })
  $('#eng-vent').addEventListener('pointerdown', e => { e.preventDefault(); send({ type: 'vent' }); snd.tap() })
  // 修理
  for (const b of document.querySelectorAll('.tile')) b.addEventListener('pointerdown', e => { e.preventDefault(); repairTap(b.dataset.sys, b) })
  // ナビ: 目印
  $('#cv-nav').addEventListener('pointerdown', e => {
    e.preventDefault()
    const w = navToWorld(e)
    if (w) { send({ type: 'mark', x: w.x, y: w.y }); snd.tap() }
  })
  // 防衛: タップした方向に撃つ
  $('#cv-defense').addEventListener('pointerdown', e => {
    e.preventDefault()
    const a = defenseAngle(e)
    if (a != null) fire(a)
  })
  // 最初の操作で音を解禁（ブラウザの自動再生の決まり）
  $('#sc').addEventListener('pointerdown', () => snd.unlock(), { capture: true })

  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  // 画面を離れたら舵を戻す（押したまま切り替えると曲がり続けるため）
  window.addEventListener('blur', () => setSteer(0))
  document.addEventListener('visibilitychange', () => { if (document.hidden) setSteer(0) })
  new ResizeObserver(sizeCanvases).observe($('#sc-body'))
  requestAnimationFrame(frame)
  built = true
}

function send(data) { sendFn(data) }
function setSteer(dir) {
  if (steerHeld === dir) return
  steerHeld = dir
  send({ type: 'steer', dir })
}
function repairTap(sys, el) {
  if (!last || last.sys[sys] < 0) return
  send({ type: 'repair', sys })
  snd.tap()
  if (el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump') }
}
function fire(a) {
  if (!last) return
  send({ type: 'fire', a })
  // 撃てそうなときだけ線と音を出す（最終的な判定はサーバー）
  if (last.sys.cannon < 0 && !(last.cd && last.cd.fire > 0.05) && last.energy >= 6) { shotFx.push({ a, t: performance.now() }); snd.fire() }
}

function onKey(e) {
  if (document.body.dataset.screen !== 'game' || !last || e.target.tagName === 'INPUT') return
  const k = e.key
  if (k === 'Tab' && last.roles.length > 1) { e.preventDefault(); const rs = sortedRoles(last.roles); setTab(rs[(rs.indexOf(tab) + (e.shiftKey ? rs.length - 1 : 1)) % rs.length]); return }
  if (tab === 'helm') {
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); setSteer(-1) }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); setSteer(1) }
  } else if (tab === 'engine') {
    if (['1', '2', '3', '4'].includes(k)) send({ type: 'throttle', level: Number(k) - 1 })
    if (k === 'v' || k === 'V' || k === ' ') { e.preventDefault(); send({ type: 'vent' }) }
  } else if (tab === 'repair') {
    const i = Number(k) - 1
    if (i >= 0 && i < SYSTEMS.length && !e.repeat) repairTap(SYSTEMS[i], document.querySelector(`.tile[data-sys="${SYSTEMS[i]}"]`))
  } else if (tab === 'defense' && k === ' ') {
    // 一番近い隕石の方向に撃つ
    e.preventDefault()
    const s = interpShip(); const ms = (last.meteors || [])
    let best = null
    for (const m of ms) { const d = Math.hypot(m[1] - s.x, m[2] - s.y); if (!best || d < best.d) best = { d, m } }
    if (best) fire(Math.atan2(best.m[1] - s.x, best.m[2] - s.y))
  }
}
function onKeyUp(e) {
  if (tab !== 'helm') return
  const k = e.key
  if ((k === 'ArrowLeft' || k === 'a' || k === 'A') && steerHeld === -1) setSteer(0)
  if ((k === 'ArrowRight' || k === 'd' || k === 'D') && steerHeld === 1) setSteer(0)
}

const sortedRoles = rs => ROLE_ORDER.filter(r => rs.includes(r))

function setTab(r) {
  if (tab === 'helm' && r !== 'helm') setSteer(0)
  tab = r
  for (const p of document.querySelectorAll('.pn')) p.hidden = p.dataset.role !== r
  for (const b of document.querySelectorAll('.sc-tabs button')) b.setAttribute('aria-selected', b.dataset.role === r ? 'true' : 'false')
  document.getElementById('sc').dataset.tab = r
  renderCalls()
  sizeCanvases()
}

// ---- 状態が届いたとき
export function render(state, { send: s }) {
  sendFn = s
  if (!built || !$('#sc')) { built = false; build() }
  if (state.round !== curRound) { curRound = state.round; reset() }
  const g = state.game
  if (!g) return
  last = g
  window.__sc = g // e2e の確認用（自分に届いた状態だけ。秘密は入っていない）
  snaps.push({ at: performance.now(), g })
  if (snaps.length > 6) snaps.shift()
  if (g.map) { mapCache = g.map; window.__scMap = g.map }
  if (g.phase === 'fly' && (!trail.length || Math.hypot(trail.at(-1)[0] - g.ship.x, trail.at(-1)[1] - g.ship.y) > 60)) { trail.push([g.ship.x, g.ship.y]); if (trail.length > 300) trail.shift() }

  // 担当のタブ
  const rs = sortedRoles(g.roles)
  if (!tab || !rs.includes(tab)) { tab = null; setTab(rs[0]) }
  const tabs = $('#sc-tabs')
  const key = rs.join(',')
  if (tabs.dataset.key !== key) {
    tabs.dataset.key = key
    tabs.hidden = rs.length < 2
    tabs.replaceChildren(...rs.map(r => {
      const b = document.createElement('button')
      b.dataset.role = r
      b.innerHTML = `${icon(r)}<span>${ROLE_NAMES[r]}</span><i class="dot"></i>`
      b.addEventListener('pointerdown', e => { e.preventDefault(); setTab(r) })
      return b
    }))
    setTab(tab)
  }
  const broken = SYSTEMS.filter(k => g.sys[k] >= 0)
  for (const b of tabs.children) {
    const r = b.dataset.role
    const warn = (r === 'repair' && broken.length) || (r === 'engine' && g.heat >= 80) || (r === 'defense' && (g.meteors || []).length > 0)
    b.classList.toggle('warn', !!warn)
    b.querySelector('.dot').textContent = r === 'repair' && broken.length ? broken.length : ''
  }

  // 上の帯
  meter('hull', g.hull, g.hull <= 30)
  meter('energy', g.energy, g.energy <= 15)
  meter('o2', g.o2, g.o2 <= 40)
  $('#sc-dist').textContent = g.dist >= 1000 ? (g.dist / 1000).toFixed(1) + 'k' : g.dist
  $('#sc-time').textContent = Math.ceil(g.left) + '秒'
  $('#sc-time').classList.toggle('low', g.left <= 20)

  // 故障の札（タップで修理を頼む）
  const alerts = $('#sc-alerts')
  const akey = broken.join(',') + '|' + (g.zone || '') + (g.out ? 'o' : '')
  if (alerts.dataset.key !== akey) {
    alerts.dataset.key = akey
    const chips = broken.map(k => {
      const b = document.createElement('button')
      b.className = 'chip bad'
      b.innerHTML = `${icon(k)}<span>${SYSTEM_NAMES[k]} 故障</span>`
      b.title = SYSTEM_EFFECT[k]
      b.addEventListener('pointerdown', e => { e.preventDefault(); send({ type: 'call', id: 'fix:' + k }) })
      return b
    })
    if (g.zone) { const z = document.createElement('span'); z.className = 'chip zone ' + g.zone; z.textContent = g.zone === 'field' ? '岩場の中 船体が削れる' : '電磁嵐の中 故障しやすい'; chips.unshift(z) }
    if (g.out) { const z = document.createElement('span'); z.className = 'chip zone out'; z.textContent = '航路の外'; chips.unshift(z) }
    if (!chips.length) { const ok = document.createElement('span'); ok.className = 'chip ok'; ok.textContent = '全装置 正常'; chips.push(ok) }
    alerts.replaceChildren(...chips)
  }

  // 掛け声と出来事
  feed(g)
  panels(g)
  brief(g, state)
  if (g.phase !== lastPhase) { if (g.phase === 'fly' && lastPhase === 'brief') snd.go(); lastPhase = g.phase }
  firstState = false
}

function meter(k, v, low) {
  const m = document.querySelector(`.meter[data-k="${k}"]`)
  m.querySelector('b').style.width = Math.max(0, Math.min(100, v)) + '%'
  m.querySelector('.mv').textContent = v
  m.classList.toggle('low', low)
}

function feed(g) {
  const items = [...g.calls.map(c => ({ ...c, kind: 'call' })), ...g.events]
  for (const it of items) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    if (firstState) continue
    if (it.kind === 'call') snd.call()
    else if (it.kind === 'fail') { snd.fail(); navigator.vibrate?.(80) }
    else if (it.kind === 'fixed') snd.fixed()
    else if (it.kind === 'hit') { snd.hit(); navigator.vibrate?.([60, 40, 60]); const sc = $('#sc'); sc.classList.remove('shake'); void sc.offsetWidth; sc.classList.add('shake') }
  }
  const box = $('#sc-feed')
  const show = [...g.calls.map(c => ({ id: c.id, cls: 'call', html: `<b>${esc(c.from)}</b>${esc(c.text)}` })),
    ...g.events.filter(e => e.kind !== 'info').map(e => ({ id: e.id, cls: e.kind, html: esc(e.text) }))]
    .sort((a, b) => b.id - a.id).slice(0, 1)
  const key = show.map(s => s.id).join(',')
  if (box.dataset.key === key) return
  box.dataset.key = key
  box.innerHTML = show.map(s => `<p class="fd ${s.cls}">${s.html}</p>`).join('')
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function renderCalls() {
  const box = $('#sc-calls')
  if (!box || !last) return
  const ids = [...new Set([...(ROLE_CALLS[tab] || []), 'help'])]
  const key = tab + ids.join()
  if (box.dataset.key === key) return
  box.dataset.key = key
  box.replaceChildren(...ids.map(id => {
    const b = document.createElement('button')
    b.className = 'call-btn'
    b.textContent = CALL_TEXT[id]
    b.addEventListener('pointerdown', e => { e.preventDefault(); send({ type: 'call', id }); b.classList.add('sent'); setTimeout(() => b.classList.remove('sent'), 400) })
    return b
  }))
}

function panels(g) {
  renderCalls()
  // 操縦
  $('#helm-state').textContent = g.sys.helm >= 0 ? '操舵装置 故障中' : g.steer < 0 ? '左へ旋回中' : g.steer > 0 ? '右へ旋回中' : 'まっすぐ'
  $('#helm-state').classList.toggle('bad', g.sys.helm >= 0)
  for (const b of document.querySelectorAll('.steer-btn')) b.classList.toggle('on', Number(b.dataset.dir) === g.steer)
  // エンジン
  for (const b of document.querySelectorAll('.lever button')) b.setAttribute('aria-pressed', Number(b.dataset.lv) === g.throttle ? 'true' : 'false')
  $('#eng-speed').textContent = g.ship.v
  gauge('#eng-heat', g.heat, g.heat >= 80)
  gauge('#eng-energy', g.energy, g.energy <= 15)
  const vent = $('#eng-vent')
  vent.disabled = !!(g.cd && g.cd.vent > 0) || g.energy < 12
  vent.querySelector('small').textContent = g.cd && g.cd.vent > 0 ? `準備中 ${g.cd.vent.toFixed(1)}秒` : g.energy < 12 ? '電力が足りない' : '電力12で熱を下げる'
  $('#eng-msg').textContent = g.sys.engine >= 0 ? 'エンジン故障中 速度が出ない。修理を呼ぼう' : g.heat >= 80 ? '過熱寸前。出力を下げるか冷却' : g.energy <= 0 ? '電力切れ 低速までしか出ない' : ''
  $('#eng-msg').classList.toggle('bad', !!$('#eng-msg').textContent)
  // 修理
  let nb = 0
  for (const t of document.querySelectorAll('.tile')) {
    const v = g.sys[t.dataset.sys]
    const br = v >= 0
    if (br) nb++
    t.classList.toggle('broken', br)
    t.querySelector('.ts').textContent = br ? `故障 ${v}%` : '正常'
    t.querySelector('.tbar b').style.width = (br ? v : 100) + '%'
    t.setAttribute('aria-label', `${SYSTEM_NAMES[t.dataset.sys]} ${br ? '故障 修理' + v + '%' : '正常'}`)
  }
  $('#rep-hint').textContent = nb ? `${nb}か所が故障。どれから直すか決めて連打` : 'いまは全部正常。故障したら連打で直す'
  // 防衛
  $('#def-hint').textContent = g.sys.cannon >= 0 ? '砲台が故障中。撃てない' : g.energy < 6 ? '電力が足りなくて撃てない' : 'レーダーをタップした方向に撃つ'
  $('#def-hint').classList.toggle('bad', g.sys.cannon >= 0 || g.energy < 6)
}
function gauge(sel, v, low) {
  const el = $(sel)
  el.querySelector('b').style.height = Math.max(0, Math.min(100, v)) + '%'
  el.querySelector('.gv').textContent = v
  el.classList.toggle('low', low)
}

function brief(g, state) {
  const el = $('#sc-brief')
  if (g.phase !== 'brief') { el.hidden = true; return }
  el.hidden = false
  const key = g.roles.join()
  if (el.dataset.key !== key) {
    el.dataset.key = key
    $('#brief-roles').innerHTML = sortedRoles(g.roles).map(r => `<div class="br">${icon(r)}<div><strong>${ROLE_NAMES[r]}</strong><p>${ROLE_DESC[r]}</p></div></div>`).join('')
    $('#brief-crew').innerHTML = g.crew.map(c => `<li${c.id === state.you ? ' class="me"' : ''}><span>${esc(c.name)}</span><small>${sortedRoles(c.roles).map(r => ROLE_NAMES[r]).join('・')}</small></li>`).join('')
    $('#sc-brief').classList.toggle('many', g.roles.length > 2)
  }
  $('#brief-count').textContent = `発進まで ${Math.ceil(g.brief)}`
}

// ---- 補間
function interp() {
  if (!snaps.length) return null
  const t = performance.now() - TICK_MS * 1.5
  let a = snaps[0], b = snaps[0]
  for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].at <= t && snaps[i + 1].at >= t) { a = snaps[i]; b = snaps[i + 1]; break }
  if (t > snaps.at(-1).at) a = b = snaps.at(-1)
  const u = b.at === a.at ? 1 : Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)))
  return { a: a.g, b: b.g, u }
}
const lerp = (a, b, u) => a + (b - a) * u
const lerpAng = (a, b, u) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * u }
function interpShip() {
  const p = interp()
  if (!p) return { x: 0, y: 0, h: 0, v: 0 }
  return { x: lerp(p.a.ship.x, p.b.ship.x, p.u), y: lerp(p.a.ship.y, p.b.ship.y, p.u), h: lerpAng(p.a.ship.h, p.b.ship.h, p.u), v: p.b.ship.v }
}
function interpList(key) {
  const p = interp()
  if (!p || !p.b[key]) return []
  const prev = new Map((p.a[key] || []).map(m => [m[0], m]))
  return p.b[key].map(m => { const o = prev.get(m[0]); return o ? [m[0], lerp(o[1], m[1], p.u), lerp(o[2], m[2], p.u)] : m })
}

// ---- キャンバス
const cvs = {}
function sizeCanvases() {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  for (const id of ['cv-helm', 'cv-nav', 'cv-defense']) {
    const c = document.getElementById(id)
    if (!c || c.closest('.pn').hidden) continue
    const r = c.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr)
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    cvs[id] = { c, ctx: c.getContext('2d'), w: r.width, h: r.height, dpr }
  }
}

function frame() {
  requestAnimationFrame(frame)
  if (document.body.dataset.screen !== 'game' || !last) return
  const id = 'cv-' + tab
  const k = cvs[id]
  if (!k) { if (['helm', 'nav', 'defense'].includes(tab)) sizeCanvases(); return }
  const { ctx, w, h, dpr } = k
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (tab === 'helm') drawHelm(ctx, w, h)
  else if (tab === 'nav') drawNav(ctx, w, h)
  else if (tab === 'defense') drawDefense(ctx, w, h)
}

const COL = { bg: '#060a17', star: '#c9d6ff', cyan: '#5fd4ff', amber: '#ffb547', red: '#ff5d6c', green: '#54e0a0', violet: '#b48cff', rust: '#d9824a', line: '#24304d', text: '#e8ecf6', muted: '#93a0bd' }

function hash(x, y) { let n = (x * 374761393 + y * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }

// 船を中心に、進行方向を上にした座標へ変換
function toLocal(s, x, y, cx, cy, sc) {
  const wx = x - s.x, wy = y - s.y
  const c = Math.cos(s.h), sn = Math.sin(s.h)
  const lx = wx * c - wy * sn, ly = wx * sn + wy * c
  return [cx + lx * sc, cy - ly * sc]
}

function drawStars(ctx, w, h, s, cx, cy, sc, range) {
  const cell = 120
  const x0 = Math.floor((s.x - range) / cell), x1 = Math.floor((s.x + range) / cell)
  const y0 = Math.floor((s.y - range) / cell), y1 = Math.floor((s.y + range) / cell)
  for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
    const r = hash(gx, gy)
    if (r > 0.75) continue
    const px = (gx + hash(gy, gx)) * cell, py = (gy + hash(gx + 7, gy - 3)) * cell
    const [sx, sy] = toLocal(s, px, py, cx, cy, sc)
    if (sx < -4 || sy < -4 || sx > w + 4 || sy > h + 4) continue
    const big = r < 0.08
    ctx.fillStyle = big ? '#ffffff' : 'rgba(201,214,255,' + (0.35 + r * 0.6) + ')'
    ctx.fillRect(sx, sy, big ? 2.2 : 1.3, big ? 2.2 : 1.3)
  }
}

function drawShip(ctx, x, y, sz, rot = 0, col = COL.amber, thrust = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot)
  if (thrust > 0) {
    ctx.fillStyle = 'rgba(255,181,71,' + (0.35 + Math.random() * 0.3) + ')'
    ctx.beginPath(); ctx.moveTo(-sz * 0.35, sz * 0.75); ctx.lineTo(0, sz * (0.9 + thrust * 1.1 + Math.random() * 0.2)); ctx.lineTo(sz * 0.35, sz * 0.75); ctx.fill()
  }
  ctx.fillStyle = '#1a2440'; ctx.strokeStyle = col; ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.62, sz * 0.55); ctx.lineTo(sz * 0.22, sz * 0.8); ctx.lineTo(-sz * 0.22, sz * 0.8); ctx.lineTo(-sz * 0.62, sz * 0.55); ctx.closePath()
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -sz * 0.2, sz * 0.18, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

function drawRock(ctx, x, y, r, id, col = '#b9a48a') {
  ctx.save(); ctx.translate(x, y)
  ctx.fillStyle = '#4a3f36'; ctx.strokeStyle = col; ctx.lineWidth = 1.6
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + id
    const rr = r * (0.75 + hash(id, i) * 0.4)
    i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.restore()
}

// 画面の外にあるものを、縁の矢印で示す
function edgeArrow(ctx, w, h, cx, cy, tx, ty, col, label, lift = 0) {
  const m = 26
  const inside = tx > m && ty > m && tx < w - m && ty < h - m
  if (inside) return false
  const dx = tx - cx, dy = ty - cy
  const k = Math.min(Math.abs((w / 2 - m) / (dx || 1e-6)), Math.abs(((dy < 0 ? cy : h - cy) - m) / (dy || 1e-6)))
  const ex = cx + dx * k, ey = cy + dy * k
  const a = Math.atan2(dy, dx)
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(a)
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-4, 0); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill()
  ctx.restore()
  ctx.font = '700 13px system-ui, sans-serif'; ctx.fillStyle = col
  ctx.textAlign = ex < w / 2 ? 'left' : 'right'; ctx.textBaseline = ey < h / 2 ? 'top' : 'bottom'
  ctx.fillText(label, ex + (ex < w / 2 ? 14 : -14), ey + (ey < h / 2 ? 10 + lift : -10 - lift))
  return true
}

function labelBox(ctx, text, x, y, col) {
  ctx.font = '700 15px system-ui, sans-serif'
  const tw = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(6,10,23,.82)'; ctx.fillRect(x - tw / 2 - 10, y - 15, tw + 20, 30)
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(x - tw / 2 - 10, y - 15, tw + 20, 30)
  ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y)
}

function drawHelm(ctx, w, h) {
  const g = last, s = interpShip()
  const cx = w / 2, cy = h * 0.7
  const sc = Math.min(cy / 470, (w / 2) / 330)
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h)
  drawStars(ctx, w, h, s, cx, cy, sc, 700)
  // 航路の端（見える距離にあれば線で）
  ctx.strokeStyle = 'rgba(255,93,108,.6)'; ctx.setLineDash([8, 8]); ctx.lineWidth = 2
  for (const ex of [-g.w, g.w]) {
    if (Math.abs(ex - s.x) > 700) continue
    const [ax, ay] = toLocal(s, ex, s.y - 900, cx, cy, sc), [bx, by] = toLocal(s, ex, s.y + 900, cx, cy, sc)
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
  }
  ctx.setLineDash([])
  // 目的地
  const [gx, gy] = toLocal(s, g.goal.x, g.goal.y, cx, cy, sc)
  if (!edgeArrow(ctx, w, h, cx, cy, gx, gy, COL.green, '目的地 ' + g.dist)) {
    const t = performance.now() / 600
    for (let i = 0; i < 3; i++) { ctx.strokeStyle = `rgba(84,224,160,${0.8 - i * 0.25})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy, (200 * sc) * (0.4 + ((t + i / 3) % 1) * 0.6), 0, Math.PI * 2); ctx.stroke() }
    ctx.fillStyle = COL.green; ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('目的地', gx, gy + 4)
  }
  // ナビの目印
  if (g.marker) {
    const [mx, my] = toLocal(s, g.marker.x, g.marker.y, cx, cy, sc)
    if (!edgeArrow(ctx, w, h, cx, cy, mx, my, COL.cyan, 'ナビの目印', 18)) {
      ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.PI / 4); ctx.strokeStyle = COL.cyan; ctx.lineWidth = 2.5; ctx.strokeRect(-9, -9, 18, 18); ctx.restore()
      ctx.fillStyle = COL.cyan; ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('目印', mx, my - 18)
    }
  }
  // 隕石と弾
  for (const m of interpList('meteors')) { const [x, y] = toLocal(s, m[1], m[2], cx, cy, sc); drawRock(ctx, x, y, 22 * sc * 1.15, m[0]) }
  ctx.strokeStyle = COL.amber; ctx.lineWidth = 3
  for (const b of interpList('bolts')) { const [x, y] = toLocal(s, b[1], b[2], cx, cy, sc); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.stroke() }
  drawShip(ctx, cx, cy, Math.max(16, 28 * sc * 1.2), 0, COL.amber, s.v / SPEED_MAX)
  // 状態の帯
  if (g.zone) { ctx.fillStyle = g.zone === 'field' ? 'rgba(217,130,74,.16)' : 'rgba(180,140,255,.16)'; ctx.fillRect(0, 0, w, h) }
  if (g.sys.helm >= 0) labelBox(ctx, '操舵装置 故障中 舵が効かない', w / 2, 28, COL.red)
  else if (g.zone) labelBox(ctx, g.zone === 'field' ? '岩場の中 早く抜けて' : '電磁嵐の中 早く抜けて', w / 2, 28, g.zone === 'field' ? COL.rust : COL.violet)
  else if (g.out) labelBox(ctx, '航路の外 戻って', w / 2, 28, COL.red)
}

// ナビの地図
function navFit(w, h) {
  const g = last
  const ww = g.w * 2 + 200, wh = g.len + 900
  const sc = Math.min((w - 16) / ww, (h - 16) / wh)
  const ox = w / 2, oy = h / 2 + (g.len / 2 + 50) * sc // y=len/2-50 が中央
  return { sc, X: x => ox + x * sc, Y: y => oy - y * sc, ix: px => (px - ox) / sc, iy: py => (oy - py) / sc }
}
function navToWorld(e) {
  if (!last) return null
  const r = e.currentTarget.getBoundingClientRect()
  const f = navFit(r.width, r.height)
  return { x: Math.round(f.ix(e.clientX - r.left)), y: Math.round(f.iy(e.clientY - r.top)) }
}
function drawNav(ctx, w, h) {
  const g = last, s = interpShip()
  const f = navFit(w, h)
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h)
  if (g.radar === false) {
    // センサー故障: 砂嵐
    for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(147,160,189,${Math.random() * 0.35})`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2) }
    labelBox(ctx, 'センサー故障 地図が見えない', w / 2, h / 2 - 20, COL.red)
    ctx.fillStyle = COL.muted; ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('修理の人に直してもらおう', w / 2, h / 2 + 22)
    return
  }
  // 方眼
  ctx.strokeStyle = 'rgba(95,212,255,.08)'; ctx.lineWidth = 1
  for (let y = 0; y <= g.len + 500; y += 500) { ctx.beginPath(); ctx.moveTo(f.X(-g.w), f.Y(y)); ctx.lineTo(f.X(g.w), f.Y(y)); ctx.stroke() }
  for (let x = -g.w; x <= g.w; x += 500) { ctx.beginPath(); ctx.moveTo(f.X(x), f.Y(-300)); ctx.lineTo(f.X(x), f.Y(g.len + 600)); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,93,108,.55)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5
  ctx.strokeRect(f.X(-g.w), f.Y(g.len + 600), g.w * 2 * f.sc, (g.len + 900) * f.sc)
  ctx.setLineDash([])
  // 危険地帯
  for (const [k, x, y, r] of mapCache || []) drawHazard(ctx, f, k, x, y, r)
  // 目的地
  ctx.strokeStyle = COL.green; ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(f.X(g.goal.x), f.Y(g.goal.y), Math.max(8, 200 * f.sc), 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = COL.green; ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
  ctx.fillText('目的地', f.X(g.goal.x), f.Y(g.goal.y) - Math.max(10, 200 * f.sc) - 2)
  // 軌跡
  ctx.strokeStyle = 'rgba(255,181,71,.45)'; ctx.lineWidth = 2; ctx.beginPath()
  trail.forEach(([x, y], i) => i ? ctx.lineTo(f.X(x), f.Y(y)) : ctx.moveTo(f.X(x), f.Y(y)))
  if (trail.length) ctx.lineTo(f.X(s.x), f.Y(s.y))
  ctx.stroke()
  // 目印
  if (g.marker) {
    const mx = f.X(g.marker.x), my = f.Y(g.marker.y)
    ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.PI / 4); ctx.strokeStyle = COL.cyan; ctx.lineWidth = 2.5; ctx.strokeRect(-7, -7, 14, 14); ctx.restore()
    ctx.strokeStyle = 'rgba(95,212,255,.5)'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(f.X(s.x), f.Y(s.y)); ctx.lineTo(mx, my); ctx.stroke(); ctx.setLineDash([])
  }
  drawShip(ctx, f.X(s.x), f.Y(s.y), 11, s.h, COL.amber)
  // 凡例
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(6,10,23,.78)'; ctx.fillRect(6, 6, 150, 24)
  ctx.fillStyle = COL.rust; ctx.fillText('■ 岩場', 12, 23); ctx.fillStyle = COL.violet; ctx.fillText('▲ 電磁嵐', 70, 23)
}
function drawHazard(ctx, f, k, x, y, r) {
  const X = f.X(x), Y = f.Y(y), R = r * f.sc
  if (k === 'field') {
    ctx.fillStyle = 'rgba(217,130,74,.22)'; ctx.strokeStyle = COL.rust; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    for (let i = 0; i < 7; i++) { const a = hash(x + i, y) * Math.PI * 2, d = hash(y, x + i) * R * 0.8; ctx.fillStyle = COL.rust; ctx.fillRect(X + Math.cos(a) * d - 2, Y + Math.sin(a) * d - 2, 4, 4) }
  } else {
    ctx.fillStyle = 'rgba(180,140,255,.18)'; ctx.strokeStyle = COL.violet; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4])
    ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle = COL.violet; ctx.beginPath(); ctx.moveTo(X, Y - 7); ctx.lineTo(X + 7, Y + 5); ctx.lineTo(X - 7, Y + 5); ctx.closePath(); ctx.fill()
  }
}

// 防衛のレーダー（進行方向が上）
function defFit(w, h) { const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 10; return { cx, cy, R, sc: R / 700 } }
function defenseAngle(e) {
  if (!last) return null
  const r = e.currentTarget.getBoundingClientRect()
  const { cx, cy } = defFit(r.width, r.height)
  const lx = e.clientX - r.left - cx, ly = cy - (e.clientY - r.top)
  if (Math.hypot(lx, ly) < 4) return null
  const s = interpShip()
  const c = Math.cos(s.h), sn = Math.sin(s.h)
  const wx = lx * c + ly * sn, wy = -lx * sn + ly * c
  return Math.round(Math.atan2(wx, wy) * 1000) / 1000
}
function drawDefense(ctx, w, h) {
  const g = last, s = interpShip()
  const { cx, cy, R, sc } = defFit(w, h)
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h)
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip()
  ctx.fillStyle = '#071425'; ctx.fillRect(0, 0, w, h)
  drawStars(ctx, w, h, s, cx, cy, sc, 760)
  // 走査線
  const sweep = (performance.now() / 1400) % 1 * Math.PI * 2
  const grd = ctx.createConicGradient ? ctx.createConicGradient(sweep - Math.PI / 2, cx, cy) : null
  if (grd) { grd.addColorStop(0, 'rgba(84,224,160,.25)'); grd.addColorStop(0.12, 'rgba(84,224,160,0)'); grd.addColorStop(1, 'rgba(84,224,160,0)'); ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h) }
  ctx.strokeStyle = 'rgba(84,224,160,.28)'; ctx.lineWidth = 1
  for (const k of [1 / 3, 2 / 3, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke() }
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke()
  // 撃った線
  const now = performance.now()
  shotFx = shotFx.filter(f => now - f.t < 250)
  for (const f of shotFx) {
    const la = f.a - s.h
    ctx.strokeStyle = `rgba(255,181,71,${1 - (now - f.t) / 250})`; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(la) * R, cy - Math.cos(la) * R); ctx.stroke()
  }
  for (const b of interpList('bolts')) { const [x, y] = toLocal(s, b[1], b[2], cx, cy, sc); ctx.fillStyle = COL.amber; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill() }
  for (const m of interpList('meteors')) {
    const [x, y] = toLocal(s, m[1], m[2], cx, cy, sc)
    drawRock(ctx, x, y, Math.max(9, 22 * sc * 1.3), m[0], COL.red)
  }
  ctx.restore()
  ctx.strokeStyle = 'rgba(84,224,160,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = COL.muted; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('前', cx, cy - R + 16)
  drawShip(ctx, cx, cy, 12, 0, COL.amber)
  // 次に撃てるまで
  if (g.cd && g.cd.fire > 0) { ctx.strokeStyle = COL.amber; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + (1 - g.cd.fire / 0.45) * Math.PI * 2); ctx.stroke() }
  if (g.sys.cannon >= 0) labelBox(ctx, '砲台 故障中', cx, cy + R * 0.45, COL.red)
}

// ---- 結果画面
export function renderResult(state) {
  const r = state.result
  if (endPlayed !== state.round) { endPlayed = state.round; snd.end(r.win) }
  const wrap = document.createElement('div')
  wrap.className = 'res'
  const stars = [0, 1, 2].map(i => `<span class="st ${i < r.stars ? 'on' : ''}">${icon('star')}</span>`).join('')
  wrap.innerHTML = `
    <p class="res-sub">${esc(r.sub)}</p>
    ${r.win ? `<div class="res-stars" aria-label="星${r.stars}つ">${stars}</div>` : `<p class="res-left">目的地まであと ${r.dist}</p>`}
    <canvas class="res-map" aria-label="通った航路"></canvas>
    <div class="res-stats">
      <div><span>飛行</span><strong>${r.time}秒</strong></div>
      <div><span>船体</span><strong>${r.hull}</strong></div>
      <div><span>修理</span><strong>${r.fixed}/${r.failures}</strong></div>
      <div><span>撃墜/被弾</span><strong>${r.meteorsShot}/${r.hitsTaken}</strong></div>
    </div>
    <ul class="res-crew">${r.crew.map(c => {
      const parts = []
      if (c.repairs) parts.push(`修理${c.repairs}`)
      if (c.hits) parts.push(`撃墜${c.hits}`)
      if (c.marks) parts.push(`目印${c.marks}`)
      if (c.calls) parts.push(`声${c.calls}`)
      return `<li${c.id === state.you ? ' class="me"' : ''}><b>${esc(c.name)}</b><small>${sortedRoles(c.roles).map(x => ROLE_NAMES[x]).join('・')}</small><em>${parts.join(' ') || '-'}</em></li>`
    }).join('')}</ul>`
  const map = wrap.querySelector('.res-map')
  requestAnimationFrame(() => drawResultMap(map, r))
  // 画面の向きや大きさが変わったら描き直す（伸びて楕円にならないように）
  new ResizeObserver(() => drawResultMap(map, r)).observe(map)
  return wrap
}
function drawResultMap(c, r) {
  if (!c || !c.isConnected) return
  const rect = c.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr)
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const w = rect.width, h = rect.height
  // 縦長の航路を横向きに寝かせて描く（結果画面は横に広い）
  // 枠が横長なら航路を寝かせ、縦長なら立てて描く（大きく見せるため）
  const flat = w >= h
  const ww = flat ? r.len + 900 : r.w * 2 + 200, wh = flat ? r.w * 2 + 200 : r.len + 900
  const sc = Math.min((w - 12) / ww, (h - 12) / wh)
  // X(y, x) / Y(x, y): 世界の (x, y) を画面へ
  const X = flat ? (y => w / 2 + (y - r.len / 2) * sc) : null, Y = flat ? (x => h / 2 + x * sc) : null
  const P = flat ? (x, y) => [X(y), Y(x)] : (x, y) => [w / 2 + x * sc, h / 2 - (y - r.len / 2) * sc]
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h)
  const [ax, ay] = P(-r.w, -300), [bx, by] = P(r.w, r.len + 600)
  ctx.strokeStyle = 'rgba(255,93,108,.4)'; ctx.setLineDash([5, 5]); ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); ctx.setLineDash([])
  for (const [k, x, y, rr] of r.hazards) { const [px, py] = P(x, y); drawHazard(ctx, { sc, X: () => px, Y: () => py }, k, x, y, rr) }
  const [gx, gy] = P(r.goal.x, r.goal.y)
  ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy, Math.max(6, 200 * sc), 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = COL.amber; ctx.lineWidth = 2.5; ctx.beginPath()
  r.track.forEach(([x, y], i) => { const [px, py] = P(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py) })
  ctx.stroke()
  const [ex, ey] = r.track.at(-1)
  const [px, py] = P(ex, ey)
  if (r.win) { ctx.fillStyle = COL.green; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill() }
  else { ctx.strokeStyle = COL.red; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px - 7, py - 7); ctx.lineTo(px + 7, py + 7); ctx.moveTo(px + 7, py - 7); ctx.lineTo(px - 7, py + 7); ctx.stroke() }
  const [sx, sy] = P(0, 0)
  ctx.fillStyle = COL.muted; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('出発', sx, sy + 18)
}

// ---- ロビー：人数ごとの担当の分け方
const ROLE_SETS = {
  1: [['helm', 'engine', 'repair', 'nav', 'defense']],
  2: [['helm', 'engine'], ['nav', 'repair', 'defense']],
  3: [['helm', 'engine'], ['nav', 'defense'], ['repair']],
  4: [['helm'], ['engine', 'repair'], ['nav'], ['defense']],
  5: [['helm'], ['engine'], ['repair'], ['nav'], ['defense']],
  6: [['helm'], ['engine'], ['repair'], ['nav'], ['defense'], ['repair']],
  7: [['helm'], ['engine'], ['repair'], ['nav'], ['defense'], ['repair'], ['defense']],
  8: [['helm'], ['engine'], ['repair'], ['nav'], ['defense'], ['repair'], ['defense'], ['repair']]
}
export function renderLobby(state) {
  const el = $('#rolePreview')
  if (!el) return
  const n = Math.max(1, Math.min(8, state.players.filter(p => p.connected).length))
  el.innerHTML = `<span class="rp-k">${n}人のときの担当</span>` + ROLE_SETS[n].map(s => `<span class="rp">${s.map(r => ROLE_NAMES[r]).join('+')}</span>`).join('') + (n < 3 ? '<span class="rp-note">おすすめは3〜8人。少ないと兼任になる</span>' : '')
}

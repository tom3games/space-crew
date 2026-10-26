// 宇宙船クルーの画面。上は船を後ろから追いかける 3D（WebGL が無ければ 2D）、下は担当ごとの操作盤。
// render(state, { send }) は状態が届くたびに呼ばれる（毎秒15回）。動きは届いた状態の間を補間して描く。
import { createView3D } from './view3d.js'
import * as snd from './sound.js'
import { ROUTES, EVENT_NAMES, CREW_COLORS } from './routes.js'

const $ = s => document.querySelector(s)
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export const ROLE_NAMES = { helm: '操縦', engine: 'エンジン', repair: '修理', nav: 'ナビ', defense: '防衛' }
export const ROLE_ORDER = ['helm', 'nav', 'engine', 'defense', 'repair']
const ROLE_DESC = {
  helm: '左右のボタンで船の向きを変える。1回押すと曲がりっぱなし、もう1回で戻る。危険地帯はあなたには見えない',
  engine: '出力を4段で切り替える。全開は速いが熱がたまり、100で故障。冷却で熱を下げる',
  repair: '壊れた装置をタップ連打で直す。どれから直すかはあなたが決める',
  nav: '岩場と電磁嵐が見えるのはあなただけ。地図をタップして目印を置き、声で進路を伝える',
  defense: '画面の隕石をタップすると、その方向に撃つ。撃つと電力を使う'
}
const SYSTEMS = ['helm', 'engine', 'radar', 'cannon', 'life']
const SYSTEM_NAMES = { helm: '操舵装置', engine: 'エンジン', radar: 'センサー', cannon: '砲台', life: '生命維持' }
const CALL_TEXT = { left: '左へ', right: '右へ', straight: 'まっすぐ', slow: '減速して', fast: '加速して', pod: '補給を拾って', meteor: '隕石が来る', power: '電力が足りない', help: '手伝って', sorry: 'ごめん', nice: 'ナイス' }
const ROLE_CALLS = { helm: ['slow', 'fast', 'meteor'], nav: ['left', 'straight', 'right', 'pod'], engine: ['power'], defense: ['meteor', 'power'], repair: [] }
const TICK_MS = 1000 / 15
const SIGHT = { defense: 700, helm: 480 }

// ---- アイコン（自前の SVG。線だけ）
const I = {
  helm: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3v5.8M12 15.2V21M3 12h5.8M15.2 12H21"/>',
  engine: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4.5-5"/><circle cx="12" cy="16" r="1.5"/>',
  repair: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5Z"/>',
  nav: '<circle cx="12" cy="12" r="9.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  defense: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/>',
  radar: '<path d="M12 12l6.5-6.5"/><path d="M3.5 12A8.5 8.5 0 1 0 12 3.5"/><path d="M7.5 12A4.5 4.5 0 1 0 12 7.5"/>',
  cannon: '<path d="M4 18h10l2-4H6Z"/><path d="M11 14l8-8M17 4l3 3"/>',
  life: '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z"/>',
  hull: '<path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z"/>',
  energy: '<path d="M13 2L5 13.5h6L10 22l8-11.5h-6z"/>',
  o2: '<circle cx="9" cy="14" r="6"/><circle cx="17" cy="7" r="3.5"/><circle cx="18.5" cy="16" r="2"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  left: '<path d="M14 5l-7 7 7 7"/><path d="M7 12h12" opacity=".5"/>',
  right: '<path d="M10 5l7 7-7 7"/><path d="M17 12H5" opacity=".5"/>',
  straight: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  vent: '<path d="M12 2v20M4 6.5l16 11M20 6.5l-16 11"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>',
  aim: '<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle cx="12" cy="12" r="1.6"/>',
  soundOn: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  soundOff: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9Z"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M8.5 9.8L6 3h4l2 4.5L14 3h4l-2.5 6.8"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pod: '<rect x="4" y="8" width="16" height="8" rx="4"/><path d="M12 8v8"/>',
  meteor: '<circle cx="15" cy="9" r="5"/><path d="M11 13l-8 8M9 9l-5 2M15 15l-2 5"/>',
  wrench: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5Z"/>',
  arrow: '<path d="M4 12h13M12 6l7 6-7 6"/>'
}
const icon = (k, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${I[k] || ''}</svg>`
const CAT_SVG = `<svg viewBox="0 0 120 100" aria-hidden="true"><path d="M22 40L28 8l22 20M98 40L92 8 70 28" fill="#ffa64d" stroke="#140c33" stroke-width="5" stroke-linejoin="round"/><ellipse cx="60" cy="56" rx="44" ry="38" fill="#ffa64d" stroke="#140c33" stroke-width="5"/><path d="M38 52q6-8 12 0M70 52q6-8 12 0" fill="none" stroke="#140c33" stroke-width="5" stroke-linecap="round"/><path d="M52 66q8 7 16 0" fill="none" stroke="#140c33" stroke-width="4" stroke-linecap="round"/><path d="M18 62l-14-3M18 70l-14 3M102 62l14-3M102 70l14 3" stroke="#140c33" stroke-width="3" stroke-linecap="round"/><ellipse cx="34" cy="68" rx="7" ry="4" fill="#ff7ab8" opacity=".6"/><ellipse cx="86" cy="68" rx="7" ry="4" fill="#ff7ab8" opacity=".6"/></svg>`
const SHIP_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><use href="#i-ship"/></svg>'

let ui = null // 1ラウンド分の画面の部品と状態
let sendFn = () => {}
const send = d => sendFn(d)
const sortedRoles = rs => ROLE_ORDER.filter(r => rs.includes(r))
const FORCE_2D = new URLSearchParams(location.search).has('2d') // 参加すると URL が書き換わるので、読み込んだ時点で覚えておく
const use2D = () => FORCE_2D

// ---- 組み立て（ラウンドごと）
function build(state) {
  const g = state.game
  if (ui && ui.v3) try { ui.v3.dispose() } catch {}
  if (ui && ui.ro) ui.ro.disconnect()
  const route = ROUTES[g.route] || ROUTES.belt
  const root = $('#stage')
  { const q = $('#quitBtn'); if (q) $('#game').append(q) } // 作り直しで退出ボタンを消さない
  root.innerHTML = `
  <div class="sc" id="sc">
    <div class="sc-view" id="sc-view">
      <canvas id="sc-cv" aria-label="船を後ろから見た景色"></canvas>
      <div class="sc-fx" id="sc-fx"></div>
      <div class="sc-labels" id="sc-labels" aria-hidden="true"></div>
      <div class="sc-hud">
        <div class="meters">
          <div class="meter" data-k="hull" style="--c:var(--mint)">${icon('hull')}<i><b></b></i><span class="mv"></span></div>
          <div class="meter" data-k="energy" style="--c:var(--sun)">${icon('energy')}<i><b></b></i><span class="mv"></span></div>
          <div class="meter" data-k="o2" style="--c:var(--cyan)">${icon('o2')}<i><b></b></i><span class="mv"></span></div>
        </div>
        <div class="hud-spacer"></div>
        <div class="timer" id="sc-timer">${icon('clock')}<span id="sc-time">-</span></div>
        <button class="icon-btn" id="sc-mute" aria-label="音"></button>
      </div>
      <div class="sc-prog" aria-hidden="true">
        <div class="prog-line"><i id="sc-progBar"></i></div>
        <div id="sc-gates"></div>
        <span class="prog-ship" id="sc-progShip">${SHIP_SVG}</span>
        <span class="prog-goal"></span>
        <span class="prog-sec" id="sc-sec"></span>
      </div>
      <div class="sc-feed" id="sc-feed" aria-live="polite"></div>
      <div class="sc-banner" id="sc-banner" hidden></div>
    </div>
    <div class="sc-dock" id="sc-dock">
      <div class="sc-alerts" id="sc-alerts" aria-live="polite"></div>
      <div class="sc-body" id="sc-body">
        <section class="pn pn-helm" data-role="helm">
          <div class="steer">
            <button class="kbtn" data-dir="-1" aria-pressed="false" aria-label="左に曲がる（切り替え）">${icon('left')}<span>左へ</span></button>
            <button class="kbtn mid" data-dir="0" aria-pressed="true" aria-label="まっすぐ">${icon('straight')}<span>まっすぐ</span></button>
            <button class="kbtn" data-dir="1" aria-pressed="false" aria-label="右に曲がる（切り替え）">${icon('right')}<span>右へ</span></button>
          </div>
          <p class="pn-hint" id="helm-hint">1回押すと曲がりっぱなし。もう1回で戻る</p>
        </section>
        <section class="pn pn-nav" data-role="nav">
          <div class="cvw"><canvas id="cv-nav" aria-label="航路の地図。タップで目印"></canvas></div>
          <p class="pn-hint" id="nav-hint">地図をタップすると、みんなの画面に目印が立つ</p>
        </section>
        <section class="pn pn-defense" data-role="defense">
          <div class="def-row">
            <p class="pn-hint" id="def-hint">上の画面で隕石をタップして撃つ</p>
            <button class="kbtn" id="def-auto">${icon('aim')}<span>近い隕石を撃つ</span></button>
          </div>
        </section>
        <section class="pn pn-engine" data-role="engine">
          <div class="lever" role="group" aria-label="出力">
            ${[['0', '停止'], ['1', '低速'], ['2', '巡航'], ['3', '全開']].map(([lv, t]) => `<button class="kbtn" data-lv="${lv}" aria-pressed="false">${t}<small>${['止まる', '冷える', 'ふつう', '熱い'][lv]}</small></button>`).join('')}
          </div>
          <div class="eng-row">
            <div class="gauge" id="eng-heat" style="--c:var(--orange)"><span class="gl">熱</span><div class="gbar"><b></b><i class="gmark"></i></div><span class="gv"></span></div>
            <div class="gauge" id="eng-energy" style="--c:var(--sun)"><span class="gl">電力</span><div class="gbar"><b></b></div><span class="gv"></span></div>
            <button class="kbtn vent" id="eng-vent">${icon('vent')}<span>冷却</span></button>
          </div>
          <p class="eng-msg" id="eng-msg"></p>
        </section>
        <section class="pn pn-repair" data-role="repair">
          <div class="tiles" id="rep-tiles">
            ${SYSTEMS.map((s, i) => `<button class="tile" data-sys="${s}">${icon(s)}<span class="tn">${SYSTEM_NAMES[s]}</span><span class="tbar"><b></b></span><span class="tk">${i + 1}</span></button>`).join('')}
          </div>
          <p class="pn-hint" id="rep-hint"></p>
        </section>
      </div>
      <div class="sc-calls" id="sc-calls"></div>
      <nav class="sc-tabs" id="sc-tabs"></nav>
      <div class="sc-cat" id="sc-cat" hidden role="button" aria-label="ネコを追い払う（連打）">${CAT_SVG}<b>ネコが乗った！連打で追い払え</b><span class="pips" id="sc-catPips"></span></div>
    </div>
    <div class="sc-brief" id="sc-brief" hidden>
      <p class="brief-route" id="brief-route"></p>
      <p class="brief-k">あなたの担当</p>
      <div class="brief-roles" id="brief-roles"></div>
      <ul class="brief-crew" id="brief-crew"></ul>
      <p class="brief-count" id="brief-count"></p>
    </div>
  </div>`

  const q = $('#quitBtn')
  if (q) { $('.sc-hud').append(q); q.classList.add('icon-btn') }
  ui = {
    round: state.round, route, theme: route.theme, snaps: [], last: g, me: state.you,
    mapCache: null, objs: null, trail: [], tab: null, seen: new Set(), first: true,
    steer: 0, keySteer: 0, lastPhase: null, hitAt: 0, callAt: {}, happyAt: 0, prevMet: new Map(),
    bannerUntil: 0, lastCount: -1, endSeen: false, edges: [], bubbles: {}, meTag: null, shotFx: [], lastFrame: performance.now()
  }

  // 3D（使えなければ 2D）
  const cv = $('#sc-cv')
  ui.v3 = null
  if (!use2D()) {
    try { ui.v3 = createView3D(cv, { theme: route.theme, n: g.n, mySeat: g.seat, len: g.len, w: g.w }) } catch (e) { console.warn('3D を使えないので 2D で描く', e); ui.v3 = null }
  }
  if (!ui.v3) ui.ctx = cv.getContext('2d')
  $('#sc').dataset.mode = ui.v3 ? '3d' : '2d'
  ui.ro = new ResizeObserver(() => requestAnimationFrame(sizeAll))
  ui.ro.observe($('#sc-view')); ui.ro.observe($('#sc-dock'))

  // 音
  const mute = $('#sc-mute')
  const paintMute = () => { mute.innerHTML = icon(snd.isMuted() ? 'soundOff' : 'soundOn'); mute.setAttribute('aria-label', snd.isMuted() ? '音を出す' : '音を消す') }
  paintMute()
  mute.onclick = () => { snd.toggleMute(); paintMute() }

  // 操縦: 切り替え式（押すと曲がりっぱなし、もう1回かまっすぐで戻る）
  for (const b of document.querySelectorAll('.steer .kbtn')) b.addEventListener('pointerdown', e => {
    e.preventDefault()
    const d = Number(b.dataset.dir)
    setSteer(d !== 0 && ui.steer === d ? 0 : d)
    snd.sfx.steer()
  })
  // エンジン
  for (const b of document.querySelectorAll('.lever .kbtn')) b.addEventListener('pointerdown', e => { e.preventDefault(); const lv = Number(b.dataset.lv); send({ type: 'throttle', level: lv }); snd.sfx.lever(lv) })
  $('#eng-vent').addEventListener('pointerdown', e => { e.preventDefault(); send({ type: 'vent' }); snd.sfx.vent() })
  // 修理
  for (const b of document.querySelectorAll('.tile')) b.addEventListener('pointerdown', e => { e.preventDefault(); repairTap(b.dataset.sys, b) })
  // ナビ: 目印
  $('#cv-nav').addEventListener('pointerdown', e => {
    e.preventDefault()
    const w = navToWorld(e)
    if (w) { send({ type: 'mark', x: w.x, y: w.y }); snd.sfx.mark() }
  })
  // 防衛: 上の画面をタップした方向に撃つ
  cv.addEventListener('pointerdown', e => {
    if (!ui.last || !ui.last.roles.includes('defense') || ui.tab !== 'defense') return
    e.preventDefault()
    const r = cv.getBoundingClientRect()
    const s = interpShip()
    let wx, wy
    if (ui.v3) { const p = ui.v3.pick(e.clientX - r.left, e.clientY - r.top); wx = p.x; wy = p.y }
    else { const p = from2D(e.clientX - r.left, e.clientY - r.top, r.width, r.height, s); wx = p.x; wy = p.y }
    fire(Math.atan2(wx - s.x, wy - s.y))
  })
  $('#def-auto').addEventListener('pointerdown', e => { e.preventDefault(); autoFire() })
  // ネコ
  $('#sc-cat').addEventListener('pointerdown', e => {
    e.preventDefault(); send({ type: 'shoo' }); snd.sfx.shoo()
    const c = $('#sc-cat'); c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit')
  })

  if (!build.keys) {
    build.keys = true
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', () => { if (ui && ui.keySteer) { ui.keySteer = 0; setSteer(0) } })
    requestAnimationFrame(frame)
  }
  window.__scv = { // e2e と検証用
    mode: () => ui && (ui.v3 ? '3d' : '2d'),
    variance: () => ui && ui.v3 ? ui.v3.variance() : variance2D(),
    fps: () => ui && ui.v3 ? ui.v3.fps() : 0,
    tier: () => ui && ui.v3 ? ui.v3.tier : -1
  }
}

function sizeAll() {
  if (!ui) return
  const view = $('#sc-view')
  if (!view) return
  const r = view.getBoundingClientRect()
  if (ui.v3) ui.v3.setSize(Math.round(r.width), Math.round(r.height))
  else {
    const c = $('#sc-cv'), dpr = Math.min(2, devicePixelRatio || 1)
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr)
    ui.dpr = dpr; ui.vw = r.width; ui.vh = r.height
  }
  const nc = $('#cv-nav')
  if (nc && nc.offsetParent) {
    const rr = nc.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1)
    nc.width = Math.round(rr.width * dpr); nc.height = Math.round(rr.height * dpr)
    ui.navDpr = dpr; ui.navW = rr.width; ui.navH = rr.height
  }
}

function setSteer(dir) {
  if (!ui) return
  ui.steer = dir
  paintSteer(dir)
  send({ type: 'steer', dir })
}
function paintSteer(dir) {
  for (const b of document.querySelectorAll('.steer .kbtn')) b.setAttribute('aria-pressed', Number(b.dataset.dir) === dir ? 'true' : 'false')
}
function repairTap(sys, el) {
  if (!ui || !ui.last || ui.last.sys[sys] < 0) return
  send({ type: 'repair', sys })
  snd.sfx.clank()
  if (el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump') }
}
function fire(a) {
  const g = ui && ui.last
  if (!g) return
  send({ type: 'fire', a: Math.round(a * 1000) / 1000 })
  if (g.sys.cannon < 0 && !(g.cd && g.cd.fire > 0.05) && g.energy >= 6) { ui.shotFx.push({ a, t: performance.now() }); snd.sfx.fire() }
}
// 一番近い隕石を先読みして撃つ（直前の2つの状態から速さを出す）
function autoFire() {
  const g = ui && ui.last
  if (!g || !g.meteors || !g.meteors.length) return
  const s = interpShip()
  const prev = ui.snaps.length > 1 ? new Map((ui.snaps.at(-2).g.meteors || []).map(m => [m[0], m])) : new Map()
  let best = null
  for (const m of g.meteors) { const d = Math.hypot(m[1] - s.x, m[2] - s.y); if (!best || d < best.d) best = { d, m } }
  const m = best.m, p = prev.get(m[0])
  const vx = p ? (m[1] - p[1]) / (TICK_MS / 1000) : 0, vy = p ? (m[2] - p[2]) / (TICK_MS / 1000) : 0
  const tt = best.d / 900
  fire(Math.atan2(m[1] + vx * tt - s.x, m[2] + vy * tt - s.y))
}

function onKey(e) {
  if (document.body.dataset.screen !== 'game' || !ui || !ui.last || e.target.tagName === 'INPUT') return
  const k = e.key, g = ui.last
  if (k === 'Tab' && g.roles.length > 1) { e.preventDefault(); const rs = sortedRoles(g.roles); setTab(rs[(rs.indexOf(ui.tab) + (e.shiftKey ? rs.length - 1 : 1)) % rs.length]); return }
  if (g.cat && g.cat.me && (k === ' ' || k === 'Enter')) { e.preventDefault(); send({ type: 'shoo' }); return }
  const tab = ui.tab
  if (tab === 'helm') {
    const d = (k === 'ArrowLeft' || k === 'a' || k === 'A') ? -1 : (k === 'ArrowRight' || k === 'd' || k === 'D') ? 1 : (k === 'ArrowUp' || k === 'w' || k === 'W') ? 0 : null
    if (d !== null) { e.preventDefault(); if (!e.repeat) { ui.keySteer = d; setSteer(d) } }
  } else if (tab === 'engine') {
    if (['1', '2', '3', '4'].includes(k)) send({ type: 'throttle', level: Number(k) - 1 })
    if (k === 'v' || k === 'V' || k === ' ') { e.preventDefault(); send({ type: 'vent' }) }
  } else if (tab === 'repair') {
    const i = Number(k) - 1
    if (i >= 0 && i < SYSTEMS.length && !e.repeat) repairTap(SYSTEMS[i], document.querySelector(`.tile[data-sys="${SYSTEMS[i]}"]`))
  } else if (tab === 'defense' && k === ' ') { e.preventDefault(); autoFire() }
}
// PC のキーは押している間だけ曲がる（キーボードの定番）。画面のボタンは切り替え式
function onKeyUp(e) {
  if (!ui || ui.tab !== 'helm' || !ui.keySteer) return
  const k = e.key
  const d = (k === 'ArrowLeft' || k === 'a' || k === 'A') ? -1 : (k === 'ArrowRight' || k === 'd' || k === 'D') ? 1 : null
  if (d !== null && ui.keySteer === d) { ui.keySteer = 0; setSteer(0) }
}

function setTab(r) {
  if (!ui) return
  ui.tab = r
  for (const p of document.querySelectorAll('.pn')) p.hidden = p.dataset.role !== r
  for (const b of document.querySelectorAll('.sc-tabs button')) b.setAttribute('aria-selected', b.dataset.role === r ? 'true' : 'false')
  $('#sc').dataset.tab = r
  renderCalls()
  requestAnimationFrame(sizeAll)
}

// ---- 状態が届いたとき
export function render(state, { send: s }) {
  sendFn = s
  if (!ui || ui.round !== state.round || !$('#sc')) build(state)
  const g = state.game
  if (!g) return
  const now = performance.now()
  const prev = ui.last
  ui.last = g
  window.__sc = g // e2e の確認用（自分に届いた状態だけ。秘密は入っていない）
  ui.snaps.push({ at: now, g })
  if (ui.snaps.length > 6) ui.snaps.shift()
  if (g.map) { ui.mapCache = g.map; window.__scMap = g.map }
  if (g.objs) ui.objs = g.objs
  if (g.phase === 'fly' && (!ui.trail.length || Math.hypot(ui.trail.at(-1)[0] - g.ship.x, ui.trail.at(-1)[1] - g.ship.y) > 60)) { ui.trail.push([g.ship.x, g.ship.y]); if (ui.trail.length > 400) ui.trail.shift() }
  // 消えた隕石: 船の近くなら命中（別の合図で出す）、離れていれば撃ち落とした
  const curMet = new Map((g.meteors || []).map(m => [m[0], m]))
  for (const [id, m] of ui.prevMet) {
    if (curMet.has(id)) continue
    const d = Math.hypot(m[1] - g.ship.x, m[2] - g.ship.y)
    if (d > 70 && d < (SIGHT[g.roles.includes('defense') ? 'defense' : 'helm']) - 60) { if (ui.v3) ui.v3.burst(m[1], m[2], 'rock'); snd.sfx.boom() }
  }
  ui.prevMet = curMet

  // 担当のタブ
  const rs = sortedRoles(g.roles)
  if (!ui.tab || !rs.includes(ui.tab)) setTab(rs[0])
  const tabs = $('#sc-tabs')
  const key = rs.join(',')
  if (tabs.dataset.key !== key) {
    tabs.dataset.key = key
    tabs.hidden = rs.length < 2
    tabs.replaceChildren(...rs.map(r => {
      const b = document.createElement('button')
      b.dataset.role = r
      b.innerHTML = `${icon(r)}<span>${ROLE_NAMES[r]}</span>`
      b.addEventListener('pointerdown', e => { e.preventDefault(); setTab(r) })
      return b
    }))
    setTab(ui.tab)
  }
  const broken = SYSTEMS.filter(k => g.sys[k] >= 0)
  for (const b of tabs.children) {
    const r = b.dataset.role
    const warn = (r === 'repair' && broken.length) || (r === 'engine' && g.heat >= 80) || (r === 'defense' && (g.meteors || []).length > 0) || (r === 'nav' && g.radar === false)
    b.classList.toggle('warn', !!warn)
    b.dataset.n = r === 'repair' && broken.length ? broken.length : '!'
  }

  hud(g, prev)
  alerts(g, broken)
  feed(g)
  panels(g)
  brief(g, state)
  catPanel(g)
  if (g.phase !== ui.lastPhase) {
    if (g.phase === 'fly') { snd.startBgm(ui.theme); if (ui.lastPhase === 'brief') { snd.sfx.go(); banner('発進！', ui.route.name, 'good', 1400) } }
    if (g.phase === 'end' && g.end && !ui.endSeen) {
      ui.endSeen = true
      snd.stopBgm()
      const W = { arrive: ['到着！', 'ビーコンにタッチ'], hull: ['大破！', '船がバラバラに'], o2: ['酸素切れ…', 'みんな青い顔'], time: ['時間切れ…', 'ビーコンが遠い'] }[g.end.win ? 'arrive' : g.end.reason] || ['おわり', '']
      banner(W[0], W[1], g.end.win ? 'good' : 'bad', 4000)
      if (g.end.win) snd.sfx.win(); else if (g.end.reason === 'hull') { snd.sfx.explode(); setTimeout(() => snd.sfx.lose(), 700) } else snd.sfx.lose()
      navigator.vibrate?.(g.end.win ? [40, 60, 40] : 300)
    }
    ui.lastPhase = g.phase
  }
  ui.first = false
}

function hud(g, prev) {
  meter('hull', g.hull, g.hull <= 30)
  meter('energy', g.energy, g.energy <= 15)
  meter('o2', g.o2, g.o2 <= 40)
  const t = $('#sc-time')
  t.textContent = g.phase === 'brief' ? Math.ceil(g.limit) : Math.ceil(g.left)
  $('#sc-timer').classList.toggle('low', g.phase === 'fly' && g.left <= 20)
  if (prev && g.limit > prev.limit) {
    const p = document.createElement('span'); p.className = 'plus'; p.textContent = '+' + (g.limit - prev.limit) + '秒'
    $('#sc-timer').append(p); setTimeout(() => p.remove(), 1500)
  }
  // 進み具合（目的地までの距離で測る）
  const total = Math.hypot(g.goal.x, g.goal.y) || 1
  const prog = Math.max(0, Math.min(1, 1 - g.dist / total))
  $('#sc-progBar').style.width = (prog * 100) + '%'
  $('#sc-progShip').style.left = `calc(${prog} * (100% - 22px))`
  const gk = g.gates.join() + '|' + g.sec
  const gEl = $('#sc-gates')
  if (gEl.dataset.k !== gk) {
    gEl.dataset.k = gk
    gEl.innerHTML = g.gates.map((y, i) => `<i class="prog-gate${i < g.sec ? ' done' : ''}" style="left:calc(${y / g.len} * (100% - 22px))"></i>`).join('')
  }
  $('#sc-sec').textContent = `区間 ${Math.min(g.secs, g.sec + 1)}/${g.secs}`
  // 危険の気配（画面の縁が光る）
  $('#sc-fx').dataset.z = g.phase !== 'fly' ? '' : g.out ? 'out' : g.zone || (g.well ? 'well' : '')
}
function meter(k, v, low) {
  const m = document.querySelector(`.meter[data-k="${k}"]`)
  m.querySelector('b').style.width = Math.max(0, Math.min(100, v)) + '%'
  m.querySelector('.mv').textContent = v
  m.classList.toggle('low', low)
}

function alerts(g, broken) {
  const box = $('#sc-alerts')
  const evk = g.ev ? g.ev[0] + (g.ev[1] > 0 ? 'w' : '') : ''
  const akey = broken.join(',') + '|' + (g.zone || '') + (g.out ? 'o' : '') + (g.well ? 'w' : '') + evk
  if (box.dataset.key === akey) return
  box.dataset.key = akey
  const chips = broken.map(k => {
    const b = document.createElement('button')
    b.className = 'chip bad'; b.dataset.sys = k
    b.innerHTML = `${icon(k)}<span>${SYSTEM_NAMES[k]} 故障</span>`
    b.setAttribute('aria-label', `${SYSTEM_NAMES[k]}の修理を頼む`)
    b.addEventListener('pointerdown', e => { e.preventDefault(); send({ type: 'call', id: 'fix:' + k }); snd.sfx.call() })
    return b
  })
  const span = (cls, text) => { const z = document.createElement('span'); z.className = 'chip zone ' + cls; z.textContent = text; return z }
  if (g.ev && g.ev[0] !== 'cat') chips.unshift(span(g.ev[0] === 'wind' ? 'storm' : '', (g.ev[1] > 0 ? 'まもなく ' : '') + EVENT_NAMES[g.ev[0]]))
  if (g.well) chips.unshift(span('well', '重力井戸 吸い込まれる'))
  if (g.zone) chips.unshift(span(g.zone, g.zone === 'field' ? '岩場 船体が削れる' : '電磁嵐 故障しやすい'))
  if (g.out) chips.unshift(span('out', '航路の外 戻って'))
  if (!chips.length) { const ok = document.createElement('span'); ok.className = 'chip ok'; ok.textContent = '全装置 正常'; chips.push(ok) }
  box.replaceChildren(...chips)
}

function feed(g) {
  const now = performance.now()
  const items = [...g.calls.map(c => ({ ...c, kind: 'call' })), ...g.events]
  for (const it of items) {
    if (ui.seen.has(it.id)) continue
    ui.seen.add(it.id)
    if (ui.first) continue
    if (it.kind === 'call') { snd.sfx.call(); ui.callAt[it.by] = { at: now, text: it.text, from: it.from } }
    else if (it.kind === 'fail') { snd.sfx.fail(); navigator.vibrate?.(80) }
    else if (it.kind === 'fixed') { snd.sfx.fixed(); ui.happyAt = now }
    else if (it.kind === 'pod') { snd.sfx.pod(); ui.happyAt = now }
    else if (it.kind === 'gate') { snd.sfx.gate(); ui.happyAt = now; banner('中継ライン通過', it.text.replace('中継ライン通過 ', ''), 'good', 1800) }
    else if (it.kind === 'warn') { snd.sfx.warn(); if (/来る/.test(it.text)) banner(it.text, '気をつけて', 'bad', 1800) }
    else if (it.kind === 'cat') { snd.sfx.meow(); banner('宇宙ネコ襲来', it.text.replace('宇宙ネコが', '').replace('の操作盤に乗った', 'の操作盤に乗った'), 'cat', 2000) }
    else if (it.kind === 'hit') {
      snd.sfx.hit(); navigator.vibrate?.([60, 40, 60]); ui.hitAt = now
      if (ui.v3) ui.v3.burst(g.ship.x, g.ship.y, 'hit')
      const sc = $('#sc'); sc.classList.remove('shake'); void sc.offsetWidth; sc.classList.add('shake')
    }
  }
  const box = $('#sc-feed')
  const show = [...g.calls.map(c => ({ id: c.id, cls: 'call', html: `<b style="color:${CREW_COLORS[c.by] || '#4fd8ff'}">${esc(c.from)}</b>${esc(c.text)}` })),
    ...g.events.filter(e => e.kind !== 'info').map(e => ({ id: e.id, cls: e.kind, html: esc(e.text) }))]
    .sort((a, b) => b.id - a.id).slice(0, 2).reverse()
  const key = show.map(s => s.id).join(',')
  if (box.dataset.key === key) return
  box.dataset.key = key
  box.innerHTML = show.map(s => `<p class="fd ${s.cls}">${s.html}</p>`).join('')
}

function banner(text, small, kind, ms) {
  const b = $('#sc-banner')
  if (!b) return
  b.innerHTML = `${esc(text)}${small ? `<small>${esc(small)}</small>` : ''}`
  b.dataset.k = kind || ''
  b.hidden = false
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''
  clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true }, ms || 1600)
}

function renderCalls() {
  const box = $('#sc-calls')
  if (!box || !ui || !ui.last) return
  const ids = [...new Set([...(ROLE_CALLS[ui.tab] || []), 'help', 'nice', 'sorry'])]
  const key = ui.tab + ids.join()
  if (box.dataset.key === key) return
  box.dataset.key = key
  box.replaceChildren(...ids.map(id => {
    const b = document.createElement('button')
    b.className = 'call-btn'
    b.dataset.call = id
    b.textContent = CALL_TEXT[id]
    b.addEventListener('pointerdown', e => { e.preventDefault(); send({ type: 'call', id }); b.classList.add('sent'); setTimeout(() => b.classList.remove('sent'), 400) })
    return b
  }))
}

function panels(g) {
  renderCalls()
  const flying = g.phase === 'fly'
  // 操縦（サーバーの舵の状態に合わせる）
  if (g.steer !== ui.steer && !ui.keySteer) ui.steer = g.steer
  paintSteer(ui.steer)
  const hh = $('#helm-hint')
  hh.textContent = g.sys.helm >= 0 ? '操舵装置が故障中。舵が効かない' : g.cat && g.cat.me ? 'ネコをどかして' : ui.steer < 0 ? '左へ曲がり中。もう1回押すとまっすぐ' : ui.steer > 0 ? '右へ曲がり中。もう1回押すとまっすぐ' : '1回押すと曲がりっぱなし。もう1回で戻る'
  hh.classList.toggle('bad', g.sys.helm >= 0)
  // エンジン
  for (const b of document.querySelectorAll('.lever .kbtn')) b.setAttribute('aria-pressed', Number(b.dataset.lv) === g.throttle ? 'true' : 'false')
  gauge('#eng-heat', g.heat, g.heat >= 80)
  gauge('#eng-energy', g.energy, g.energy <= 15)
  const vent = $('#eng-vent')
  vent.disabled = !flying || !!(g.cd && g.cd.vent > 0) || g.energy < 12
  vent.querySelector('span').textContent = g.cd && g.cd.vent > 0 ? `冷却 ${g.cd.vent.toFixed(1)}` : '冷却'
  const em = $('#eng-msg')
  em.textContent = g.sys.engine >= 0 ? 'エンジン故障中。速度が出ない' : g.heat >= 80 ? '過熱寸前。出力を下げるか冷却' : g.energy <= 0 ? '電力切れ。低速までしか出ない' : `速度 ${g.ship.v}`
  em.classList.toggle('bad', g.sys.engine >= 0 || g.heat >= 80 || g.energy <= 0)
  // 修理
  let nb = 0
  for (const t of document.querySelectorAll('.tile')) {
    const v = g.sys[t.dataset.sys]
    const br = v >= 0
    if (br) nb++
    t.classList.toggle('broken', br)
    t.querySelector('.tbar b').style.width = (br ? v : 100) + '%'
    t.setAttribute('aria-label', `${SYSTEM_NAMES[t.dataset.sys]} ${br ? '故障 修理' + v + '%' : '正常'}`)
  }
  const rh = $('#rep-hint')
  rh.textContent = nb ? `${nb}か所が故障。どれから直すか決めて連打` : 'いまは全部正常。故障したら連打で直す'
  rh.classList.toggle('bad', nb > 0)
  // ナビ
  $('#nav-hint').textContent = g.radar === false ? 'センサー故障中。地図が見えない' : '地図をタップすると、みんなの画面に目印が立つ'
  $('#nav-hint').classList.toggle('bad', g.radar === false)
  // 防衛
  const dh = $('#def-hint')
  const cannonBad = g.sys.cannon >= 0, lowE = g.energy < 6
  dh.textContent = cannonBad ? '砲台が故障中。撃てない' : lowE ? '電力が足りなくて撃てない' : (g.meteors || []).length ? `隕石 ${(g.meteors || []).length}個。上の画面をタップして撃つ` : '上の画面で隕石をタップして撃つ'
  dh.classList.toggle('bad', cannonBad || lowE)
  $('#def-auto').disabled = cannonBad || !flying
}
function gauge(sel, v, low) {
  const el = $(sel)
  el.querySelector('b').style.width = Math.max(0, Math.min(100, v)) + '%'
  el.querySelector('.gv').textContent = v
  el.classList.toggle('low', low)
}

function brief(g, state) {
  const el = $('#sc-brief')
  if (g.phase !== 'brief') { el.hidden = true; return }
  el.hidden = false
  const key = g.roles.join() + '|' + g.crew.length
  if (el.dataset.key !== key) {
    el.dataset.key = key
    $('#brief-route').textContent = `${ui.route.name}　${ui.route.lead}`
    $('#brief-roles').innerHTML = sortedRoles(g.roles).map(r => `<div class="br">${icon(r)}<div><strong>${ROLE_NAMES[r]}</strong><p>${ROLE_DESC[r]}</p></div></div>`).join('')
    $('#brief-crew').innerHTML = g.crew.map(c => `<li${c.id === state.you ? ' class="me"' : ''}><i style="background:${CREW_COLORS[c.seat]}"></i><span>${esc(c.name)}</span><small>${sortedRoles(c.roles).map(r => ROLE_NAMES[r]).join('・')}</small></li>`).join('')
    el.classList.toggle('many', g.roles.length > 2)
  }
  const n = Math.ceil(g.brief)
  $('#brief-count').textContent = `発進まで ${n}`
  if (n !== ui.lastCount) { ui.lastCount = n; if (!ui.first) snd.sfx.count() }
}

function catPanel(g) {
  const el = $('#sc-cat')
  const on = !!(g.cat && g.cat.me && g.phase === 'fly')
  el.hidden = !on
  if (on) $('#sc-catPips').innerHTML = [...Array(6)].map((_, i) => `<i class="${i < g.cat.hp ? '' : 'off'}"></i>`).join('')
}

// ---- 補間
function interp() {
  const snaps = ui.snaps
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
  const p = ui && interp()
  if (!p) return { x: 0, y: 0, h: 0, v: 0 }
  return { x: lerp(p.a.ship.x, p.b.ship.x, p.u), y: lerp(p.a.ship.y, p.b.ship.y, p.u), h: lerpAng(p.a.ship.h, p.b.ship.h, p.u), v: lerp(p.a.ship.v, p.b.ship.v, p.u) }
}
function interpList(key) {
  const p = interp()
  if (!p || !p.b[key]) return []
  const prev = new Map((p.a[key] || []).map(m => [m[0], m]))
  return p.b[key].map(m => { const o = prev.get(m[0]); return o ? [m[0], lerp(o[1], m[1], p.u), lerp(o[2], m[2], p.u)] : m })
}

// クルーの表情（席ごと）
function exprFor(seat, roles, g, now) {
  if (g.phase === 'end' && g.end) return g.end.win ? 'happy' : { hull: 'dizzy', o2: 'gasp', time: 'cry' }[g.end.reason] || 'cry'
  if (g.cat && g.cat.seat === seat) return 'annoyed'
  if (now - ui.hitAt < 900) return 'shock'
  const c = ui.callAt[seat]
  if (c && now - c.at < 1300) return 'shout'
  if (g.o2 < 30) return 'gasp'
  if (g.hull < 30) return 'panic'
  if (g.zone === 'storm' || g.well) return 'dizzy'
  const mine = (roles.includes('helm') && g.sys.helm >= 0) || (roles.includes('engine') && (g.sys.engine >= 0 || g.heat >= 85)) || (roles.includes('nav') && g.sys.radar >= 0) || (roles.includes('defense') && g.sys.cannon >= 0) || (roles.includes('repair') && SYSTEMS.some(k => g.sys[k] >= 0))
  if (mine) return 'panic'
  if (now - ui.happyAt < 1500) return 'happy'
  return 'normal'
}

// ---- 毎フレーム
function frame() {
  requestAnimationFrame(frame)
  if (!ui || document.body.dataset.screen !== 'game' || !ui.last || !$('#sc')) return
  const now = performance.now()
  const dt = Math.min(0.1, (now - ui.lastFrame) / 1000); ui.lastFrame = now
  const g = ui.last, s = interpShip()
  const meteors = interpList('meteors'), bolts = interpList('bolts')
  let out = null
  if (ui.v3) {
    const expr = []
    for (const c of g.crew) expr[c.seat] = exprFor(c.seat, c.roles, g, now)
    out = ui.v3.frame({ now, dt, s, g, meteors, bolts, map: g.roles.includes('nav') ? ui.mapCache : null, objs: ui.objs, got: g.got, gates: g.gates, goal: g.goal, expr, hitAt: ui.hitAt })
  } else draw2D(s, g, meteors, bolts)
  labels(out, g, s, meteors, now)
  if (ui.tab === 'nav') drawNav(s, g)
}

// 3D の上に重ねる札（吹き出し・自分の印・画面外の矢印）
function labels(out, g, s, meteors, now) {
  const box = $('#sc-labels')
  const W = box.clientWidth, H = box.clientHeight
  const used = new Set()
  // 吹き出し（重ならないように新しい2つだけ。古いほうは上へずらす）
  const live = g.crew.filter(c => ui.callAt[c.seat] && now - ui.callAt[c.seat].at < 2600).sort((a, b) => ui.callAt[b.seat].at - ui.callAt[a.seat].at).slice(0, 2).map(c => c.seat)
  for (const c of g.crew) {
    const call = ui.callAt[c.seat]
    let el = ui.bubbles[c.seat]
    const on = live.includes(c.seat)
    if (!on) { if (el) el.hidden = true; continue }
    const p = out ? out.crew[c.seat] : { x: W / 2 + (c.seat - (g.n - 1) / 2) * 34, y: H * 0.62, behind: false }
    if (!p) continue
    if (!el) { el = ui.bubbles[c.seat] = document.createElement('div'); el.className = 'bub'; box.append(el) }
    if (el.dataset.at !== String(call.at)) { el.dataset.at = call.at; el.innerHTML = `<small style="--c:${CREW_COLORS[c.seat]}">${esc(call.from)}</small>${esc(call.text)}`; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '' }
    el.hidden = false
    // 何人も同時にしゃべると重なるので、席ごとに少しずつ上へずらす
    const k = live.indexOf(c.seat)
    const x = Math.max(70, Math.min(W - 70, p.x + (live.length > 1 ? (k ? -1 : 1) * 46 : 0)))
    el.style.transform = `translate(${x}px, ${Math.max(Math.min(100, H * 0.4), p.y - 10 - k * 40)}px) translate(-50%, -100%)`
  }
  // 自分
  const meSeat = g.seat
  if (!ui.meTag) { ui.meTag = document.createElement('div'); ui.meTag.className = 'me-tag'; ui.meTag.textContent = 'あなた'; box.append(ui.meTag) }
  const mp = out && out.crew[meSeat]
  const meOn = mp && !mp.behind && g.phase !== 'end' && !(ui.callAt[meSeat] && now - ui.callAt[meSeat].at < 2600)
  ui.meTag.hidden = !meOn
  if (meOn) ui.meTag.style.transform = `translate(${mp.x}px, ${mp.y - 4}px) translate(-50%, -100%)`
  // 画面外の矢印
  const arrows = []
  if (out) {
    arrows.push({ p: out.goal, c: '#3ef0b0', k: 'goal' })
    if (out.marker) arrows.push({ p: out.marker, c: '#4fd8ff', k: 'mark' })
    out.meteors.forEach((p, i) => arrows.push({ p, c: '#ff4a5e', k: 'm' + i }))
  }
  let n = 0
  for (const a of arrows) {
    const { x, y, behind } = a.p
    const m = 26, top = Math.min(110, H * 0.35) // 上の帯（HUD）の下から
    const inside = !behind && x > m && x < W - m && y > top && y < H - m
    if (inside) continue
    let dx = x - W / 2, dy = y - H / 2
    if (behind) { dx = -dx; dy = Math.abs(dy) + H }
    const k = Math.min(Math.abs((W / 2 - m) / (dx || 1e-6)), Math.abs(((dy < 0 ? H / 2 - top : H / 2 - m)) / (dy || 1e-6)))
    const ex = W / 2 + dx * k, ey = H / 2 + dy * k
    let el = ui.edges[n]
    if (!el) { el = ui.edges[n] = document.createElement('div'); el.className = 'edge'; el.innerHTML = '<svg viewBox="0 0 26 26"><path d="M24 13L4 3l5 10-5 10z" stroke="#140c33" stroke-width="2.4" stroke-linejoin="round"/></svg>'; box.append(el) }
    el.hidden = false
    el.querySelector('path').setAttribute('fill', a.c)
    el.style.transform = `translate(${ex}px, ${ey}px) rotate(${Math.atan2(dy, dx)}rad)`
    used.add(n); n++
  }
  for (let i = n; i < ui.edges.length; i++) ui.edges[i].hidden = true
}

// ---- 2D の保険（WebGL が使えない端末）。船を中心に、進む向きを上にして描く
const COL = { bg: '#0d0826', cyan: '#4fd8ff', amber: '#ff8a1f', red: '#ff4a5e', green: '#3ef0b0', violet: '#c86bff', rust: '#e0925c', muted: '#b3a9e0', sun: '#ffd23f' }
function hash(x, y) { let n = (x * 374761393 + y * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
function fit2D(w, h) { const cx = w / 2, cy = h * 0.68; return { cx, cy, sc: Math.min(cy / 520, (w / 2) / 360) } }
function toLocal(s, x, y, cx, cy, sc) {
  const wx = x - s.x, wy = y - s.y, c = Math.cos(s.h), sn = Math.sin(s.h)
  return [cx + (wx * c - wy * sn) * sc, cy - (wx * sn + wy * c) * sc]
}
function from2D(px, py, w, h, s) {
  const { cx, cy, sc } = fit2D(w, h)
  const lx = (px - cx) / sc, ly = (cy - py) / sc, c = Math.cos(s.h), sn = Math.sin(s.h)
  return { x: s.x + lx * c + ly * sn, y: s.y - lx * sn + ly * c }
}
function shipPath(ctx, x, y, sz, rot, col, thrust) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot)
  if (thrust > 0) { ctx.fillStyle = `rgba(255,170,70,${0.4 + Math.random() * 0.3})`; ctx.beginPath(); ctx.moveTo(-sz * 0.35, sz * 0.75); ctx.lineTo(0, sz * (0.9 + thrust * 1.1)); ctx.lineTo(sz * 0.35, sz * 0.75); ctx.fill() }
  ctx.fillStyle = '#f6f1e7'; ctx.strokeStyle = '#140c33'; ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.62, sz * 0.55); ctx.lineTo(sz * 0.22, sz * 0.8); ctx.lineTo(-sz * 0.22, sz * 0.8); ctx.lineTo(-sz * 0.62, sz * 0.55); ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -sz * 0.2, sz * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.restore()
}
function rock(ctx, x, y, r, id, col) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#6a4a3a'; ctx.strokeStyle = col; ctx.lineWidth = 2
  ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + id, rr = r * (0.75 + hash(id, i) * 0.4); i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) }
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore()
}
function draw2D(s, g, meteors, bolts) {
  const ctx = ui.ctx, c = $('#sc-cv')
  if (!ctx || !ui.vw) return
  const w = ui.vw, h = ui.vh
  ctx.setTransform(ui.dpr, 0, 0, ui.dpr, 0, 0)
  const { cx, cy, sc } = fit2D(w, h)
  const L = (x, y) => toLocal(s, x, y, cx, cy, sc)
  const grd = ctx.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#1d1450'); grd.addColorStop(1, '#070418')
  ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h)
  const cell = 120, R = 800
  for (let gx = Math.floor((s.x - R) / cell); gx <= Math.floor((s.x + R) / cell); gx++) for (let gy = Math.floor((s.y - R) / cell); gy <= Math.floor((s.y + R) / cell); gy++) {
    const r = hash(gx, gy); if (r > 0.7) continue
    const [px, py] = L((gx + hash(gy, gx)) * cell, (gy + hash(gx + 7, gy - 3)) * cell)
    ctx.fillStyle = `rgba(220,226,255,${0.3 + r * 0.6})`; ctx.fillRect(px, py, r < 0.08 ? 2.4 : 1.4, r < 0.08 ? 2.4 : 1.4)
  }
  // 航路の端・中継ライン
  ctx.lineWidth = 2
  for (const ex of [-g.w, g.w]) { ctx.strokeStyle = 'rgba(255,74,94,.7)'; ctx.setLineDash([8, 8]); const [ax, ay] = L(ex, s.y - 900), [bx, by] = L(ex, s.y + 900); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke() }
  g.gates.forEach((y, i) => { ctx.strokeStyle = i < g.sec ? COL.green : COL.sun; ctx.setLineDash([12, 6]); const [ax, ay] = L(-g.w, y), [bx, by] = L(g.w, y); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke() })
  ctx.setLineDash([])
  // 危険地帯（ナビだけ）・井戸・補給
  if (g.roles.includes('nav') && g.radar !== false) for (const [k, x, y, r] of ui.mapCache || []) {
    const [px, py] = L(x, y); ctx.fillStyle = k === 'field' ? 'rgba(224,146,92,.25)' : 'rgba(200,107,255,.22)'; ctx.strokeStyle = k === 'field' ? COL.rust : COL.violet
    ctx.beginPath(); ctx.arc(px, py, r * sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  }
  for (const o of ui.objs || []) {
    const [px, py] = L(o[2], o[3])
    if (o[0] === 'well') { const gg = ctx.createRadialGradient(px, py, 0, px, py, o[4] * sc); gg.addColorStop(0, '#000'); gg.addColorStop(1, 'rgba(120,60,200,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(px, py, o[4] * sc, 0, Math.PI * 2); ctx.fill() }
    else if (!(g.got || []).includes(o[1])) { ctx.fillStyle = { hull: COL.amber, o2: COL.cyan, energy: COL.sun }[o[0]]; ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill() }
  }
  const [gx, gy] = L(g.goal.x, g.goal.y)
  ctx.strokeStyle = COL.green; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(gx, gy, 200 * sc, 0, Math.PI * 2); ctx.stroke()
  if (g.marker) { const [mx, my] = L(g.marker.x, g.marker.y); ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.PI / 4); ctx.strokeStyle = COL.cyan; ctx.lineWidth = 3; ctx.strokeRect(-9, -9, 18, 18); ctx.restore() }
  for (const m of meteors) { const [x, y] = L(m[1], m[2]); rock(ctx, x, y, 22 * sc * 1.2, m[0], COL.red) }
  ctx.fillStyle = COL.sun; for (const b of bolts) { const [x, y] = L(b[1], b[2]); ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill() }
  shipPath(ctx, cx, cy, Math.max(18, 28 * sc * 1.3), 0, COL.cyan, s.v / 105)
  // 撃った線
  const now = performance.now()
  ui.shotFx = ui.shotFx.filter(f => now - f.t < 250)
  for (const f of ui.shotFx) { const la = f.a - s.h; ctx.strokeStyle = `rgba(255,210,63,${1 - (now - f.t) / 250})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(la) * 400, cy - Math.cos(la) * 400); ctx.stroke() }
  void c
}
function variance2D() {
  const c = $('#sc-cv'); if (!c || !ui || !ui.ctx) return 0
  const d = ui.ctx.getImageData(0, 0, c.width, c.height).data
  let s1 = 0, s2 = 0, n = 0
  for (let i = 0; i < d.length; i += 4 * 97) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; s1 += l; s2 += l * l; n++ }
  return s2 / n - (s1 / n) ** 2
}

// ---- ナビの地図（北＝目的地の方向が上。地図なので固定）
function navFit(w, h, g) {
  const ww = g.w * 2 + 200, wh = g.len + 900
  const sc = Math.min((w - 12) / ww, (h - 12) / wh)
  const ox = w / 2, oy = h / 2 + (g.len / 2 + 150) * sc
  return { sc, X: x => ox + x * sc, Y: y => oy - y * sc, ix: px => (px - ox) / sc, iy: py => (oy - py) / sc }
}
function navToWorld(e) {
  if (!ui || !ui.last) return null
  const r = e.currentTarget.getBoundingClientRect()
  const f = navFit(r.width, r.height, ui.last)
  return { x: Math.round(f.ix(e.clientX - r.left)), y: Math.round(f.iy(e.clientY - r.top)) }
}
function drawNav(s, g) {
  const c = $('#cv-nav')
  if (!c || !ui.navW) { sizeAll(); return }
  const ctx = c.getContext('2d'), w = ui.navW, h = ui.navH
  if (w < 40 || h < 40) return // 大きさが決まる前（負の半径で WebKit が例外を出す）
  ctx.setTransform(ui.navDpr, 0, 0, ui.navDpr, 0, 0)
  ctx.fillStyle = '#061626'; ctx.fillRect(0, 0, w, h)
  if (g.radar === false) {
    for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(179,169,224,${Math.random() * 0.35})`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2) }
    ctx.fillStyle = COL.red; ctx.font = '900 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('センサー故障 地図が見えない', w / 2, h / 2)
    ctx.fillStyle = COL.muted; ctx.font = '700 13px system-ui, sans-serif'; ctx.fillText('修理の人に直してもらおう', w / 2, h / 2 + 22)
    return
  }
  const f = navFit(w, h, g)
  ctx.strokeStyle = 'rgba(79,216,255,.08)'; ctx.lineWidth = 1
  for (let y = 0; y <= g.len + 500; y += 500) { ctx.beginPath(); ctx.moveTo(f.X(-g.w), f.Y(y)); ctx.lineTo(f.X(g.w), f.Y(y)); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,74,94,.55)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5
  ctx.strokeRect(f.X(-g.w), f.Y(g.len + 600), g.w * 2 * f.sc, (g.len + 900) * f.sc); ctx.setLineDash([])
  g.gates.forEach((y, i) => { ctx.strokeStyle = i < g.sec ? COL.green : COL.sun; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(f.X(-g.w), f.Y(y)); ctx.lineTo(f.X(g.w), f.Y(y)); ctx.stroke() })
  for (const o of ui.objs || []) {
    if (o[0] === 'well') { ctx.fillStyle = 'rgba(200,107,255,.25)'; ctx.strokeStyle = COL.violet; ctx.beginPath(); ctx.arc(f.X(o[2]), f.Y(o[3]), o[4] * f.sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(f.X(o[2]), f.Y(o[3]), o[4] * f.sc * 0.24, 0, Math.PI * 2); ctx.fill() }
    else if (!(g.got || []).includes(o[1])) { ctx.fillStyle = { hull: COL.amber, o2: COL.cyan, energy: COL.sun }[o[0]]; ctx.beginPath(); ctx.arc(f.X(o[2]), f.Y(o[3]), 4, 0, Math.PI * 2); ctx.fill() }
  }
  for (const [k, x, y, r] of ui.mapCache || []) {
    const X = f.X(x), Y = f.Y(y), R = r * f.sc
    if (k === 'field') {
      ctx.fillStyle = 'rgba(224,146,92,.25)'; ctx.strokeStyle = COL.rust; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.fillStyle = COL.rust; for (let i = 0; i < 6; i++) { const a = hash(x + i, y) * Math.PI * 2, d = hash(y, x + i) * R * 0.8; ctx.fillRect(X + Math.cos(a) * d - 2, Y + Math.sin(a) * d - 2, 4, 4) }
    } else {
      ctx.fillStyle = 'rgba(200,107,255,.2)'; ctx.strokeStyle = COL.violet; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = COL.violet; ctx.beginPath(); ctx.moveTo(X + 2, Y - 8); ctx.lineTo(X - 4, Y + 1); ctx.lineTo(X + 1, Y + 1); ctx.lineTo(X - 2, Y + 8); ctx.lineTo(X + 5, Y - 2); ctx.lineTo(X, Y - 2); ctx.closePath(); ctx.fill()
    }
  }
  ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.X(g.goal.x), f.Y(g.goal.y), Math.max(7, 200 * f.sc), 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = COL.green; ctx.beginPath(); ctx.arc(f.X(g.goal.x), f.Y(g.goal.y), 3, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(255,138,31,.55)'; ctx.lineWidth = 2; ctx.beginPath()
  ui.trail.forEach(([x, y], i) => i ? ctx.lineTo(f.X(x), f.Y(y)) : ctx.moveTo(f.X(x), f.Y(y)))
  if (ui.trail.length) ctx.lineTo(f.X(s.x), f.Y(s.y))
  ctx.stroke()
  if (g.marker) {
    const mx = f.X(g.marker.x), my = f.Y(g.marker.y)
    ctx.strokeStyle = 'rgba(79,216,255,.6)'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(f.X(s.x), f.Y(s.y)); ctx.lineTo(mx, my); ctx.stroke(); ctx.setLineDash([])
    ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.PI / 4); ctx.strokeStyle = COL.cyan; ctx.lineWidth = 2.5; ctx.strokeRect(-6, -6, 12, 12); ctx.restore()
  }
  shipPath(ctx, f.X(s.x), f.Y(s.y), 10, s.h, COL.cyan, 0)
  ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(6,22,38,.85)'; ctx.fillRect(4, 4, 112, 20)
  ctx.fillStyle = COL.rust; ctx.fillRect(9, 10, 8, 8); ctx.fillStyle = '#fff'; ctx.fillText('岩場', 20, 14)
  ctx.fillStyle = COL.violet; ctx.fillRect(56, 10, 8, 8); ctx.fillStyle = '#fff'; ctx.fillText('電磁嵐', 67, 14)
}

// =========================================================
// 結果画面
// =========================================================
const TITLE_DEFS = [
  ['legend', '伝説のクルー', r => r.win && r.stars === 3],
  ['nohit', '無傷の航海', r => r.win && r.hitsTaken === 0],
  ['close', 'ギリギリ生還', r => r.win && r.minHull <= 15],
  ['lastsec', '滑り込みセーフ', r => r.win && r.left <= 10],
  ['pods', '補給コンプリート', r => r.podsTotal > 0 && r.pods === r.podsTotal],
  ['hunter', '隕石ハンター', r => r.meteorsShot >= 10],
  ['factory', '修理工場', r => r.fixed >= 8],
  ['cat', 'ネコ払い名人', r => r.catShooed >= 2],
  ['well', '重力に魅入られし者', r => r.wellTime >= 8],
  ['boom', 'あと一歩で爆発', r => !r.win && r.reason === 'hull' && r.progress >= 0.85],
  ['sorry', '謝りっぱなし', r => r.crew.reduce((a, c) => a + (c.sorry || 0), 0) >= 5],
  ['long', '銀河を渡った', r => r.win && r.route === 'long']
]
const PERSONAL = [
  ['repairs', '修理の鬼', 1.0], ['hits', '撃ち落とし名人', 1.0], ['marks', '道しるべ', 0.6], ['shoos', 'ネコ使い', 1.2],
  ['sorry', '謝罪王', 0.8], ['calls', '声出し隊長', 0.5], ['steers', 'ハンドル職人', 0.25]
]
function personalTitle(c, crew) {
  let best = null
  for (const [k, name, w] of PERSONAL) {
    const v = c[k] || 0
    if (!v) continue
    const max = Math.max(...crew.map(x => x[k] || 0))
    const sc = (v / max) * w + (v === max ? 0.3 : 0)
    if (!best || sc > best.sc) best = { sc, name }
  }
  return best ? best.name : '乗ってただけ'
}
const FACE_SVG = {
  happy: '<path d="M10 17l4-5 4 5M22 17l4-5 4 5" fill="none" stroke="#140c33" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 23q7 9 14 0z" fill="#140c33"/>',
  cry: '<path d="M10 15q4 4 8 0M22 15q4 4 8 0" fill="none" stroke="#140c33" stroke-width="3" stroke-linecap="round"/><path d="M15 28q5-5 10 0" fill="none" stroke="#140c33" stroke-width="3" stroke-linecap="round"/><path d="M12 18v9M28 18v9" stroke="#5ecbff" stroke-width="3" stroke-linecap="round"/>',
  dizzy: '<path d="M10 12l6 6M16 12l-6 6M24 12l6 6M30 12l-6 6" stroke="#140c33" stroke-width="3" stroke-linecap="round"/><path d="M12 26q4-4 8 0t8 0" fill="none" stroke="#140c33" stroke-width="3" stroke-linecap="round"/>',
  gasp: '<path d="M10 13l6 3-6 3M30 13l-6 3 6 3" fill="none" stroke="#140c33" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="20" cy="26" rx="3" ry="4" fill="#140c33"/>'
}
function faceSvg(color, kind) {
  const skin = kind === 'gasp' ? '#9fc4ff' : '#ffdcbc'
  return `<svg class="face" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="21" r="17" fill="${skin}" stroke="#140c33" stroke-width="2.5"/><path d="M4 18a16 14 0 0 1 32 0z" fill="${color}" stroke="#140c33" stroke-width="2.5" stroke-linejoin="round"/>${FACE_SVG[kind] || FACE_SVG.happy}</svg>`
}
const GAGS = {
  arrive: ['全員無事。たぶん', 'ビーコンにタッチ！', '宇宙一のチームワーク', '帰りの燃料は考えてない'],
  hull: ['保険はききません', '船はバラバラ、友情はギリギリ', 'また船のローンが増えた', '宇宙のチリになりました'],
  o2: ['息、止めてみた？', '生命維持はだいじ', 'みんな青い顔で漂流中'],
  time: ['ビーコンが待ちくたびれた', '寄り道しすぎ', '次はもっと急ごう']
}
function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d } catch { return d } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
export function loadBest() { return loadJSON('sc-best', {}) }
const recorded = new Set()

export function resultTitle(state) {
  const r = state.result
  const key = r.win ? 'arrive' : r.reason
  const list = GAGS[key] || GAGS.time
  const gag = list[(state.round || 0) % list.length]
  return `<span class="stamp">${esc(r.title)}</span><span class="gag">${esc(gag)}</span>`
}

export function renderResult(state) {
  const r = state.result
  if (ui && ui.v3) { try { ui.v3.dispose() } catch {} ui.v3 = null; ui.round = -1 }
  snd.stopBgm()
  // 記録（この端末に残す）。同じ結果で二度数えない
  const best = loadBest()
  const prevBest = best[r.route]
  let newBest = false
  const titlesHad = new Set(loadJSON('sc-titles', []))
  const earned = TITLE_DEFS.filter(([, , f]) => { try { return f(r) } catch { return false } })
  const rk = state.code + ':' + state.round
  if (!recorded.has(rk)) {
    recorded.add(rk)
    if (r.win && (!prevBest || r.stars > prevBest.stars || (r.stars === prevBest.stars && r.time < prevBest.time))) { best[r.route] = { stars: r.stars, time: r.time }; saveJSON('sc-best', best); newBest = true }
    recorded[rk] = { newBest, fresh: earned.filter(([id]) => !titlesHad.has(id)).map(([id]) => id) }
    saveJSON('sc-titles', [...new Set([...titlesHad, ...earned.map(([id]) => id)])])
  }
  const info = recorded[rk] || { newBest: false, fresh: [] }
  const allTitles = new Set(loadJSON('sc-titles', []))
  const wrap = document.createElement('div')
  const stars = [0, 1, 2].map(i => `<span class="st"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9Z'}" fill="${i < r.stars ? '#ffd23f' : '#d9cfe8'}" stroke="#140c33" stroke-width="1.8" stroke-linejoin="round"/></svg></span>`).join('')
  const bestNow = loadBest()[r.route]
  const bestText = info.newBest ? '自己ベスト更新！' : bestNow ? `自己ベスト 星${bestNow.stars} ${bestNow.time}秒` : 'まだ到着の記録なし'
  const faceKind = r.win ? 'happy' : { hull: 'dizzy', o2: 'gasp', time: 'cry' }[r.reason] || 'cry'
  const stat = (ic, label, val) => `<div>${icon(ic)}<span>${label}<strong>${val}</strong></span></div>`
  wrap.innerHTML = `
    <div class="res-top">
      ${r.win ? `<div class="res-stars" aria-label="星${r.stars}つ">${stars}</div>` : ''}
      <div class="res-route"><b>${esc(r.routeName)}</b><span class="${info.newBest ? 'res-best' : ''}">${bestText}</span></div>
    </div>
    ${r.win ? '' : `<div class="res-prog"><i style="width:${Math.round(r.progress * 100)}%"></i><span>目的地まで ${Math.round(r.progress * 100)}% 進んだ</span></div>`}
    <div class="res-stats">
      ${stat('time', '飛行', r.time + '秒')}${stat('hull', '船体', r.hull)}${stat('wrench', '修理', `${r.fixed}/${r.failures}`)}
      ${stat('meteor', '撃墜/被弾', `${r.meteorsShot}/${r.hitsTaken}`)}${stat('pod', '補給', `${r.pods}/${r.podsTotal}`)}${stat('star', 'スコア', r.score)}
    </div>
    <div class="res-titles">${earned.length ? earned.map(([id, name]) => `<span class="ttl">${icon('medal')}${esc(name)}${info.fresh.includes(id) ? '<i>NEW</i>' : ''}</span>`).join('') : '<span>称号なし</span>'}<span class="ttl-count">集めた称号 ${allTitles.size}/${TITLE_DEFS.length}</span></div>
    <ul class="res-crew">${r.crew.map((c, i) => {
      const parts = []
      if (c.repairs) parts.push(`修理${c.repairs}`)
      if (c.hits) parts.push(`撃墜${c.hits}`)
      if (c.marks) parts.push(`目印${c.marks}`)
      if (c.calls) parts.push(`声${c.calls}`)
      return `<li class="${c.id === state.you ? 'me' : ''}" style="animation-delay:${0.3 + i * 0.08}s">${faceSvg(CREW_COLORS[c.seat], faceKind)}<div class="cw"><b>${esc(c.name)}</b><em>${personalTitle(c, r.crew)}</em><small>${sortedRoles(c.roles).map(x => ROLE_NAMES[x]).join('・')}${parts.length ? '　' + parts.join(' ') : ''}</small></div></li>`
    }).join('')}</ul>
    <canvas class="res-map" aria-label="通った航路"></canvas>`
  const map = wrap.querySelector('.res-map')
  requestAnimationFrame(() => drawResultMap(map, r))
  new ResizeObserver(() => requestAnimationFrame(() => drawResultMap(map, r))).observe(map) // 描き直しは次のコマで（大きさの監視が自分の変更で回り続けないように）
  const frag = document.createDocumentFragment()
  frag.append(...wrap.childNodes)
  return frag
}
function drawResultMap(c, r) {
  if (!c || !c.isConnected) return
  const rect = c.getBoundingClientRect()
  if (rect.width < 40 || rect.height < 40) return // 小さすぎると縮尺が負になり、WebKit は arc で例外を出す
  const dpr = Math.min(2, devicePixelRatio || 1)
  c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr)
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const w = rect.width, h = rect.height
  // 枠が横長なら航路を寝かせ、縦長なら立てて描く
  const flat = w >= h
  const ww = flat ? r.len + 900 : r.w * 2 + 200, wh = flat ? r.w * 2 + 200 : r.len + 900
  const sc = Math.min((w - 12) / ww, (h - 12) / wh)
  const P = flat ? (x, y) => [w / 2 + (y - r.len / 2) * sc, h / 2 + x * sc] : (x, y) => [w / 2 + x * sc, h / 2 - (y - r.len / 2) * sc]
  ctx.fillStyle = '#061626'; ctx.fillRect(0, 0, w, h)
  for (const [k, x, y, rr] of r.hazards) { const [px, py] = P(x, y); ctx.fillStyle = k === 'field' ? 'rgba(224,146,92,.35)' : 'rgba(200,107,255,.3)'; ctx.beginPath(); ctx.arc(px, py, rr * sc, 0, Math.PI * 2); ctx.fill() }
  for (const [x, y, rr] of r.wellMap || []) { const [px, py] = P(x, y); ctx.strokeStyle = COL.violet; ctx.beginPath(); ctx.arc(px, py, rr * sc, 0, Math.PI * 2); ctx.stroke() }
  for (const [k, x, y, got] of r.podMap || []) { const [px, py] = P(x, y); ctx.fillStyle = got ? COL.green : 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill(); void k }
  for (const y of r.gateYs || []) { const [ax, ay] = P(-r.w, y), [bx, by] = P(r.w, y); ctx.strokeStyle = 'rgba(255,210,63,.5)'; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke() }
  const [gx, gy] = P(r.goal.x, r.goal.y)
  ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy, Math.max(5, 200 * sc), 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = COL.amber; ctx.lineWidth = 2.5; ctx.beginPath()
  r.track.forEach(([x, y], i) => { const [px, py] = P(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py) })
  ctx.stroke()
  const [ex, ey] = r.track.at(-1)
  const [px, py] = P(ex, ey)
  if (r.win) { ctx.fillStyle = COL.green; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill() }
  else { ctx.strokeStyle = COL.red; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px - 7, py - 7); ctx.lineTo(px + 7, py + 7); ctx.moveTo(px + 7, py - 7); ctx.lineTo(px - 7, py + 7); ctx.stroke() }
}

// ---- ロビー: 人数ごとの担当の分け方
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
  el.innerHTML = `<span class="rp-k">${n}人のときの担当</span>` + ROLE_SETS[n].map(s => `<span class="rp">${s.map(r => icon(r)).join('')}${s.length > 2 ? s.length + '役' : s.map(r => ROLE_NAMES[r]).join('+')}</span>`).join('')
}
export { icon }

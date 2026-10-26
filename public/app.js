// 画面の切り替え（ホーム → ロビー → ゲーム → 結果）。ゲーム中の描画と操作は game-view.js に任せる。
import { connect } from './net.js'
import * as view from './game-view.js'
import { ROUTES, ROUTE_IDS, DEFAULT_ROUTE } from './routes.js'

const $ = s => document.querySelector(s)
const screens = ['home', 'lobby', 'game', 'result']
const ERR = {
  not_found: 'その部屋は見つかりません。コードを確かめてください',
  full: 'その部屋は満員です',
  started: 'その部屋はもうゲームを始めています。終わるまで待ってください',
  bad_name: 'ニックネームを入れてください（12文字まで）',
  not_host: 'ゲームを始められるのはホストだけです',
  not_enough: '人数が足りません',
  not_playing: 'いまはゲーム中ではありません',
  no_room: '部屋に入っていません',
  closed: 'しばらく動きがなかったので、部屋を閉じました'
}

let state = null, leftCode = null
const NAME_KEY = 'pg-name'
// ホストが選ぶ航路（スタートと再戦のときにサーバーへ送る。サーバー側でも検証する）
const pick = { route: 'moon' }
try { const r = localStorage.getItem('sc-route'); if (ROUTE_IDS.includes(r)) pick.route = r } catch {}
const CHEV = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const DIFF = { moon: 1, belt: 2, storm: 3, hole: 4, long: 5 }

const net = connect({
  onStatus: s => {
    const el = $('#net')
    el.dataset.s = s
    el.textContent = s === 'online' ? '接続中' : s === 'connecting' ? '接続しています' : '切断。つなぎ直しています'
  },
  onMessage: msg => {
    if (msg.t === 'welcome') {
      // 招待URL（/r/ABCD）で開いたら、コード欄を埋めておく
      const m = location.pathname.match(/^\/r\/([A-Z0-9]{4})/i)
      if (m && !msg.code) { $('#code').value = m[1].toUpperCase(); $('#joinBox').open = true; $('#name').focus() }
      if (!msg.code) show('home')
    } else if (msg.t === 'state') {
      if (leftCode && msg.code === leftCode) return // 抜けた直後に届いた古い部屋の状態で、画面を戻さない
      state = msg
      render()
    } else if (msg.t === 'joined') {
      history.replaceState(null, '', '/r/' + msg.code)
    } else if (msg.t === 'error') {
      if (msg.req === 'input' || msg.code === 'over' || msg.code === 'too_fast') return // ゲーム中の操作が弾かれた理由は各操作盤に出ている
      toast(ERR[msg.code] ? ERR[msg.code] + (msg.need ? `（${msg.need}人から）` : '') : 'エラー: ' + msg.code)
    } else if (msg.t === 'closed') {
      state = null; toast(ERR.closed); history.replaceState(null, '', '/'); show('home')
    } else if (msg.t === 'pong') {
      $('#ping').textContent = Math.round(performance.now() - msg.at) + 'ms'
    }
  }
})

function show(name) {
  for (const s of screens) $('#' + s).hidden = s !== name
  document.body.dataset.screen = name
}

function toast(text) {
  const t = $('#toast')
  t.textContent = text; t.hidden = false
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500)
}

let shownResult = ''
function render() {
  if (!state) return show('home')
  const isHost = state.hostId === state.you
  if (state.phase === 'lobby') {
    show('lobby')
    $('#roomCode').textContent = state.code
    $('#invite').value = `${location.origin}/r/${state.code}`
    $('#count').textContent = `${state.players.length} / ${state.max}人`
    const colors = ['#ff8a1f', '#3ef0b0', '#4fd8ff', '#c86bff', '#ff4a5e', '#ffd23f', '#8f9bff', '#ff7ab8']
    $('#players').replaceChildren(...state.players.map((p, i) => {
      const li = document.createElement('li')
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = colors[i % 8]
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name
      li.append(dot, nm)
      if (p.id === state.hostId) li.append(badge('ホスト'))
      if (p.id === state.you) li.append(badge('あなた'))
      if (!p.connected) { li.append(badge('切断中')); li.classList.add('off') }
      return li
    }))
    $('#players').classList.toggle('many', state.players.length > 4)
    const short = state.min - state.players.filter(p => p.connected).length
    $('#startBtn').hidden = !isHost
    $('#startBtn').disabled = short > 0
    renderSetup(isHost)
    view.renderLobby(state)
    const n = state.players.filter(p => p.connected).length
    $('#lobbyHint').textContent = short > 0 ? `あと${short}人でスタートできます` : isHost ? (n < 3 ? '3人以上がおすすめ。少ないと兼任になる' : 'そろったら発進準備') : 'ホストが発進するのを待っています'
  } else if (state.phase === 'playing') {
    show('game')
    view.render(state, { send: data => net.send({ t: 'input', data }) })
  } else if (state.phase === 'result') {
    show('result')
    const r = state.result || {}
    const k = state.code + ':' + state.round
    if (shownResult !== k) {
      shownResult = k
      $('#resultTitle').innerHTML = view.resultTitle(state)
      $('#resultTitle').dataset.win = r.win ? '1' : '0'
      $('#resultBody').replaceChildren(view.renderResult(state))
    }
    $('#rematchBtn').hidden = !isHost
    $('#lobbyBtn').hidden = !isHost
    $('#resultHint').textContent = isHost ? '' : 'ホストが次を選ぶのを待っています'
  }
}

function renderSetup(isHost) {
  // ホストは自分の選択、ほかの人はホストが選んだもの（サーバー経由で届く）を見る
  const sh = state.setup || {}
  const id = isHost ? pick.route : (ROUTE_IDS.includes(sh.route) ? sh.route : DEFAULT_ROUTE)
  if (isHost && sh.route !== pick.route) net.send({ t: 'setup', opts: { route: pick.route } })
  const el = $('#routePick')
  const rt = ROUTES[id], i = ROUTE_IDS.indexOf(id)
  const best = view.loadBest()[id]
  const key = id + '|' + isHost + '|' + JSON.stringify(best || null)
  if (el.dataset.key === key) return
  el.dataset.key = key
  el.dataset.host = isHost ? '1' : '0'
  el.innerHTML = `
    <button type="button" class="pk-btn" data-d="-1" aria-label="前の航路">${CHEV(-1)}</button>
    <div class="pk-body" data-id="${id}"><div class="pk-thumb">${ROUTE_THUMB[rt.theme] || ''}</div><div class="pk-text"><small>航路 ${i + 1}/${ROUTE_IDS.length}<span class="diff" aria-label="難しさ${DIFF[id]}">${[1, 2, 3, 4, 5].map(k => `<i class="${k <= DIFF[id] ? 'on' : ''}"></i>`).join('')}</span></small><b></b><span class="pk-lead"></span><span class="pk-note"></span></div></div>
    <button type="button" class="pk-btn" data-d="1" aria-label="次の航路">${CHEV(1)}</button>`
  el.querySelector('b').textContent = rt.name
  el.querySelector('.pk-lead').textContent = rt.lead
  el.querySelector('.pk-note').innerHTML = (best ? `${view.icon('star')}自己ベスト 星${best.stars}・${best.time}秒` : 'まだ到着の記録なし') + (isHost ? '' : '　ホストが選ぶ')
  for (const b of el.querySelectorAll('.pk-btn')) {
    b.hidden = !isHost
    b.onclick = () => { pick.route = ROUTE_IDS[(i + Number(b.dataset.d) + ROUTE_IDS.length) % ROUTE_IDS.length]; try { localStorage.setItem('sc-route', pick.route) } catch {}; render() }
  }
}

// 航路の小さな絵
const ROUTE_THUMB = {
  moon: '<svg viewBox="0 0 78 64"><rect width="78" height="64" fill="#14244f"/><circle cx="52" cy="26" r="18" fill="#c9cbd6"/><circle cx="46" cy="22" r="4" fill="#9a9cb0"/><circle cx="58" cy="32" r="3" fill="#9a9cb0"/><circle cx="14" cy="50" r="7" fill="#3a8cff"/><path d="M12 56l10-14" stroke="#ff8a1f" stroke-width="3" stroke-linecap="round"/><g fill="#fff"><circle cx="10" cy="10" r="1"/><circle cx="30" cy="48" r="1"/><circle cx="70" cy="56" r="1"/></g></svg>',
  belt: '<svg viewBox="0 0 78 64"><rect width="78" height="64" fill="#2b1533"/><circle cx="54" cy="22" r="14" fill="#e0784a"/><ellipse cx="54" cy="22" rx="24" ry="6" fill="none" stroke="#ffd2a0" stroke-width="2.5" transform="rotate(-15 54 22)"/><g fill="#8a6a52" stroke="#140c33" stroke-width="1.5"><path d="M10 40l7-4 6 3 1 7-6 4-7-3z"/><path d="M30 50l5-3 5 2v5l-5 3-5-2z"/><path d="M60 46l6-2 4 4-2 6-6 1-3-4z"/></g></svg>',
  storm: '<svg viewBox="0 0 78 64"><rect width="78" height="64" fill="#24104d"/><circle cx="26" cy="28" r="18" fill="#c86bff" opacity=".45"/><circle cx="50" cy="36" r="16" fill="#4fd8ff" opacity=".3"/><path d="M40 10l-8 20h8l-6 20 16-26h-9l7-14z" fill="#ffd23f" stroke="#140c33" stroke-width="2" stroke-linejoin="round"/></svg>',
  hole: '<svg viewBox="0 0 78 64"><rect width="78" height="64" fill="#120818"/><ellipse cx="39" cy="32" rx="32" ry="9" fill="none" stroke="#ff9a3a" stroke-width="5"/><circle cx="39" cy="32" r="11" fill="#000" stroke="#ff9a3a" stroke-width="1.5"/><path d="M7 32a32 9 0 0 0 64 0" fill="none" stroke="#ffd2a0" stroke-width="3"/></svg>',
  galaxy: '<svg viewBox="0 0 78 64"><rect width="78" height="64" fill="#1a1250"/><g fill="none" stroke-width="3" stroke-linecap="round"><path d="M39 32c0-8 12-8 12 0s-14 14-22 4-2-24 14-24" stroke="#ff7ab8"/><path d="M39 32c0 8-12 8-12 0s14-14 22-4 2 24-14 24" stroke="#4fd8ff"/></g><circle cx="39" cy="32" r="4" fill="#fff8d0"/></svg>'
}

function badge(text) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = text; return b }

// ---- ボタン
const nameInput = $('#name')
try { nameInput.value = localStorage.getItem(NAME_KEY) || '' } catch {}
const name = () => { const n = nameInput.value.trim(); try { localStorage.setItem(NAME_KEY, n) } catch {}; return n }

$('#createBtn').onclick = () => { leftCode = null; if (!name()) return toast(ERR.bad_name); net.send({ t: 'create', name: name() }) }
$('#joinBtn').onclick = () => {
  leftCode = null
  const code = $('#code').value.trim().toUpperCase()
  if (!name()) return toast(ERR.bad_name)
  if (!/^[A-Z0-9]{4}$/.test(code)) return toast('参加コードは4文字です')
  net.send({ t: 'join', code, name: name() })
}
$('#copyBtn').onclick = async () => {
  const url = $('#invite').value
  try {
    if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: document.title, url })
    else { await navigator.clipboard.writeText(url); toast('招待URLをコピーしました') }
  } catch { $('#invite').select(); toast('URLを長押ししてコピーしてください') }
}
$('#startBtn').onclick = () => net.send({ t: 'start', opts: { route: pick.route } })
function leaveRoom() { leftCode = state && state.code; net.send({ t: 'leave' }); state = null; history.replaceState(null, '', '/'); show('home') }
$('#leaveBtn').onclick = leaveRoom
$('#rematchBtn').onclick = () => net.send({ t: 'rematch', opts: { route: pick.route } })
$('#lobbyBtn').onclick = () => net.send({ t: 'lobby' })
// 抜けるボタンは2回押しで確定（ブラウザの確認ダイアログは使わない）
const QUIT_ICON = $('#quitBtn').innerHTML
$('#quitBtn').onclick = () => {
  const b = $('#quitBtn')
  if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.classList.add('armed'); b.textContent = 'もう一度'; setTimeout(() => { b.dataset.armed = ''; b.classList.remove('armed'); b.innerHTML = QUIT_ICON }, 2500); return }
  b.dataset.armed = ''; b.classList.remove('armed'); b.innerHTML = QUIT_ICON
  leaveRoom()
}

// 遊び方
$('#howBtn').onclick = () => { $('#howto').hidden = false; $('#howClose').focus() }
$('#howClose').onclick = () => { $('#howto').hidden = true }
$('#howto').onclick = e => { if (e.target.id === 'howto') $('#howto').hidden = true }
addEventListener('keydown', e => { if (e.key === 'Escape') $('#howto').hidden = true })

window.__boot = true
{ const d = document.getElementById('bootErr'); if (d) d.hidden = true } // 遅れて起動できたときは誤報を消す
show('home')

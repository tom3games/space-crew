// 宇宙船クルーのルール。全員で1隻の船を動かし、目的地のビーコンまで運ぶ。
//
// 守る約束（rooms.mjs から呼ばれる）
//   meta: { id, title, minPlayers, maxPlayers, tickHz }
//   createGame(players, opts) -> { tick, input, view, isOver, result, removePlayer }
// 乱数は opts.rng があればそれを使う（テストで結果を固定するため）。
// opts.route は航路の id（public/routes.js）。知らない値なら既定の航路にする。
// opts.config はサーバー側だけが渡す（コースの長さなど。e2e で短いコースにするため）。画面から送られた値は使わない。
//
// 座標: x が右、y が前（目的地の方向）。船の向き h はラジアンで、前方ベクトルは (sin h, cos h)。h が増えると右に曲がる。
// 物理は内部の固定ステップ（1/30秒）で進める。サーバーの tick の間隔が揺れても結果は同じ。
//
// 1回の中でだんだん難しくなる: 航路は区間（3つ、ロングは5つ）に分かれ、区間の境目の中継ラインを越えるたびに
// 残り時間が増え、隕石と故障が起きやすくなり、出来事（流星群・太陽風・宇宙ネコ）が起き始める。危険地帯も奥ほど多く大きい。

import { ROUTES, ROUTE_IDS, DEFAULT_ROUTE, EVENT_NAMES, POD_KINDS, POD_NAMES } from '../public/routes.js'

export const meta = {
  id: 'space-crew',
  title: '宇宙船クルー',
  minPlayers: 1,
  maxPlayers: 8,
  tickHz: 15
}

export const ROLES = ['helm', 'engine', 'repair', 'nav', 'defense']
export const ROLE_NAMES = { helm: '操縦', engine: 'エンジン', repair: '修理', nav: 'ナビ', defense: '防衛' }
export const SYSTEMS = ['helm', 'engine', 'radar', 'cannon', 'life']
export const SYSTEM_NAMES = { helm: '操舵装置', engine: 'エンジン', radar: 'センサー', cannon: '砲台', life: '生命維持' }

// 人数ごとの担当の組み合わせ。少人数は兼任、6人からは修理と防衛を増やす
export const ROLE_SETS = {
  1: [['helm', 'engine', 'repair', 'nav', 'defense']],
  2: [['helm', 'engine'], ['nav', 'repair', 'defense']],
  3: [['helm', 'engine'], ['nav', 'defense'], ['repair']],
  4: [['helm'], ['engine', 'repair'], ['nav'], ['defense']],
  5: [['helm'], ['engine'], ['repair'], ['nav'], ['defense']],
  6: [['helm'], ['engine'], ['repair'], ['nav'], ['defense'], ['repair']],
  7: [['helm'], ['engine'], ['repair'], ['nav'], ['defense'], ['repair'], ['defense']],
  8: [['helm'], ['engine'], ['repair'], ['nav'], ['defense'], ['repair'], ['defense'], ['repair']]
}

// 担当ごとに送れる掛け声。fix:<装置> と roles:null のものは全員が送れる
export const CALLS = {
  left: { text: '左へ', roles: ['nav'] },
  right: { text: '右へ', roles: ['nav'] },
  straight: { text: 'まっすぐ', roles: ['nav'] },
  slow: { text: '減速して', roles: ['nav', 'helm'] },
  fast: { text: '加速して', roles: ['nav', 'helm'] },
  pod: { text: '補給を拾って', roles: ['nav', 'helm'] },
  meteor: { text: '隕石が来る', roles: ['defense', 'helm'] },
  power: { text: '電力が足りない', roles: ['engine', 'defense'] },
  help: { text: '手伝って', roles: null },
  sorry: { text: 'ごめん', roles: null },
  nice: { text: 'ナイス', roles: null }
}

export { ROUTES, ROUTE_IDS, DEFAULT_ROUTE, EVENT_NAMES }

export const DEFAULTS = {
  goalDist: 6000,   // 目的地までの距離（航路ごとに上書き）
  timeLimit: 150,   // 秒（航路ごとに上書き）
  halfWidth: 1400,  // 航路の幅の半分。外に出ると船体が削れる
  briefTime: 4,     // 発進前の役割確認
  goalRadius: 200,
  endTime: 2.4      // 着いた・壊れたあと、結果画面に移るまでの余韻（秒）
}

export const TUNING = {
  step: 1 / 30,
  speeds: [0, 45, 75, 105],      // 出力段ごとの目標速度
  drain: [0, 1, 3, 6],           // 出力段ごとのエネルギー消費/秒
  heat: [-9, -5, 2.5, 9],        // 出力段ごとの熱の増減/秒
  accel: 35,
  turnRate: 1.25,
  energyRegen: 4,
  limpSpeed: 20,                 // エンジン故障中の最高速度
  shotCost: 6, shotCd: 0.45, boltSpeed: 900, boltLife: 0.7,
  ventCost: 12, ventCd: 3, ventHeat: 40,
  repairPerTap: 9, repairTapCd: 0.07,
  callCd: 1.2, markCd: 0.3,
  shipR: 28, meteorR: 22,
  meteorHit: 10, meteorBreakChance: 0.35,
  fieldDmg: 10, outDmg: 4, stormBreakPerSec: 0.22, stormDrain: 5,
  o2Loss: 3.5, o2Gain: 3,
  failBase: 17, meteorBase: 5,
  helmSight: 480, defenseSight: 700,
  mapEvery: 3,
  // 重力井戸: 中心へ引く加速度（外周で wellEdge、中心で wellPull+wellEdge）。中心の芯では船体が削れる
  wellPull: 70, wellEdge: 16, wellCore: 0.24, wellDmg: 14,
  driftDamp: 0.9,                // 流され（重力・太陽風）の減衰/秒
  gateHull: 15,                  // 中継ラインで応急修理される船体
  podR: 70, podHull: 25, podO2: 40, podEnergy: 50,
  windAccel: 30, windTime: 7, showerTime: 8, showerRate: 4, warnTime: 3,
  catHp: 6, catTime: 10, shooCd: 0.08,
  diffLo: 0.75, diffHi: 1.4      // 最初の区間と最後の区間の難しさ（隕石・故障の起きやすさの倍率）
}

const r1 = v => Math.round(v)
const r2 = v => Math.round(v * 100) / 100
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }
const fin = v => typeof v === 'number' && Number.isFinite(v)

export function rolesFor(n) { return ROLE_SETS[clamp(n, 1, 8)].map(s => [...s]) }
export function routeOf(id) { return ROUTE_IDS.includes(id) ? id : DEFAULT_ROUTE }

// コースを作る。危険地帯（ナビだけが見える）・重力井戸と補給ポッド（全員に見える）・中継ライン
export function makeCourse(cfg, route, rng) {
  const hz = [], wells = [], pods = []
  const L = cfg.goalDist, W = cfg.halfWidth
  const k = L / route.goalDist // 長さを変えたときの個数の倍率
  const goal = { x: r1((rng() * 2 - 1) * W * 0.5), y: L }
  const nearEnds = (x, y, r) => Math.hypot(x, y) < r + 380 || Math.hypot(x - goal.x, y - goal.y) < r + 320
  // まっすぐ飛ぶと必ず引っかかる岩場を、直線上に2つ置く（ナビが要る理由）
  for (const f of [0.38, 0.72]) {
    const r = 240 + rng() * 80
    hz.push({ k: 'field', x: r1(goal.x * f + (rng() - 0.5) * 120), y: r1(L * f), r: r1(r) })
  }
  const want = { field: Math.max(0, Math.round(route.fields * k) - 2), storm: Math.round(route.storms * k) }
  let guard = 0
  while ((want.field > 0 || want.storm > 0) && guard++ < 2000) {
    const kind = want.storm > 0 && (want.field <= 0 || rng() < want.storm / (want.storm + want.field)) ? 'storm' : 'field'
    // 奥ほど多く、大きい（だんだん難しくなる）
    const y = 500 + (L - 900) * Math.sqrt(rng())
    const r = (160 + rng() * 150) * (0.8 + 0.45 * y / L)
    const x = (rng() * 2 - 1) * (W - 150)
    if (nearEnds(x, y, r)) continue
    if (hz.some(h => Math.hypot(h.x - x, h.y - y) < (h.r + r) * 0.9)) continue
    hz.push({ k: kind, x: r1(x), y: r1(y), r: r1(r) })
    want[kind]--
  }
  guard = 0
  let nw = Math.round((route.wells || 0) * k)
  while (nw > 0 && guard++ < 1000) {
    const r = 320 + rng() * 100
    const y = L * (0.22 + rng() * 0.66), x = (rng() * 2 - 1) * (W - 380)
    if (nearEnds(x, y, r)) continue
    if (wells.some(w => Math.hypot(w.x - x, w.y - y) < w.r + r + 200)) continue
    if (hz.some(h => Math.hypot(h.x - x, h.y - y) < h.r + r * 0.6)) continue
    wells.push({ id: wells.length + 1, x: r1(x), y: r1(y), r: r1(r) })
    nw--
  }
  guard = 0
  let np = Math.max(1, Math.round((route.pods || 0) * k))
  while (np > 0 && guard++ < 1000) {
    const y = L * (0.1 + rng() * 0.82), x = (rng() * 2 - 1) * (W - 250)
    if (hz.some(h => h.k === 'field' && Math.hypot(h.x - x, h.y - y) < h.r + 40)) continue
    if (wells.some(w => Math.hypot(w.x - x, w.y - y) < w.r * TUNING.wellCore + 90)) continue
    if (pods.some(p => Math.hypot(p.x - x, p.y - y) < 500)) continue
    pods.push({ id: pods.length + 1, kind: POD_KINDS[pods.length % POD_KINDS.length], x: r1(x), y: r1(y), got: false })
    np--
  }
  const S = route.sections || 3
  const gates = [...Array(S - 1)].map((_, i) => r1(L * (i + 1) / S))
  return { goal, hazards: hz, wells, pods, gates }
}

export function createGame(players, opts = {}) {
  const rng = opts.rng || Math.random
  const routeId = routeOf(opts.route)
  const route = ROUTES[routeId]
  const cfg = { ...DEFAULTS, goalDist: route.goalDist, timeLimit: route.timeLimit, ...(opts.config || {}) }
  const T = TUNING
  const n = players.length
  const course = makeCourse(cfg, route, rng)
  const S = route.sections || 3

  // 担当を配る（毎回並びを混ぜる）
  const sets = rolesFor(n)
  for (let i = sets.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [sets[i], sets[j]] = [sets[j], sets[i]] }
  const crew = new Map(players.map((p, i) => [p.id, {
    id: p.id, name: p.name, roles: sets[i], seat: i,
    cd: { fire: 0, vent: 0, repair: 0, call: 0, mark: 0, shoo: 0 },
    st: { repairs: 0, taps: 0, shots: 0, hits: 0, marks: 0, calls: 0, shoos: 0, steers: 0, sorry: 0 },
    mapAt: -Infinity, objAt: -Infinity
  }]))

  const ship = { x: 0, y: 0, h: 0, v: 0 }
  const drift = { x: 0, y: 0 }
  let throttle = 1, heat = 0, energy = 100, hull = 100, o2 = 100
  let steer = 0, helmDrift = 0
  const sys = Object.fromEntries(SYSTEMS.map(s => [s, { broken: false, fix: 0 }]))
  let meteors = [], bolts = [], nextId = 1
  let marker = null
  const calls = [], events = []
  let evId = 1
  const track = [[0, 0]]
  let t = 0, acc = 0, trackAt = 0
  let phase = 'brief'
  let over = false, win = false, reason = '', endT = 0
  let sec = 0, bonus = 0
  let ev = null          // いま起きている出来事 { k, warnUntil, until, dir, started }
  let nextEvent = Infinity
  let cat = null         // { on: playerId, hp, until }
  let inWell = false
  const scale = 1 + 0.15 * (n - 1)
  let nextFail = (T.failBase / scale) * (0.7 + rng() * 0.6)
  let nextMeteor = (T.meteorBase / (1 + 0.12 * (n - 1))) * (0.6 + rng() * 0.6)
  const stats = { failures: 0, fixed: 0, meteorsShot: 0, hitsTaken: 0, pods: 0, gates: 0, minHull: 100, wellTime: 0, catShooed: 0, events: [] }

  const flyTime = () => Math.max(0, (over ? endT : t) - cfg.briefTime)
  const limit = () => cfg.timeLimit + bonus
  const timeLeft = () => Math.max(0, limit() - flyTime())
  const diff = () => T.diffLo + (T.diffHi - T.diffLo) * (S > 1 ? sec / (S - 1) : 0)

  function event(text, kind) {
    events.push({ id: evId++, text, kind, t })
    if (events.length > 6) events.shift()
  }

  function breakSys(s, why) {
    if (!s || sys[s].broken) return
    sys[s].broken = true
    sys[s].fix = 0
    stats.failures++
    if (s === 'helm') helmDrift = (rng() < 0.5 ? -1 : 1) * 0.18
    event(`${SYSTEM_NAMES[s]}が故障${why ? '（' + why + '）' : ''}`, 'fail')
  }
  const breakRandom = why => {
    const ok = SYSTEMS.filter(s => !sys[s].broken)
    if (ok.length) breakSys(ok[Math.floor(rng() * ok.length)], why)
  }

  function zoneAt(x, y) {
    let z = null
    for (const h of course.hazards) if (Math.hypot(h.x - x, h.y - y) < h.r) { if (h.k === 'field') return 'field'; z = 'storm' }
    return z
  }

  function finish(w, why) {
    over = true; win = w; reason = why; endT = t; phase = 'end'
    steer = 0
    cat = null
    if (ev && ev.k === 'cat') ev = null
  }

  function spawnMeteor() {
    if (meteors.length >= 12) return
    const a = ship.h + (rng() * 2 - 1) * 1.2
    const d = 650 + rng() * 100
    const x = ship.x + Math.sin(a) * d, y = ship.y + Math.cos(a) * d
    // 船の少し先を狙う。ずらしも入れるので全部が当たるわけではない
    const lead = 2.5
    const tx = ship.x + Math.sin(ship.h) * ship.v * lead + (rng() - 0.5) * 160
    const ty = ship.y + Math.cos(ship.h) * ship.v * lead + (rng() - 0.5) * 160
    const sp = (60 + rng() * 55) * (0.9 + 0.2 * sec / Math.max(1, S - 1))
    const dl = Math.hypot(tx - x, ty - y) || 1
    meteors.push({ id: nextId++, x, y, vx: (tx - x) / dl * sp, vy: (ty - y) / dl * sp, age: 0 })
  }

  // 出来事を始める。流星群と太陽風は warnTime 秒前に予告する。ネコはいきなり来る
  function startEvent(kind) {
    const list = route.events || []
    if (!list.length && !kind) return
    const k = kind || list[Math.floor(rng() * list.length)]
    if (k === 'cat') {
      const ids = [...crew.keys()]
      if (!ids.length) return
      const on = ids[Math.floor(rng() * ids.length)]
      cat = { on, hp: T.catHp, until: t + T.catTime }
      ev = { k, warnUntil: t, until: t + T.catTime, dir: 0, started: true }
      event(`宇宙ネコが${crew.get(on).name}の操作盤に乗った`, 'cat')
    } else {
      const dur = k === 'wind' ? T.windTime : T.showerTime
      ev = { k, warnUntil: t + T.warnTime, until: t + T.warnTime + dur, dir: rng() < 0.5 ? -1 : 1, started: false }
      event(k === 'wind' ? `${ev.dir > 0 ? '左' : '右'}から太陽風が来る` : '流星群が来る', 'warn')
    }
    if (!stats.events.includes(k)) stats.events.push(k)
  }

  function step(dt) {
    t += dt
    if (phase === 'brief') {
      if (t >= cfg.briefTime) { phase = 'fly'; event('発進', 'info') }
      return
    }
    if (phase === 'end') {
      // 余韻: 船は惰性で流れるだけ
      ship.x += Math.sin(ship.h) * ship.v * dt * 0.5
      ship.y += Math.cos(ship.h) * ship.v * dt * 0.5
      return
    }
    for (const c of crew.values()) for (const k in c.cd) c.cd[k] = Math.max(0, c.cd[k] - dt)
    const D = diff()

    // 操舵（故障中は入力が効かず、勝手に少しずつ曲がる）
    const turn = sys.helm.broken ? helmDrift : steer * T.turnRate
    ship.h = wrap(ship.h + turn * dt)
    // エンジン
    const lvl = energy <= 0 ? Math.min(throttle, 1) : throttle
    let target = T.speeds[lvl]
    if (sys.engine.broken) target = Math.min(target, T.limpSpeed)
    ship.v += clamp(target - ship.v, -T.accel * dt, T.accel * dt)
    // 流され（重力井戸と太陽風）
    let ax = 0, ay = 0
    inWell = false
    for (const w of course.wells) {
      const dx = w.x - ship.x, dy = w.y - ship.y, d = Math.hypot(dx, dy)
      if (d >= w.r) continue
      inWell = true
      if (d < w.r * T.wellCore) hull -= T.wellDmg * dt
      if (d < 1) continue
      const a = T.wellEdge + T.wellPull * (1 - d / w.r)
      ax += dx / d * a; ay += dy / d * a
    }
    if (inWell) stats.wellTime += dt
    const windOn = ev && ev.k === 'wind' && t >= ev.warnUntil && t < ev.until
    if (windOn) ax += ev.dir * T.windAccel
    const damp = Math.exp(-T.driftDamp * dt)
    drift.x = drift.x * damp + ax * dt
    drift.y = drift.y * damp + ay * dt
    ship.x += Math.sin(ship.h) * ship.v * dt + drift.x * dt
    ship.y += Math.cos(ship.h) * ship.v * dt + drift.y * dt
    // 熱
    heat = clamp(heat + (sys.engine.broken ? -9 : T.heat[lvl]) * dt, 0, 100)
    if (heat >= 100 && !sys.engine.broken) { breakSys('engine', '過熱'); heat = 70 }
    // エネルギー
    energy = clamp(energy + (T.energyRegen - (sys.engine.broken ? 0 : T.drain[lvl])) * dt, 0, 100)
    // 酸素
    o2 = clamp(o2 + (sys.life.broken ? -T.o2Loss : T.o2Gain) * dt, 0, 100)

    // 危険地帯
    const z = zoneAt(ship.x, ship.y)
    if (z === 'field') hull -= Math.max(2, ship.v / T.speeds[3] * T.fieldDmg) * dt
    if (z === 'storm') {
      energy = Math.max(0, energy - T.stormDrain * dt)
      if (rng() < T.stormBreakPerSec * dt) breakRandom('電磁嵐')
    }
    if (Math.abs(ship.x) > cfg.halfWidth || ship.y < -300 || ship.y > cfg.goalDist + 600) hull -= T.outDmg * dt

    // 補給ポッド
    for (const p of course.pods) {
      if (p.got || Math.hypot(p.x - ship.x, p.y - ship.y) > T.podR) continue
      p.got = true
      stats.pods++
      if (p.kind === 'hull') hull = Math.min(100, hull + T.podHull)
      if (p.kind === 'o2') o2 = Math.min(100, o2 + T.podO2)
      if (p.kind === 'energy') { energy = Math.min(100, energy + T.podEnergy); heat = Math.max(0, heat - 40) }
      event(`${POD_NAMES[p.kind]}を拾った`, 'pod')
    }

    // 中継ライン（区間の境目）。越えると時間が増え、次の区間は難しくなる
    while (sec < course.gates.length && ship.y >= course.gates[sec]) {
      sec++
      stats.gates++
      bonus += route.gateBonus
      hull = Math.min(100, hull + T.gateHull)
      event(`中継ライン通過 +${route.gateBonus}秒 船体+${T.gateHull}`, 'gate')
      if (sec >= (route.eventFrom ?? 1) && nextEvent === Infinity && !ev) nextEvent = t + 5 + rng() * 5
    }

    // 出来事
    if (ev && t >= ev.until) {
      if (ev.k === 'cat' && cat) event('ネコはどこかへ行った', 'info')
      ev = null; cat = null
      nextEvent = t + (16 + rng() * 8) / D
    }
    if (!ev && t >= nextEvent) startEvent()
    if (ev && !ev.started && t >= ev.warnUntil) { ev.started = true; event(ev.k === 'wind' ? '太陽風で流される' : '流星群に突入', 'warn') }

    // 自然故障（区間が進むほど起きやすい）
    nextFail -= dt * D * route.fail
    if (nextFail <= 0) { breakRandom(); nextFail = (T.failBase / scale) * (0.7 + rng() * 0.6) }

    // 隕石（区間が進むほど多い。流星群の間はさらに多い）
    const showerOn = ev && ev.k === 'shower' && t >= ev.warnUntil && t < ev.until
    nextMeteor -= dt * D * route.meteor * (showerOn ? T.showerRate : 1)
    if (nextMeteor <= 0) { spawnMeteor(); nextMeteor = (T.meteorBase / (1 + 0.12 * (n - 1))) * (0.7 + rng() * 0.6) }
    for (const m of meteors) { m.x += m.vx * dt; m.y += m.vy * dt; m.age += dt }
    // 弾（1ステップで進んだ線分で当たりを見る。すり抜けない）
    for (const b of bolts) {
      const ox = b.x, oy = b.y
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt
      for (const m of meteors) {
        if (m.dead) continue
        if (segDist(ox, oy, b.x, b.y, m.x, m.y) < T.meteorR + 6) {
          m.dead = true; b.life = 0
          stats.meteorsShot++
          const c = crew.get(b.by); if (c) c.st.hits++
          break
        }
      }
    }
    bolts = bolts.filter(b => b.life > 0)
    for (const m of meteors) {
      if (m.dead) continue
      if (Math.hypot(m.x - ship.x, m.y - ship.y) < T.shipR + T.meteorR) {
        m.dead = true
        hull -= T.meteorHit
        stats.hitsTaken++
        event('隕石が命中', 'hit')
        if (rng() < T.meteorBreakChance) breakRandom('衝突')
      }
      if (m.age > 20 || Math.hypot(m.x - ship.x, m.y - ship.y) > 1100) m.dead = true
    }
    meteors = meteors.filter(m => !m.dead)

    hull = Math.max(0, hull)
    stats.minHull = Math.min(stats.minHull, hull)
    if (t - trackAt >= 1.5) { trackAt = t; track.push([r1(ship.x), r1(ship.y)]); if (track.length > 400) track.shift() }

    // 判定
    if (Math.hypot(course.goal.x - ship.x, course.goal.y - ship.y) < cfg.goalRadius) return finish(true, 'arrive')
    if (hull <= 0) return finish(false, 'hull')
    if (o2 <= 0) return finish(false, 'o2')
    if (timeLeft() <= 0) return finish(false, 'time')
  }

  const ERR = e => ({ error: e })

  function input(id, data) {
    if (over) return ERR('over')
    const c = crew.get(id)
    if (!c) return ERR('not_player')
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return ERR('bad_input')
    const d = data
    if (d.type === 'call') {
      if (typeof d.id !== 'string') return ERR('bad_input')
      let text
      if (d.id.startsWith('fix:')) {
        const s = d.id.slice(4)
        if (!SYSTEMS.includes(s)) return ERR('bad_input')
        if (!sys[s].broken) return ERR('not_broken')
        text = `${SYSTEM_NAMES[s]}を修理して`
      } else {
        const def = Object.hasOwn(CALLS, d.id) ? CALLS[d.id] : null
        if (!def) return ERR('bad_input')
        if (def.roles && !def.roles.some(r => c.roles.includes(r))) return ERR('not_your_role')
        text = def.text
      }
      if (c.cd.call > 0) return ERR('cooldown')
      c.cd.call = T.callCd
      c.st.calls++
      if (d.id === 'sorry') c.st.sorry++
      calls.push({ id: evId++, from: c.name, by: c.seat, text, t })
      if (calls.length > 4) calls.shift()
      return { ok: true }
    }
    if (d.type === 'shoo') {
      if (phase !== 'fly') return ERR('not_started')
      if (!cat || cat.on !== id) return ERR('no_cat')
      if (c.cd.shoo > 0) return ERR('cooldown')
      c.cd.shoo = T.shooCd
      cat.hp--
      if (cat.hp <= 0) {
        c.st.shoos++
        stats.catShooed++
        event(`${c.name}がネコを追い払った`, 'fixed')
        cat = null
        ev = null
        nextEvent = t + (16 + rng() * 8) / diff()
      }
      return { ok: true }
    }
    const need = { steer: 'helm', throttle: 'engine', vent: 'engine', repair: 'repair', mark: 'nav', fire: 'defense' }[d.type]
    if (!need) return ERR('bad_input')
    if (!c.roles.includes(need)) return ERR('not_your_role') // 担当以外の操作は受け付けない
    if (phase !== 'fly') return ERR('not_started')
    if (cat && cat.on === id) return ERR('cat') // ネコが操作盤に乗っている間は、追い払うまで操作できない

    switch (d.type) {
      case 'steer':
        if (![-1, 0, 1].includes(d.dir)) return ERR('bad_input')
        if (steer !== d.dir) c.st.steers++
        steer = d.dir
        return { ok: true }
      case 'throttle':
        if (![0, 1, 2, 3].includes(d.level)) return ERR('bad_input')
        throttle = d.level
        return { ok: true }
      case 'vent':
        if (c.cd.vent > 0) return ERR('cooldown')
        if (energy < T.ventCost) return ERR('no_energy')
        energy -= T.ventCost
        heat = Math.max(0, heat - T.ventHeat)
        c.cd.vent = T.ventCd
        return { ok: true }
      case 'repair': {
        if (!SYSTEMS.includes(d.sys)) return ERR('bad_input')
        const s = sys[d.sys]
        if (!s.broken) return ERR('not_broken')
        if (c.cd.repair > 0) return ERR('cooldown')
        c.cd.repair = T.repairTapCd
        c.st.taps++
        s.fix += T.repairPerTap
        if (s.fix >= 100) {
          s.broken = false; s.fix = 0
          stats.fixed++; c.st.repairs++
          event(`${SYSTEM_NAMES[d.sys]}が直った`, 'fixed')
        }
        return { ok: true }
      }
      case 'mark':
        if (!fin(d.x) || !fin(d.y)) return ERR('bad_input')
        if (sys.radar.broken) return ERR('radar_broken')
        if (c.cd.mark > 0) return ERR('cooldown')
        c.cd.mark = T.markCd
        marker = { x: r1(clamp(d.x, -cfg.halfWidth, cfg.halfWidth)), y: r1(clamp(d.y, 0, cfg.goalDist + 300)) }
        c.st.marks++
        return { ok: true }
      case 'fire': {
        if (!fin(d.a)) return ERR('bad_input')
        if (sys.cannon.broken) return ERR('cannon_broken')
        if (c.cd.fire > 0) return ERR('cooldown')
        if (energy < T.shotCost) return ERR('no_energy')
        energy -= T.shotCost
        c.cd.fire = T.shotCd
        c.st.shots++
        bolts.push({ id: nextId++, by: id, x: ship.x, y: ship.y, vx: Math.sin(d.a) * T.boltSpeed, vy: Math.cos(d.a) * T.boltSpeed, life: T.boltLife })
        return { ok: true }
      }
    }
    return ERR('bad_input')
  }

  function view(id) {
    const c = crew.get(id)
    const roles = c ? c.roles : []
    const sees = r => roles.includes(r)
    const v = {
      phase, n, route: routeId,
      brief: r2(Math.max(0, cfg.briefTime - t)),
      left: r2(timeLeft()), limit: limit(),
      roles, seat: c ? c.seat : -1,
      crew: [...crew.values()].map(p => ({ id: p.id, name: p.name, roles: p.roles, seat: p.seat })),
      ship: { x: r1(ship.x), y: r1(ship.y), h: r2(ship.h), v: r1(ship.v) },
      steer, throttle, heat: r1(heat), energy: r1(energy), hull: r1(hull), o2: r1(o2),
      sys: Object.fromEntries(SYSTEMS.map(s => [s, sys[s].broken ? r1(sys[s].fix) : -1])),
      goal: course.goal, dist: r1(Math.hypot(course.goal.x - ship.x, course.goal.y - ship.y)),
      len: cfg.goalDist, w: cfg.halfWidth,
      sec, secs: S, gates: course.gates,
      zone: phase === 'fly' ? zoneAt(ship.x, ship.y) : null,
      well: inWell && phase === 'fly',
      out: Math.abs(ship.x) > cfg.halfWidth,
      calls: calls.filter(k => t - k.t < 4).map(k => ({ id: k.id, from: k.from, by: k.by, text: k.text })),
      events: events.filter(e => t - e.t < 5).map(e => ({ id: e.id, text: e.text, kind: e.kind })),
      got: course.pods.filter(p => p.got).map(p => p.id),
      cd: c ? { fire: r2(c.cd.fire), vent: r2(c.cd.vent) } : null
    }
    // いま起きている出来事: [種類, 予告の残り秒, 終わるまでの秒, 向き]
    if (ev) v.ev = [ev.k, r2(Math.max(0, ev.warnUntil - t)), r2(Math.max(0, ev.until - t)), ev.dir || 0]
    if (cat) { const on = crew.get(cat.on); v.cat = { seat: on ? on.seat : -1, name: on ? on.name : '', me: cat.on === id, hp: cat.hp } }
    if (phase === 'end') v.end = { win, reason }
    // 隕石が見えるのは操縦（近く）と防衛（遠くまで）だけ
    const sight = sees('defense') ? T.defenseSight : sees('helm') ? T.helmSight : 0
    if (sight) {
      v.meteors = meteors.filter(m => Math.hypot(m.x - ship.x, m.y - ship.y) < sight).map(m => [m.id, r1(m.x), r1(m.y)])
      v.bolts = bolts.map(b => [b.id, r1(b.x), r1(b.y)])
    }
    if (sees('helm') || sees('nav')) v.marker = marker
    // 重力井戸と補給ポッドは全員に見える。変わらないので数秒おきに送る（拾ったかどうかは got で毎回）
    if (c && t - c.objAt >= T.mapEvery) {
      c.objAt = t
      v.objs = [...course.wells.map(w => ['well', w.id, w.x, w.y, w.r]), ...course.pods.map(p => [p.kind, p.id, p.x, p.y])]
    }
    // 危険地帯の地図はナビだけ。変わらないので数秒おきにしか送らない。センサー故障中は送らない
    if (sees('nav')) {
      v.radar = !sys.radar.broken
      if (v.radar && c && t - c.mapAt >= T.mapEvery) { c.mapAt = t; v.map = course.hazards.map(h => [h.k, h.x, h.y, h.r]) }
    }
    return v
  }

  function result() {
    const order = { arrive: 0, hull: 1, o2: 2, time: 3 }
    const titles = ['到着', '船が大破', '酸素切れ', '時間切れ']
    const subs = [
      '目的地のビーコンにたどり着いた',
      '船体の耐久が0になった',
      '生命維持が止まったまま酸素が尽きた',
      '制限時間内に目的地へ着けなかった'
    ]
    const i = order[reason] ?? 3
    let stars = 0
    if (win) stars = 1 + (hull >= 40 ? 1 : 0) + (hull >= 75 && timeLeft() >= limit() * 0.2 ? 1 : 0)
    const dist = Math.hypot(course.goal.x - ship.x, course.goal.y - ship.y)
    return {
      win, reason, stars, route: routeId, routeName: route.name,
      title: titles[i], sub: subs[i],
      time: r1(flyTime()), left: r1(timeLeft()), limit: limit(), hull: r1(hull), o2: r1(o2),
      dist: r1(dist), len: cfg.goalDist, w: cfg.halfWidth,
      progress: win ? 1 : r2(clamp(ship.y / cfg.goalDist, 0, 0.99)),
      ...stats, events: [...stats.events], minHull: r1(stats.minHull), wellTime: r1(stats.wellTime),
      podsTotal: course.pods.length, gatesTotal: course.gates.length,
      goal: course.goal, hazards: course.hazards.map(h => [h.k, h.x, h.y, h.r]),
      wellMap: course.wells.map(w => [w.x, w.y, w.r]), podMap: course.pods.map(p => [p.kind, p.x, p.y, p.got ? 1 : 0]), gateYs: course.gates,
      track: [...track, [r1(ship.x), r1(ship.y)]],
      crew: [...crew.values()].map(p => ({ id: p.id, name: p.name, roles: p.roles, seat: p.seat, ...p.st })),
      score: win ? r1(hull * 10 + timeLeft() * 5 + stats.pods * 50) : 0
    }
  }

  const done = () => over && t - endT >= cfg.endTime
  function tick(dt) {
    if (done()) return
    acc += Math.min(dt, 0.5)
    while (acc >= T.step && !done()) { acc -= T.step; step(T.step) }
  }

  // 途中で抜けた人の担当は、担当の少ない人に引き継ぐ（船が動かせなくなるのを防ぐ）
  function removePlayer(id) {
    const c = crew.get(id)
    if (!c) return
    crew.delete(id)
    if (c.roles.includes('helm')) steer = 0
    if (cat && cat.on === id) { cat = null; if (ev && ev.k === 'cat') ev = null }
    for (const r of c.roles) {
      const rest = [...crew.values()]
      if (!rest.length) break
      if (rest.some(p => p.roles.includes(r))) continue
      rest.sort((a, b) => a.roles.length - b.roles.length)[0].roles.push(r)
    }
  }

  return {
    tick, input, view, result, removePlayer,
    // 着いた・壊れたあとも endTime 秒は余韻を見せる（その間は phase='end' で操作は受け付けない）
    isOver: done,
    // テスト用の覗き窓（通信には出ない）
    _debug: {
      ship, sys, course, cfg, crew, breakSys, spawnMeteor, startEvent, drift, route,
      get hull() { return hull }, set hull(v) { hull = v },
      get o2() { return o2 }, set o2(v) { o2 = v },
      get energy() { return energy }, set energy(v) { energy = v },
      get heat() { return heat }, set heat(v) { heat = v },
      get meteors() { return meteors }, set meteors(v) { meteors = v },
      get phase() { return phase }, get throttle() { return throttle }, get ended() { return over },
      get sec() { return sec }, get bonus() { return bonus },
      get ev() { return ev }, get cat() { return cat },
      get nextEvent() { return nextEvent }, set nextEvent(v) { nextEvent = v },
      get nextFail() { return nextFail }, set nextFail(v) { nextFail = v },
      get nextMeteor() { return nextMeteor }, set nextMeteor(v) { nextMeteor = v },
      diff
    }
  }
}

function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  let u = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  u = Math.max(0, Math.min(1, u))
  return Math.hypot(ax + dx * u - px, ay + dy * u - py)
}

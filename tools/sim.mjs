// 全航路を自動操縦（全部見えている上手なクルー）で回し、着く割合・秒数・船体を表にする。調整用。
// 使い方: node tools/sim.mjs [航路] [回数]   LAZY=1 で修理と防衛をさぼるクルー（負けるはず）
import { pathToFileURL } from 'node:url'
import { createGame, ROUTE_IDS, ROUTES, TUNING, SYSTEMS } from '../lib/game.mjs'

const only = process.argv[2] && ROUTE_IDS.includes(process.argv[2]) ? [process.argv[2]] : ROUTE_IDS
const N = Number(process.argv[3]) || 20
const LAZY = !!process.env.LAZY

function rng(seed = 1) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }

export function makeBot(g) {
  const D = g._debug
  const ids = [...D.crew.keys()]
  const who = r => [...D.crew.values()].find(c => c.roles.includes(r))?.id
  let steer = 0
  return function act() {
    const s = D.ship
    // 操縦: 目的地へ。行く手の危険地帯と井戸の芯をよけ、近くの補給は拾いに行く
    let tx = D.course.goal.x, ty = D.course.goal.y
    const pod = D.course.pods.filter(p => !p.got && p.y > s.y + 100 && p.y < s.y + 700 && Math.abs(p.x - s.x) < 500)[0]
    if (pod) { tx = pod.x; ty = pod.y }
    const obs = [...D.course.hazards.map(h => [h.x, h.y, h.r]), ...D.course.wells.map(w => [w.x, w.y, w.r * 0.7])]
    let best = null
    for (const [hx, hy, r] of obs) {
      const dx = tx - s.x, dy = ty - s.y, l = Math.hypot(dx, dy) || 1
      const u = ((hx - s.x) * dx + (hy - s.y) * dy) / l
      if (u < 0 || u > l || u > 1500) continue
      const px = s.x + dx / l * u, py = s.y + dy / l * u
      if (Math.hypot(px - hx, py - hy) < r + 90 && (!best || u < best.u)) best = { u, px, py, hx, hy, r }
    }
    if (best) { let nx = best.px - best.hx, ny = best.py - best.hy; const nl = Math.hypot(nx, ny); if (nl < 1) { nx = 1; ny = 0 } else { nx /= nl; ny /= nl } tx = best.hx + nx * (best.r + 220); ty = best.hy + ny * (best.r + 220) }
    let d = Math.atan2(tx - s.x, ty - s.y) - s.h
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    const want = Math.abs(d) < 0.06 ? 0 : Math.sign(d)
    if (want !== steer) { g.input(who('helm'), { type: 'steer', dir: want }); steer = want }
    // エンジン
    const e = who('engine')
    if (D.heat >= 80) g.input(e, { type: 'throttle', level: 1 })
    else if (D.heat < 60) g.input(e, { type: 'throttle', level: 3 })
    if (D.heat >= 55 && D.energy > 35) g.input(e, { type: 'vent' })
    if (!LAZY) {
      // 修理
      const br = ['helm', 'life', 'engine', 'radar', 'cannon'].filter(k => D.sys[k].broken)
      for (const id of ids) if (D.crew.get(id)?.roles.includes('repair') && br.length) g.input(id, { type: 'repair', sys: br[0] })
      // 防衛: 一番近い隕石を先読みして撃つ
      for (const id of ids) {
        if (!D.crew.get(id)?.roles.includes('defense')) continue
        let m = null, md = 1e9
        for (const x of D.meteors) { const dd = Math.hypot(x.x - s.x, x.y - s.y); if (dd < md && dd < 650) { md = dd; m = x } }
        if (m) { const tt = md / TUNING.boltSpeed; g.input(id, { type: 'fire', a: Math.atan2(m.x + m.vx * tt - s.x, m.y + m.vy * tt - s.y) }) }
      }
    }
    // ネコ
    for (const id of ids) g.input(id, { type: 'shoo' })
    void SYSTEMS
  }
}

export function simulate(route, n, seed) {
  const g = createGame([...Array(n)].map((_, i) => ({ id: 'p' + i, name: 'P' + i })), { rng: rng(seed), route })
  const act = makeBot(g)
  let i = 0
  while (!g.isOver() && i < 20000) { g.tick(1 / 15); if (i % 2 === 0) act(); i++ }
  return g.result()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('航路        人数  着いた  平均秒  平均船体  時間切れ 大破 酸素 星3  出来事')
  for (const id of only) for (const n of [3, 5, 8]) {
    let win = 0, time = 0, hull = 0, why = { time: 0, hull: 0, o2: 0 }, s3 = 0, evs = 0
    for (let k = 1; k <= N; k++) {
      const r = simulate(id, n, k * 7 + n)
      if (r.win) { win++; time += r.time; hull += r.hull; if (r.stars === 3) s3++ } else why[r.reason]++
      evs += r.events.length
    }
    console.log(`${(ROUTES[id].name).padEnd(10, '　')} ${n}人  ${String(Math.round(win / N * 100)).padStart(3)}%  ${String(win ? Math.round(time / win) : '-').padStart(5)}  ${String(win ? Math.round(hull / win) : '-').padStart(6)}    ${why.time}    ${why.hull}   ${why.o2}   ${s3}   ${(evs / N).toFixed(1)}`)
  }
}

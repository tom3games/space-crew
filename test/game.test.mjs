// 宇宙船クルーのルールの単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame, rolesFor, ROLES, SYSTEMS, DEFAULTS, TUNING } from '../lib/game.mjs'

function rng(seed = 1) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const run = (g, sec) => { for (let i = 0; i < Math.round(sec * 15); i++) g.tick(1 / 15) }
const players = n => [...Array(n)].map((_, i) => ({ id: 'p' + i, name: 'P' + i }))
// 発進まで進め、自然故障と隕石を止めた状態の船を作る（狙ったことだけを試すため）
function setup(n = 5, { calm = true, config } = {}) {
  const g = createGame(players(n), { rng: rng(7), config })
  const D = g._debug
  run(g, DEFAULTS.briefTime + 0.1)
  if (calm) { D.nextFail = 1e9; D.nextMeteor = 1e9; D.course.hazards.length = 0 }
  const who = r => [...D.crew.values()].find(c => c.roles.includes(r)).id
  return { g, D, who }
}

test('1〜8人のどの人数でも、5つの担当が全部だれかに配られ、全員に担当がある', () => {
  for (let n = 1; n <= 8; n++) {
    const sets = rolesFor(n)
    assert.equal(sets.length, n)
    assert.deepEqual([...new Set(sets.flat())].sort(), [...ROLES].sort())
    const g = createGame(players(n), { rng: rng(n) })
    for (const p of players(n)) assert.ok(g.view(p.id).roles.length >= 1)
  }
  assert.deepEqual(createGame(players(1), { rng: rng() }).view('p0').roles.sort(), [...ROLES].sort())
})

test('発進前（担当の確認中）は操作を受け付けず、時間がたつと発進する', () => {
  const g = createGame(players(5), { rng: rng() })
  const helm = [...g._debug.crew.values()].find(c => c.roles.includes('helm')).id
  assert.equal(g.view(helm).phase, 'brief')
  assert.equal(g.input(helm, { type: 'steer', dir: 1 }).error, 'not_started')
  run(g, DEFAULTS.briefTime + 0.1)
  assert.equal(g.view(helm).phase, 'fly')
  assert.equal(g.input(helm, { type: 'steer', dir: 1 }).ok, true)
})

test('担当以外の操作はサーバーが拒否し、状態は変わらない', () => {
  const { g, D, who } = setup(5)
  const eng = who('engine')
  assert.equal(g.input(eng, { type: 'steer', dir: 1 }).error, 'not_your_role')
  assert.equal(g.input(who('helm'), { type: 'throttle', level: 3 }).error, 'not_your_role')
  assert.equal(g.input(who('nav'), { type: 'fire', a: 0 }).error, 'not_your_role')
  assert.equal(g.input(who('defense'), { type: 'mark', x: 0, y: 100 }).error, 'not_your_role')
  assert.equal(g.input(who('helm'), { type: 'repair', sys: 'engine' }).error, 'not_your_role')
  run(g, 1)
  assert.equal(D.ship.h, 0)
  assert.equal(D.throttle, 1)
})

test('不正な入力は { error } を返して状態を変えない', () => {
  const { g, D, who } = setup(5)
  const before = JSON.stringify(g.view(who('helm')))
  for (const [id, d] of [
    [who('helm'), null], [who('helm'), 'steer'], [who('helm'), { type: 'warp' }], [who('helm'), { type: 'steer', dir: 5 }],
    [who('engine'), { type: 'throttle', level: 4 }], [who('engine'), { type: 'throttle', level: '3' }],
    [who('defense'), { type: 'fire', a: NaN }], [who('defense'), { type: 'fire', a: 'x' }],
    [who('nav'), { type: 'mark', x: Infinity, y: 0 }], [who('repair'), { type: 'repair', sys: '__proto__' }],
    [who('repair'), { type: 'repair', sys: 'engine' }], // 壊れていない
    [who('nav'), { type: 'call', id: 'toString' }], [who('nav'), { type: 'call', id: 'fix:engine' }], [who('nav'), { type: 'call', id: 5 }],
    ['nobody', { type: 'steer', dir: 1 }]
  ]) assert.ok(g.input(id, d).error, JSON.stringify(d))
  assert.equal(JSON.stringify(g.view(who('helm'))), before)
  assert.equal(D.energy, 100)
})

test('操縦で向きが変わり、エンジンの出力で速度が変わる', () => {
  const { g, D, who } = setup(5)
  g.input(who('engine'), { type: 'throttle', level: 3 })
  run(g, 4)
  assert.ok(D.ship.v > 100, 'v=' + D.ship.v)
  g.input(who('helm'), { type: 'steer', dir: 1 })
  run(g, 0.5)
  g.input(who('helm'), { type: 'steer', dir: 0 })
  assert.ok(D.ship.h > 0.5 && D.ship.h < 0.7, 'h=' + D.ship.h)
  const x = D.ship.x
  run(g, 1)
  assert.ok(D.ship.x > x + 50, '右に進む')
  g.input(who('engine'), { type: 'throttle', level: 0 })
  run(g, 5)
  assert.equal(D.ship.v, 0)
})

test('動きは固定ステップ。tick の間隔が揺れても同じ位置になる', () => {
  const a = setup(5), b = setup(5)
  for (const s of [a, b]) { s.g.input(s.who('engine'), { type: 'throttle', level: 2 }); s.g.input(s.who('helm'), { type: 'steer', dir: -1 }) }
  run(a.g, 3)
  const jit = [0.05, 0.09, 0.06, 0.08, 0.0667, 0.0667]
  let tsum = 0, i = 0
  while (tsum < 3 - 1e-9) { const d = Math.min(jit[i++ % jit.length], 3 - tsum); b.g.tick(d); tsum += d }
  assert.ok(Math.abs(a.D.ship.x - b.D.ship.x) < 3 && Math.abs(a.D.ship.y - b.D.ship.y) < 3, `${a.D.ship.x},${a.D.ship.y} / ${b.D.ship.x},${b.D.ship.y}`)
})

test('目的地に着くと勝ち。結果に到着と星が入る', () => {
  const { g, D } = setup(5)
  D.ship.x = D.course.goal.x; D.ship.y = D.course.goal.y - 100
  run(g, 0.1)
  assert.equal(g.isOver(), true)
  const r = g.result()
  assert.equal(r.win, true); assert.equal(r.reason, 'arrive'); assert.equal(r.title, '到着')
  assert.equal(r.stars, 3)
  assert.equal(r.crew.length, 5)
  assert.ok(g.input('p0', { type: 'call', id: 'help' }).error) // 終わったら操作できない
})

test('船体が0で負け（大破）', () => {
  const { g, D } = setup(5)
  D.hull = 0.01
  D.ship.x = DEFAULTS.halfWidth + 100 // 航路の外で削れる
  run(g, 0.2)
  assert.equal(g.result().reason, 'hull'); assert.equal(g.result().win, false)
})

test('生命維持が壊れたままだと酸素が尽きて負け', () => {
  const { g, D } = setup(5)
  D.breakSys('life')
  run(g, 100 / TUNING.o2Loss + 1)
  assert.equal(g.isOver(), true)
  assert.equal(g.result().reason, 'o2')
})

test('時間切れで負け', () => {
  const { g } = setup(5)
  run(g, DEFAULTS.timeLimit + 0.5)
  assert.equal(g.isOver(), true)
  assert.equal(g.result().reason, 'time')
  assert.equal(g.result().score, 0)
})

test('故障は修理の連打で直る。直すまで効果が続く', () => {
  const { g, D, who } = setup(5)
  g.input(who('engine'), { type: 'throttle', level: 3 })
  D.breakSys('engine')
  run(g, 4)
  assert.ok(D.ship.v <= TUNING.limpSpeed + 0.1, 'エンジン故障中は遅い')
  assert.equal(g.view(who('engine')).sys.engine, 0)
  const rep = who('repair')
  assert.equal(g.input(rep, { type: 'repair', sys: 'engine' }).ok, true)
  assert.equal(g.input(rep, { type: 'repair', sys: 'engine' }).error, 'cooldown') // 連打しすぎは捨てる
  let taps = 1
  while (D.sys.engine.broken && taps < 50) { run(g, 0.1); g.input(rep, { type: 'repair', sys: 'engine' }); taps++ }
  assert.equal(D.sys.engine.broken, false)
  assert.equal(taps, Math.ceil(100 / TUNING.repairPerTap))
  assert.equal(g.result().fixed, 1)
  assert.equal(g.result().crew.find(c => c.id === rep).repairs, 1)
})

test('操舵装置が壊れると舵が効かず、勝手に曲がる', () => {
  const { g, D, who } = setup(5)
  D.breakSys('helm')
  const h = D.ship.h
  g.input(who('helm'), { type: 'steer', dir: 1 })
  run(g, 2)
  assert.ok(Math.abs(D.ship.h - h) < 0.5 && Math.abs(D.ship.h - h) > 0.1, 'drift ' + (D.ship.h - h))
})

test('全開を続けると過熱してエンジンが壊れる。冷却で熱が下がる', () => {
  const { g, D, who } = setup(5)
  const e = who('engine')
  g.input(e, { type: 'throttle', level: 3 })
  D.heat = 50
  assert.equal(g.input(e, { type: 'vent' }).ok, true)
  assert.equal(D.heat, 10)
  assert.equal(g.input(e, { type: 'vent' }).error, 'cooldown')
  D.heat = 99
  run(g, 0.5)
  assert.equal(D.sys.engine.broken, true)
})

test('撃った弾が隕石に当たると消える。待ち時間・電力・砲台の故障を守る', () => {
  const { g, D, who } = setup(5)
  const d = who('defense')
  D.meteors = [{ id: 999, x: 0, y: 300, vx: 0, vy: 0, age: 0 }]
  assert.equal(g.input(d, { type: 'fire', a: 0 }).ok, true)
  assert.equal(g.input(d, { type: 'fire', a: 0 }).error, 'cooldown')
  run(g, 0.5)
  assert.equal(D.meteors.length, 0)
  assert.equal(g.result().meteorsShot, 1)
  assert.equal(D.energy < 100, true)
  D.energy = 3
  assert.equal(g.input(d, { type: 'fire', a: 0 }).error, 'no_energy')
  D.energy = 100
  D.breakSys('cannon')
  assert.equal(g.input(d, { type: 'fire', a: 0 }).error, 'cannon_broken')
})

test('隕石が船に当たると船体が減る', () => {
  const { g, D } = setup(5)
  D.meteors = [{ id: 1, x: 0, y: 60, vx: 0, vy: -100, age: 0 }]
  run(g, 1)
  assert.equal(D.hull, 100 - TUNING.meteorHit)
  assert.equal(g.result().hitsTaken, 1)
})

test('秘密: 危険地帯の地図はナビだけに届く。隕石は操縦と防衛だけ', () => {
  const g = createGame(players(5), { rng: rng(3) })
  const D = g._debug
  run(g, DEFAULTS.briefTime + 0.1)
  D.spawnMeteor()
  for (const c of D.crew.values()) {
    const v = g.view(c.id)
    const s = JSON.stringify(v)
    const isNav = c.roles.includes('nav')
    assert.equal(!!v.map, isNav, c.roles.join())
    assert.equal('radar' in v, isNav)
    if (!isNav) for (const h of D.course.hazards) assert.ok(!s.includes(`${h.x},${h.y},${h.r}`), '地図の数字が漏れていない')
    const seesMeteors = c.roles.includes('helm') || c.roles.includes('defense')
    assert.equal('meteors' in v, seesMeteors, c.roles.join())
    assert.equal('marker' in v, c.roles.includes('helm') || c.roles.includes('nav'))
  }
})

test('地図は数秒おきにしか送らない。センサー故障中は送らず、目印も置けない', () => {
  const { g, D, who } = setup(5, { calm: false })
  D.nextFail = 1e9; D.nextMeteor = 1e9
  const nav = who('nav')
  assert.ok(g.view(nav).map)
  assert.equal(g.view(nav).map, undefined)
  run(g, TUNING.mapEvery + 0.1)
  assert.ok(g.view(nav).map)
  D.breakSys('radar')
  run(g, TUNING.mapEvery + 0.1)
  const v = g.view(nav)
  assert.equal(v.radar, false); assert.equal(v.map, undefined)
  assert.equal(g.input(nav, { type: 'mark', x: 0, y: 500 }).error, 'radar_broken')
})

test('ナビの目印は操縦に届く。範囲外は航路の中に収める', () => {
  const { g, who } = setup(5)
  assert.equal(g.input(who('nav'), { type: 'mark', x: 99999, y: 800 }).ok, true)
  assert.deepEqual(g.view(who('helm')).marker, { x: DEFAULTS.halfWidth, y: 800 })
})

test('掛け声は担当ごとに決まっている。修理の依頼は壊れた装置だけ', () => {
  const { g, D, who } = setup(5)
  assert.equal(g.input(who('nav'), { type: 'call', id: 'left' }).ok, true)
  assert.equal(g.input(who('nav'), { type: 'call', id: 'right' }).error, 'cooldown')
  assert.equal(g.input(who('repair'), { type: 'call', id: 'left' }).error, 'not_your_role')
  D.breakSys('life')
  assert.equal(g.input(who('engine'), { type: 'call', id: 'fix:life' }).ok, true)
  const calls = g.view(who('repair')).calls.map(c => c.text)
  assert.deepEqual(calls, ['左へ', '生命維持を修理して'])
})

test('途中退出: 抜けた人の担当は残りの人に引き継がれ、舵は戻る', () => {
  const { g, D, who } = setup(3)
  const h = who('helm')
  g.input(h, { type: 'steer', dir: 1 })
  g.removePlayer(h)
  const roles = [...D.crew.values()].flatMap(c => c.roles)
  assert.deepEqual([...new Set(roles)].sort(), [...ROLES].sort())
  assert.equal(g.view(who('helm')).steer, 0)
  run(g, 1)
  assert.equal(g.isOver(), false)
  g.removePlayer('ghost') // いない人を消しても落ちない
})

test('8人（最大）でも1人（最小）でも最後まで進む', () => {
  for (const n of [1, 8]) {
    const g = createGame(players(n), { rng: rng(n) })
    run(g, DEFAULTS.briefTime + DEFAULTS.timeLimit + 1)
    assert.equal(g.isOver(), true)
    assert.equal(g.result().crew.length, n)
  }
})

test('故障は勝手に起き、人数が多いほど起きやすい', () => {
  const count = n => { let s = 0; for (let k = 1; k <= 6; k++) { const g = createGame(players(n), { rng: rng(k) }); g._debug.course.hazards.length = 0; g._debug.nextMeteor = 1e9; run(g, 60); s += g.result().failures } return s }
  const one = count(1), eight = count(8)
  assert.ok(one > 0)
  assert.ok(eight > one, `${one} < ${eight}`)
})

test('view は毎回小さい（毎秒15回送るため）', () => {
  const { g, D, who } = setup(8, { calm: false })
  for (let i = 0; i < 10; i++) D.spawnMeteor()
  const sizes = [...D.crew.values()].map(c => { g.view(c.id); return JSON.stringify(g.view(c.id)).length })
  assert.ok(Math.max(...sizes) < 2000, sizes.join())
  void who; void SYSTEMS
})

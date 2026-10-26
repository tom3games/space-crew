// 宇宙船クルーのルールの単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame, rolesFor, ROLES, SYSTEMS, DEFAULTS, TUNING, ROUTES, ROUTE_IDS, DEFAULT_ROUTE } from '../lib/game.mjs'

function rng(seed = 1) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const run = (g, sec) => { for (let i = 0; i < Math.round(sec * 15); i++) g.tick(1 / 15) }
const players = n => [...Array(n)].map((_, i) => ({ id: 'p' + i, name: 'P' + i }))
// 発進まで進め、自然故障と隕石を止めた状態の船を作る（狙ったことだけを試すため）
function setup(n = 5, { calm = true, config, route } = {}) {
  const g = createGame(players(n), { rng: rng(7), config, route })
  const D = g._debug
  run(g, DEFAULTS.briefTime + 0.1)
  if (calm) { D.nextFail = 1e9; D.nextMeteor = 1e9; D.course.hazards.length = 0; D.course.wells.length = 0; D.course.pods.length = 0 }
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
  g.view(who('helm')) // 最初の1回だけ届く位置情報（objs）を先に受け取っておく
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
  assert.equal(g.isOver(), false, '余韻の間はまだ終わらない')
  assert.deepEqual(g.view('p0').end, { win: true, reason: 'arrive' })
  assert.equal(g.view('p0').phase, 'end')
  assert.equal(g.input('p0', { type: 'call', id: 'help' }).error, 'over')
  run(g, DEFAULTS.endTime + 0.1)
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
  run(g, 0.2 + DEFAULTS.endTime)
  assert.equal(g.result().reason, 'hull'); assert.equal(g.result().win, false)
})

test('生命維持が壊れたままだと酸素が尽きて負け', () => {
  const { g, D } = setup(5)
  D.breakSys('life')
  run(g, 100 / TUNING.o2Loss + 1 + DEFAULTS.endTime)
  assert.equal(g.isOver(), true)
  assert.equal(g.result().reason, 'o2')
})

test('時間切れで負け', () => {
  const { g, who } = setup(5)
  g.input(who('engine'), { type: 'throttle', level: 0 }) // 中継ラインを越えると時間が増えるので止まっておく
  run(g, DEFAULTS.timeLimit + 0.5 + DEFAULTS.endTime)
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
    run(g, DEFAULTS.briefTime + DEFAULTS.timeLimit + DEFAULTS.endTime + 1)
    assert.equal(g.isOver(), true)
    assert.equal(g.result().crew.length, n)
  }
})

test('故障は勝手に起き、人数が多いほど起きやすい', () => {
  const count = n => { let s = 0; for (let k = 1; k <= 6; k++) { const g = createGame(players(n), { rng: rng(k) }); g._debug.course.hazards.length = 0; g._debug.course.pods.length = 0; g._debug.nextMeteor = 1e9; run(g, 60); s += g.result().failures } return s }
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

// ---- 航路・区間・仕掛け・出来事

test('航路: 知らない航路は既定に戻る。航路ごとに長さ・時間・仕掛けの数が変わる', () => {
  assert.equal(createGame(players(2), { rng: rng(), route: '__proto__' }).view('p0').route, DEFAULT_ROUTE)
  assert.equal(createGame(players(2), { rng: rng(), route: 42 }).view('p0').route, DEFAULT_ROUTE)
  for (const id of ROUTE_IDS) {
    const R = ROUTES[id]
    const g = createGame(players(3), { rng: rng(11), route: id })
    const D = g._debug
    assert.equal(D.cfg.goalDist, R.goalDist, id)
    assert.equal(g.view('p0').limit, R.timeLimit)
    assert.equal(D.course.gates.length, R.sections - 1, id + ' 中継ラインの数')
    assert.equal(D.course.wells.length, R.wells, id + ' 重力井戸の数')
    assert.equal(D.course.pods.length, R.pods, id + ' 補給の数')
    assert.equal(D.course.hazards.filter(h => h.k === 'field').length, R.fields, id + ' 岩場の数')
    assert.equal(D.course.hazards.filter(h => h.k === 'storm').length, R.storms, id + ' 嵐の数')
  }
  // 長さを変えると仕掛けの数も比例する（e2e の短いコース）
  const short = createGame(players(3), { rng: rng(2), route: 'belt', config: { goalDist: 1800 } })._debug.course
  assert.ok(short.hazards.length <= 6 && short.hazards.length >= 2, '短いコース ' + short.hazards.length)
})

test('だんだん難しくなる: 危険地帯は奥ほど多く、大きい', () => {
  let front = 0, back = 0, rf = 0, rb = 0
  for (let k = 1; k <= 12; k++) {
    const D = createGame(players(3), { rng: rng(k), route: 'belt' })._debug
    for (const h of D.course.hazards) {
      if (h.y < D.cfg.goalDist / 2) { front++; rf += h.r } else { back++; rb += h.r }
    }
  }
  assert.ok(back > front * 1.4, `奥 ${back} / 手前 ${front}`)
  assert.ok(rb / back > rf / front, '奥の方が大きい')
})

test('中継ラインを越えると残り時間が増え、区間が進み、隕石と故障が起きやすくなる', () => {
  const { g, D } = setup(3, { route: 'belt' })
  const R = ROUTES.belt
  assert.equal(D.sec, 0)
  const d0 = D.diff()
  const left0 = g.view('p0').left
  D.ship.y = D.course.gates[0] + 1
  run(g, 0.1)
  assert.equal(D.sec, 1)
  assert.equal(g.view('p0').sec, 1)
  assert.ok(Math.abs(g.view('p0').left - (left0 + R.gateBonus - 0.1)) < 0.2, '時間が増える')
  assert.ok(D.diff() > d0)
  assert.ok(Number.isFinite(D.nextEvent), '区間2から出来事が起き始める')
  assert.ok(g.view('p0').events.some(e => e.kind === 'gate'))
  D.ship.y = D.course.gates[1] + 1
  run(g, 0.1)
  assert.equal(D.sec, 2)
  assert.equal(D.diff(), TUNING.diffHi)
  assert.equal(g.result().gates, 2)
})

test('月の航路は最後の区間まで出来事が起きない', () => {
  const { g, D } = setup(3, { route: 'moon' })
  D.ship.y = D.course.gates[0] + 1
  run(g, 0.1)
  assert.equal(D.nextEvent, Infinity)
  D.ship.y = D.course.gates[1] + 1
  run(g, 0.1)
  assert.ok(Number.isFinite(D.nextEvent))
})

test('重力井戸は船を中心へ引き寄せ、芯に入ると船体が削れる', () => {
  const { g, D, who } = setup(3, { route: 'hole' })
  D.course.wells.push({ id: 9, x: 400, y: 600, r: 400 })
  g.input(who('engine'), { type: 'throttle', level: 0 })
  D.ship.x = 100; D.ship.y = 600 // 中心から300（中の外寄り）
  run(g, 1.5)
  assert.ok(D.ship.x > 120, '中心へ寄る x=' + D.ship.x)
  assert.equal(g.view('p0').well, true)
  const h0 = D.hull
  D.ship.x = 400; D.ship.y = 600; D.drift.x = 0; D.drift.y = 0
  run(g, 1)
  assert.ok(D.hull < h0 - TUNING.wellDmg * 0.8, '芯で削れる ' + (h0 - D.hull))
})

test('補給ポッドは1回だけ拾えて、船体・酸素・電力が戻る。拾ったことは全員に届く', () => {
  const { g, D } = setup(3)
  D.course.pods.push({ id: 1, kind: 'hull', x: 0, y: 30, got: false }, { id: 2, kind: 'o2', x: 0, y: 40, got: false }, { id: 3, kind: 'energy', x: 3000, y: 3000, got: false })
  D.hull = 50; D.o2 = 30
  run(g, 0.1)
  assert.equal(D.hull, 50 + TUNING.podHull)
  assert.ok(D.o2 >= 30 + TUNING.podO2)
  for (const p of ['p0', 'p1', 'p2']) assert.deepEqual(g.view(p).got, [1, 2])
  D.hull = 50
  run(g, 0.5)
  assert.equal(D.hull, 50, '2回目は拾えない')
  assert.equal(g.result().pods, 2)
  assert.equal(g.result().podsTotal, 3)
})

test('井戸と補給の位置は全員に、数秒おきに届く（ナビ以外にも）。危険地帯は混ざらない', () => {
  const { g, D } = setup(5, { calm: false, route: 'hole' })
  for (const c of D.crew.values()) {
    const v = g.view(c.id)
    assert.ok(v.objs && v.objs.filter(o => o[0] === 'well').length === ROUTES.hole.wells, c.roles.join())
    assert.equal(g.view(c.id).objs, undefined, '続けては送らない')
    assert.ok(!JSON.stringify(v.objs).includes('field') && !JSON.stringify(v.objs).includes('storm'))
  }
})

test('太陽風は予告のあと船を横に流す', () => {
  const { g, D, who } = setup(3, { route: 'storm' })
  g.input(who('engine'), { type: 'throttle', level: 0 })
  D.startEvent('wind')
  const dir = D.ev.dir
  assert.equal(g.view('p0').ev[0], 'wind')
  assert.ok(g.view('p0').ev[1] > 2, '予告の秒数')
  run(g, TUNING.warnTime - 0.2)
  assert.ok(Math.abs(D.ship.x) < 1, '予告の間は流れない')
  run(g, 3)
  assert.ok(D.ship.x * dir > 40, '風の向きに流れる ' + D.ship.x)
  run(g, TUNING.windTime + 1)
  assert.equal(D.ev, null)
})

test('流星群の間は隕石がたくさん来る', () => {
  const count = shower => {
    const { g, D } = setup(3, { route: 'belt' })
    D.nextMeteor = 0
    let ids = new Set()
    if (shower) { D.startEvent('shower'); run(g, TUNING.warnTime) }
    for (let i = 0; i < 6 * 15; i++) { g.tick(1 / 15); for (const m of D.meteors) ids.add(m.id) }
    return ids.size
  }
  const calm = count(false), storm = count(true)
  assert.ok(storm >= calm * 2.5, `${calm} -> ${storm}`)
})

test('宇宙ネコ: 乗られた人は追い払うまで操作できない。追い払えるのは本人だけ。全員に見える', () => {
  const { g, D, who } = setup(5, { route: 'belt' })
  D.startEvent('cat')
  const on = D.cat.on
  const me = D.crew.get(on)
  const other = [...D.crew.keys()].find(k => k !== on)
  for (const id of D.crew.keys()) {
    const v = g.view(id)
    assert.equal(v.cat.name, me.name)
    assert.equal(v.cat.me, id === on)
  }
  const op = { helm: { type: 'steer', dir: 1 }, engine: { type: 'throttle', level: 2 }, repair: { type: 'repair', sys: 'engine' }, nav: { type: 'mark', x: 0, y: 500 }, defense: { type: 'fire', a: 0 } }[me.roles[0]]
  assert.equal(g.input(on, op).error, 'cat')
  assert.equal(g.input(on, { type: 'call', id: 'help' }).ok, true, '声は出せる')
  assert.equal(g.input(other, { type: 'shoo' }).error, 'no_cat')
  for (let i = 0; i < TUNING.catHp; i++) { assert.equal(g.input(on, { type: 'shoo' }).ok, true); run(g, 0.1) }
  assert.equal(D.cat, null)
  assert.equal(g.view(on).cat, undefined)
  assert.notEqual(g.input(on, op).error, 'cat')
  assert.equal(g.result().catShooed, 1)
  assert.equal(g.result().crew.find(c => c.id === on).shoos, 1)
  void who
})

test('宇宙ネコは放っておくと時間で去る。乗られた人が抜けても止まらない', () => {
  const a = setup(3, { route: 'belt' })
  a.D.startEvent('cat')
  run(a.g, TUNING.catTime + 0.2)
  assert.equal(a.D.cat, null)
  const b = setup(3, { route: 'belt' })
  b.D.startEvent('cat')
  b.g.removePlayer(b.D.cat.on)
  assert.equal(b.D.cat, null)
  run(b.g, 1)
  assert.equal(b.g.isOver(), false)
})

test('出来事は自然に起き、結果に残る', () => {
  const { g, D } = setup(3, { route: 'belt', calm: false })
  D.nextFail = 1e9; D.nextMeteor = 1e9
  D.ship.y = D.course.gates[0] + 1
  run(g, 0.1)
  D.nextEvent = 0
  run(g, 0.2)
  assert.ok(D.ev, '出来事が起きた')
  assert.ok(g.result().events.length === 1)
})

test('全部の航路を1人と8人で最後まで回しても落ちない（勝手に終わる）', () => {
  for (const id of ROUTE_IDS) for (const n of [1, 8]) {
    const g = createGame(players(n), { rng: rng(n + id.length), route: id })
    const D = g._debug
    // 何もしないと時間切れか事故で終わる。出来事も起こす
    D.ship.y = D.course.gates.at(-1) + 1
    for (let i = 0; i < (DEFAULTS.briefTime + ROUTES[id].timeLimit + 200) * 15 && !g.isOver(); i++) {
      g.tick(1 / 15)
      if (i % 40 === 0) for (const c of D.crew.values()) { g.input(c.id, { type: 'shoo' }); g.view(c.id) }
    }
    assert.equal(g.isOver(), true, id + n)
    const r = g.result()
    assert.equal(r.route, id); assert.equal(r.crew.length, n)
    assert.ok(JSON.stringify(r).length < 40000)
  }
})

test('結果には担当ごとの成績（叩いた回数・撃った数・掛け声）が入る', () => {
  const { g, D, who } = setup(5)
  D.breakSys('engine')
  g.input(who('repair'), { type: 'repair', sys: 'engine' })
  g.input(who('defense'), { type: 'fire', a: 0 })
  g.input(who('helm'), { type: 'steer', dir: -1 })
  g.input(who('nav'), { type: 'call', id: 'sorry' })
  const r = g.result()
  const c = id => r.crew.find(x => x.id === id)
  assert.equal(c(who('repair')).taps, 1)
  assert.equal(c(who('defense')).shots, 1)
  assert.equal(c(who('helm')).steers, 1)
  assert.equal(c(who('nav')).sorry, 1)
  assert.ok(r.crew.every(x => Number.isInteger(x.seat)))
})

// ルーム管理の単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomManager, LIMITS, cleanName } from '../lib/rooms.mjs'
import * as gameDef from '../lib/game.mjs'

function setup() {
  let t = 0
  const sent = []
  const m = new RoomManager(gameDef, { send: (id, msg) => sent.push([id, msg]), now: () => t })
  const s = () => m.newSession().id
  return { m, s, sent, advance: ms => { t += ms; m.tick(ms) } }
}

test('部屋を作るとコードが出て、作った人がホストになる', () => {
  const { m, s } = setup()
  const a = s()
  const r = m.create(a, 'たろう')
  assert.match(r.code, /^[A-Z2-9]{4}$/)
  assert.equal(m.rooms.get(r.code).hostId, a)
})

test('参加コードで入れる。小文字でも入れる', () => {
  const { m, s } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  assert.deepEqual(m.join(b, code.toLowerCase(), 'B'), { code })
  assert.equal(m.rooms.get(code).players.length, 2)
})

test('入れないときは理由を返す（無い・満員・開始後・名前なし）', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  assert.equal(m.join(s(), 'ZZZZ', 'x').error, 'not_found')
  assert.equal(m.join(s(), code, '   ').error, 'bad_name')
  for (let i = 1; i < gameDef.meta.maxPlayers; i++) m.join(s(), code, 'p' + i)
  assert.equal(m.join(s(), code, 'over').error, 'full')
  const { code: c2 } = m.create(s(), 'H')
  const host = m.rooms.get(c2).hostId
  m.start(host)
  assert.equal(m.join(s(), c2, 'late').error, 'started')
})

test('名前は12文字まで・制御文字と<>は消す・同じ名前には番号がつく', () => {
  assert.equal(cleanName('<b>abcdefghijklmnop'), 'babcdefghijk')
  const { m, s } = setup()
  const { code } = m.create(s(), 'A')
  m.join(s(), code, 'A')
  assert.deepEqual(m.rooms.get(code).players.map(p => p.name), ['A', 'A2'])
})

test('ホスト以外はスタートできない。人数が足りないと始まらない', () => {
  const { m, s } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B')
  assert.equal(m.start(b).error, 'not_host')
  assert.equal(m.start(a).ok, true)
  assert.equal(m.rooms.get(code).phase, 'playing')
})

test('ゲームが終わると結果になり、ホストが再戦できる', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.start(a)
  const room = m.rooms.get(code)
  const D = room.game._debug
  for (let i = 0; i < 60; i++) m.tick(100) // 発進
  D.ship.x = D.course.goal.x; D.ship.y = D.course.goal.y
  m.tick(100)
  assert.equal(room.phase, 'result')
  assert.equal(room.result.win, true)
  assert.equal(m.rematch(a).ok, true)
  assert.equal(room.phase, 'playing')
  assert.equal(room.round, 2)
})

test('不正な入力は状態を変えない', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.start(a)
  for (let i = 0; i < 60; i++) m.tick(100)
  const before = JSON.stringify(m.rooms.get(code).game.view(a).ship)
  assert.equal(m.input(a, { type: 'hack', n: 999 }).error, 'bad_input')
  assert.equal(m.input(a, null).error, 'bad_input')
  assert.equal(JSON.stringify(m.rooms.get(code).game.view(a).ship), before)
  assert.equal(m.input(s(), { type: 'steer', dir: 1 }).error, 'not_playing') // 部屋にいない人
})

test('時間切れで負けになる', () => {
  const { m, s, advance } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.start(a)
  m.rooms.get(code).game._debug.course.hazards.length = 0
  m.input(a, { type: 'throttle', level: 0 })
  for (let i = 0; i < (gameDef.DEFAULTS.timeLimit + gameDef.DEFAULTS.briefTime + 1) * 10; i++) advance(100)
  assert.equal(m.rooms.get(code).phase, 'result')
  assert.equal(m.rooms.get(code).result.win, false)
})

test('画面から届いた opts は信用しない（rng や config を送ってもサーバーは落ちず、設定も変わらない）', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  assert.equal(m.start(a, { rng: 'x', config: { goalDist: 10, timeLimit: 1 }, junk: { a: 1 } }).ok, true)
  const g = m.rooms.get(code).game
  for (let i = 0; i < 60; i++) m.tick(100)
  assert.equal(g._debug.cfg.goalDist, gameDef.DEFAULTS.goalDist)
  assert.equal(m.start(a, 'garbage').error, 'started')
})

test('サーバー側の gameOpts だけはゲームの設定に使われる', () => {
  const m = new RoomManager(gameDef, { gameOpts: { config: { goalDist: 1234 } } })
  const a = m.newSession().id
  const { code } = m.create(a, 'A')
  m.start(a, { config: { goalDist: 5 } })
  assert.equal(m.rooms.get(code).game._debug.cfg.goalDist, 1234)
})

test('ホストが切れたままだと次の人がホストになる。戻れば同じ席', () => {
  const { m, s, advance } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B')
  m.disconnect(a)
  advance(LIMITS.hostGraceMs + 100)
  assert.equal(m.rooms.get(code).hostId, b)
  assert.equal(m.reconnect(a), code)
  assert.equal(m.rooms.get(code).players.find(p => p.id === a).connected, true)
})

test('切断が長いと席が消え、誰もいない部屋は消える', () => {
  const { m, s, advance } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.disconnect(a)
  advance(LIMITS.reconnectGraceMs + 100)
  assert.equal(m.rooms.get(code).players.length, 0)
  advance(LIMITS.emptyRoomMs + 100)
  assert.equal(m.rooms.has(code), false)
})

test('他人の token では席を奪えない', () => {
  const { m } = setup()
  const a = m.newSession()
  assert.equal(m.resume(a.id, 'wrong'), null)
  assert.ok(m.resume(a.id, a.token))
})

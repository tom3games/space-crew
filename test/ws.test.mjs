// 本物のサーバーを立てて、WebSocket で複数人がつなぐ統合テスト
import test from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { startServer } from '../server.mjs'
import * as gameDef from '../lib/game.mjs'

function client(port, saved) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`)
  const c = { ws, msgs: [], id: null, token: null, state: null }
  ws.on('message', d => {
    const m = JSON.parse(d)
    c.msgs.push(m)
    if (m.t === 'session') { c.id = m.id; c.token = m.token }
    if (m.t === 'state') c.state = m
  })
  c.ready = new Promise(r => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', ...(saved || {}) })); r() }))
  c.send = m => ws.send(JSON.stringify(m))
  c.wait = (pred, ms = 3000) => new Promise((res, rej) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      const hit = c.msgs.find(pred)
      if (hit) { clearInterval(iv); res(hit) } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')) }
    }, 10)
  })
  return c
}

test('2人がつないで、作成・参加・開始・操作・終了・再戦まで通る', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port), b = client(srv.port)
    await a.ready; await b.ready
    await a.wait(m => m.t === 'welcome'); await b.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' })
    const { code } = await a.wait(m => m.t === 'joined')
    b.send({ t: 'join', code, name: 'B' })
    await b.wait(m => m.t === 'joined')
    await a.wait(m => m.t === 'state' && m.players.length === 2)
    b.send({ t: 'start' })
    await b.wait(m => m.t === 'error' && m.code === 'not_host')
    a.send({ t: 'start' })
    await b.wait(m => m.t === 'state' && m.phase === 'playing')
    // 担当以外の操作はサーバーが拒否する
    const fly = await b.wait(m => m.t === 'state' && m.game && m.game.phase === 'fly', 6000)
    const bIsHelm = fly.game.roles.includes('helm')
    const [helm, other] = bIsHelm ? [b, a] : [a, b]
    other.send({ t: 'input', data: { type: 'steer', dir: 1 } })
    await other.wait(m => m.t === 'error' && m.code === 'not_your_role' && m.req === 'input')
    helm.send({ t: 'input', data: { type: 'steer', dir: 1 } })
    await helm.wait(m => m.t === 'state' && m.game && m.game.steer === 1)
    // 目的地の近くまで運んで到着させる
    const room = srv.rooms.rooms.get(code)
    const D = room.game._debug
    D.ship.x = D.course.goal.x; D.ship.y = D.course.goal.y - 50
    const end = await b.wait(m => m.t === 'state' && m.phase === 'result')
    assert.equal(end.result.win, true)
    assert.equal(end.result.title, '到着')
    a.send({ t: 'rematch' })
    await b.wait(m => m.t === 'state' && m.phase === 'playing' && m.round === 2)
    a.ws.close(); b.ws.close()
  } finally { await srv.close() }
})

test('切れても id と token で同じ席に戻れる。token が違うと別人になる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'session')
    a.send({ t: 'create', name: 'A' })
    const { code } = await a.wait(m => m.t === 'joined')
    const saved = { id: a.id, token: a.token }
    a.ws.close()
    await new Promise(r => setTimeout(r, 100))
    const a2 = client(srv.port, saved)
    const w = await a2.wait(m => m.t === 'welcome')
    assert.equal(w.code, code)
    const st = await a2.wait(m => m.t === 'state')
    assert.equal(st.you, saved.id)
    const evil = client(srv.port, { id: saved.id, token: 'x'.repeat(32) })
    const w2 = await evil.wait(m => m.t === 'welcome')
    assert.notEqual(w2.id, saved.id)
    assert.equal(w2.code, null)
    a2.ws.close(); evil.ws.close()
  } finally { await srv.close() }
})

test('操作を送りすぎても、部屋の操作（再戦など）は捨てられない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' }); await a.wait(m => m.t === 'joined')
    a.send({ t: 'start' }); await a.wait(m => m.t === 'state' && m.phase === 'playing')
    for (let i = 0; i < 300; i++) a.send({ t: 'input', data: { type: 'call', id: 'help' } }) // 一気に送る
    a.send({ t: 'leave' })
    await new Promise(r => setTimeout(r, 200))
    assert.equal(srv.rooms.rooms.get([...srv.rooms.rooms.keys()][0]).players.length, 0)
    a.ws.close()
  } finally { await srv.close() }
})

test('壊れたメッセージを送ってもサーバーは落ちない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready
    a.ws.send('not json')
    a.send({ nope: 1 })
    a.send({ t: 'input', data: { type: 'call', id: 'help' } })
    a.send({ t: 'start', opts: { rng: 'x', config: { goalDist: 'boom' } } }) // 部屋なし
    a.send({ t: 'create', name: 'A' }); await a.wait(m => m.t === 'joined')
    a.send({ t: 'start', opts: { rng: 'x', config: null } }) // 画面から rng を送っても落ちない
    await a.wait(m => m.t === 'state' && m.phase === 'playing')
    await a.wait(m => m.t === 'error' && m.code === 'bad_json')
    const res = await fetch(`http://localhost:${srv.port}/healthz`)
    assert.equal((await res.json()).ok, true)
    a.ws.close()
  } finally { await srv.close() }
})

test('画面と招待URL（/r/コード）が返る。フォルダの外は読めない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const base = `http://localhost:${srv.port}`
    assert.equal((await fetch(base + '/')).status, 200)
    assert.match(await (await fetch(base + '/r/ABCD')).text(), /<html/)
    assert.equal((await fetch(base + '/app.js')).status, 200)
    // og:image は届いた Host から絶対URLにする（SNS が相対URLを読まないため）。おかしな Host は使わない
    const og = await (await fetch(base + '/', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'crew.example.com' } })).text()
    assert.match(og, /og:image" content="https:\/\/crew\.example\.com\/og\.png"/)
    const bad = await (await fetch(base + '/', { headers: { 'x-forwarded-host': 'x"><b>' } })).text()
    assert.match(bad, /og:image" content="\/og\.png"/)
    assert.equal((await fetch(base + '/og.png')).status, 200)
    const r = await fetch(base + '/..%2fpackage.json')
    assert.notEqual(r.status, 200)
  } finally { await srv.close() }
})

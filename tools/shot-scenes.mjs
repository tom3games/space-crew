// 出来事・終わり方・航路ごとの 3D 画面を、通しで遊ばずに撮る（サーバーの中身を直接いじって場面を作る）。
// 使い方: node tools/shot-scenes.mjs [幅] [高さ]   → tools/shots/scene-*.png
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
const SHOTS = new URL('./shots/', import.meta.url).pathname
const W = Number(process.argv[2]) || 390, H = Number(process.argv[3]) || 844
const srv = await startServer({ port: 0, quiet: true, gameOpts: { config: { briefTime: 1.5 } } })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const errs = []
const mk = async () => { const c = await b.newContext({ viewport: { width: W, height: H }, locale: 'ja-JP', hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); return p }
const hp = await mk(), gp = await mk(), tp = await mk()
await hp.goto(base); await hp.fill('#name', 'たろう'); await hp.click('#createBtn'); await hp.waitForSelector('#lobby:not([hidden])')
const code = await hp.textContent('#roomCode')
for (const [p, n] of [[gp, 'はなこ'], [tp, 'じろう']]) { await p.goto(await hp.inputValue('#invite')); await p.fill('#name', n); await p.click('#joinBtn'); await p.waitForSelector('#lobby:not([hidden])') }
const room = () => srv.rooms.rooms.get(code)
const D = () => room().game._debug
const pages = [hp, gp, tp]
const sleep = ms => new Promise(r => setTimeout(r, ms))
const roleOf = async p => p.evaluate(() => window.__sc.roles)
async function pickRoute(id) { for (let i = 0; i < 6 && await hp.getAttribute('#routePick .pk-body', 'data-id') !== id; i++) await hp.click('#routePick .pk-btn[data-d="1"]') }
async function begin(route) {
  if (await hp.isVisible('#result')) { await hp.click('#lobbyBtn'); await hp.waitForSelector('#lobby:not([hidden])') }
  await pickRoute(route); await sleep(200)
  await hp.click('#startBtn')
  await hp.waitForFunction(() => window.__sc && window.__sc.phase === 'fly', null, { timeout: 8000 })
  D().nextFail = 1e9; D().nextMeteor = 1e9; D().nextEvent = 1e9 // 場面を作る間は勝手に起きないように
  await sleep(1200)
}
const who = async role => { for (const p of pages) if ((await roleOf(p)).includes(role)) return p }
const tab = async (p, r) => { if (await p.$(`.sc-tabs button[data-role="${r}"]`)) await p.dispatchEvent(`.sc-tabs button[data-role="${r}"]`, 'pointerdown') }
const shot = async (p, name) => { await p.screenshot({ path: `${SHOTS}scene-${name}.png` }); console.log('scene', name) }

// 1. 小惑星帯: ふつう・隕石・ネコ・電磁嵐・故障・中継ライン・補給
await begin('belt')
const helm = await who('helm'), nav = await who('nav'), def = await who('defense')
await tab(helm, 'helm'); await shot(helm, 'belt-fly')
for (let i = 0; i < 6; i++) D().spawnMeteor()
await sleep(900); await tab(def, 'defense'); await shot(def, 'meteors')
D().meteors = []
D().startEvent('cat'); await sleep(700)
for (const p of pages) if (await p.evaluate(() => window.__sc.cat && window.__sc.cat.me)) { await shot(p, 'cat-me'); break }
for (const p of pages) if (await p.evaluate(() => window.__sc.cat && !window.__sc.cat.me)) { await shot(p, 'cat-other'); break }
for (const p of pages) if (await p.evaluate(() => window.__sc.cat && window.__sc.cat.me)) for (let k = 0; k < 8; k++) await p.dispatchEvent('#sc-cat', 'pointerdown')
const storm = D().course.hazards.find(h => h.k === 'storm')
if (storm) { D().ship.x = storm.x; D().ship.y = storm.y - storm.r * 0.5; D().ship.h = 0; await sleep(900); await tab(nav, 'nav'); await shot(nav, 'storm-nav'); await shot(helm, 'storm-helm') }
D().breakSys('engine'); D().breakSys('life'); D().breakSys('radar')
const rep = await who('repair'); await tab(rep, 'repair'); await sleep(600); await shot(rep, 'broken-repair'); await shot(nav, 'broken-nav')
D().ship.x = 0; D().ship.y = D().course.gates[0] - 40; D().ship.h = 0
await sleep(700); await shot(helm, 'gate')
const pod = D().course.pods.find(p => !p.got)
if (pod) { D().ship.x = pod.x; D().ship.y = pod.y - 160; D().ship.h = 0; await sleep(1000); await shot(helm, 'pod') }
// 到着
D().ship.x = D().course.goal.x; D().ship.y = D().course.goal.y - 260; D().ship.h = 0
await sleep(700); await shot(helm, 'win-0.7s'); await sleep(900); await shot(gp, 'win-1.6s')
await hp.waitForSelector('#result:not([hidden])', { timeout: 10000 }); await sleep(1200); await shot(hp, 'result-win')

// 2. ブラックホール: 重力井戸 → 大破
await begin('hole')
const h2 = await who('helm')
const well = D().course.wells[0]
if (well) { D().ship.x = well.x; D().ship.y = well.y - well.r * 0.8; D().ship.h = 0; await sleep(900); await tab(h2, 'helm'); await shot(h2, 'well') }
D().hull = 0
await sleep(400); await shot(h2, 'hull-0.4s'); await sleep(900); await shot(gp, 'hull-1.3s')
await hp.waitForSelector('#result:not([hidden])', { timeout: 10000 }); await sleep(1200); await shot(hp, 'result-hull')

// 3. 電磁嵐の海 → 酸素切れ / 4. 月 → 時間切れ / 5. 銀河横断
await begin('storm'); await shot(hp, 'storm-fly')
D().breakSys('life'); D().o2 = 0.05; await sleep(900); await shot(hp, 'o2-end')
await hp.waitForSelector('#result:not([hidden])', { timeout: 10000 }); await sleep(1200); await shot(gp, 'result-o2')
await begin('moon'); await shot(hp, 'moon-fly')
D().cfg.timeLimit = 0; await sleep(1000); await shot(hp, 'time-end')
await hp.waitForSelector('#result:not([hidden])', { timeout: 10000 }); await sleep(1200); await shot(tp, 'result-time')
await begin('long'); await shot(hp, 'long-fly'); await shot(gp, 'long-fly2')
console.log('errors', errs.length, errs.slice(0, 3))
await b.close(); await srv.close()

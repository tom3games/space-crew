// og.png（1200x630）を作り直す。実際のゲームの 3D 画面（小惑星帯を4人で飛んでいる所）を撮り、左にロゴと一言を重ねる。
// 使い方: node tools/make-og.mjs
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { startServer } from '../server.mjs'
const out = new URL('../public/og.png', import.meta.url).pathname
const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')
const logo = index.match(/<svg class="logo-svg"[\s\S]*?<\/svg>/)[0]
const srv = await startServer({ port: 0, quiet: true, gameOpts: { config: { briefTime: 1 } } })
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ps = []
for (let i = 0; i < 4; i++) ps.push(await (await b.newContext({ viewport: { width: 900, height: 630 }, deviceScaleFactor: 2, locale: 'ja-JP' })).newPage())
const [hp] = ps
await hp.goto(`http://localhost:${srv.port}`); await hp.fill('#name', 'A'); await hp.click('#createBtn'); await hp.waitForSelector('#lobby:not([hidden])')
const code = await hp.textContent('#roomCode')
for (let i = 0; i < 6 && await hp.getAttribute('#routePick .pk-body', 'data-id') !== 'belt'; i++) await hp.click('#routePick .pk-btn[data-d="1"]')
for (const [i, p] of ps.slice(1).entries()) { await p.goto(await hp.inputValue('#invite')); await p.fill('#name', 'P' + i); await p.click('#joinBtn'); await p.waitForSelector('#lobby:not([hidden])') }
await hp.click('#startBtn')
await hp.waitForFunction(() => window.__sc && window.__sc.phase === 'fly')
const D = srv.rooms.rooms.get(code).game._debug
D.nextFail = 1e9; D.nextEvent = 1e9; D.nextMeteor = 1e9
D.ship.x = 0; D.ship.y = D.course.gates[0] - 700; D.ship.h = 0.12
let shooter = ps[0]
for (const p of ps) if (await p.evaluate(() => window.__sc.roles.includes('defense'))) shooter = p
await shooter.addStyleTag({ content: '.sc-dock,.sc-hud,.sc-prog,.sc-feed,.me-tag,.edge,.sc-banner{display:none!important}.sc-view{flex:1 1 auto!important}' })
await shooter.waitForTimeout(1500)
for (let i = 0; i < 4; i++) D.spawnMeteor()
for (const p of ps.slice(0, 2)) await p.dispatchEvent('.call-btn[data-call="nice"]', 'pointerdown').catch(() => {})
await shooter.waitForTimeout(700)
const shot = (await shooter.locator('#sc-view').screenshot()).toString('base64')
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=RocknRoll+One&family=Zen+Maru+Gothic:wght@700;900&display=swap">
<style>
body{margin:0;width:1200px;height:630px;overflow:hidden;background:#0d0826;font-family:"Zen Maru Gothic","Hiragino Maru Gothic ProN",sans-serif}
.bg{position:absolute;right:0;top:0;width:900px;height:630px;background:url(data:image/png;base64,${shot}) center/cover}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#0d0826 0,#0d0826 300px,rgba(13,8,38,.7) 420px,rgba(13,8,38,0) 640px)}
.left{position:absolute;left:50px;top:40px;width:600px;display:flex;flex-direction:column;gap:14px}
.logo-svg{width:500px;height:auto;filter:drop-shadow(0 8px 0 rgba(0,0,0,.4))}
.tag{margin:0;color:#fff;font-size:30px;font-weight:900;line-height:1.45;text-shadow:0 3px 0 #140c33}
.tag b{color:#ffd23f}
.chips{display:flex;gap:10px;flex-wrap:wrap}
.chips span{padding:6px 13px;border-radius:14px;background:#f6f1e7;color:#140c33;border:4px solid #140c33;box-shadow:0 5px 0 #140c33;font-size:21px;font-weight:900}
.n{position:absolute;right:28px;bottom:26px;padding:10px 20px;border-radius:16px;background:#ff8a1f;color:#fff;border:4px solid #140c33;box-shadow:0 6px 0 #140c33;font-family:"RocknRoll One",sans-serif;font-size:30px;transform:rotate(-3deg)}
</style>
<div class="bg"></div><div class="fade"></div>
<div class="left">${logo}<p class="tag">危険が見えるのは<b>ナビだけ</b>。<br>声を掛け合って、壊れる船を運べ。</p>
<div class="chips"><span>操縦</span><span>エンジン</span><span>修理</span><span>ナビ</span><span>防衛</span></div></div>
<div class="n">スマホで1〜8人</div>`
const og = await b.newPage({ viewport: { width: 1200, height: 630 } })
await og.setContent(html, { waitUntil: 'networkidle' })
await og.evaluate(() => document.fonts.ready)
await og.waitForTimeout(400)
await og.screenshot({ path: out })
await b.close(); await srv.close()
console.log('wrote', out)

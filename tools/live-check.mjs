// 公開URL（または手元）で2人（chromium と webkit）つなぎ、「月までおつかい」を最後まで飛んで再戦まで確かめる。
// あわせて、起動エラーの誤表示が出ないこと（20秒待っても #bootErr が隠れたまま）と、OGP が取れることを見る。
// 使い方: node tools/live-check.mjs https://xxxx.trycloudflare.com   （URL を省くと手元にサーバーを立てる）
import { chromium, webkit } from 'playwright'
import * as play from './e2e-play.mjs'
let base = process.argv[2], srv = null
if (!base) { const { startServer } = await import('../server.mjs'); srv = await startServer({ port: 0, quiet: true }); base = `http://localhost:${srv.port}` }
base = base.replace(/\/$/, '')
let fail = 0
const check = (ok, label) => { console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const errs = []
const bc = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const bw = await webkit.launch()
const mk = async (b, name) => {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true })
  const p = await c.newPage()
  p.on('pageerror', e => errs.push(name + ': ' + e.message))
  p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()))
  return p
}
const h = await mk(bc, 'chromium'), g = await mk(bw, 'webkit')
await h.goto(base); await h.waitForSelector('#home:not([hidden])', { timeout: 30000 })
await h.waitForTimeout(20500)
check(await h.evaluate(() => document.getElementById('bootErr').hidden && window.__boot === true), 'chromium: 20秒待っても起動エラーの表示が出ない')
await h.fill('#name', 'ホスト'); await h.click('#createBtn'); await h.waitForSelector('#lobby:not([hidden])')
for (let i = 0; i < 6 && await h.getAttribute('#routePick .pk-body', 'data-id') !== 'moon'; i++) await h.click('#routePick .pk-btn[data-d="1"]')
await g.goto(await h.inputValue('#invite')); await g.waitForSelector('#home:not([hidden])', { timeout: 30000 })
await g.fill('#name', 'ゲスト'); await g.click('#joinBtn'); await g.waitForSelector('#lobby:not([hidden])')
await g.waitForFunction(() => document.querySelector('#routePick .pk-body')?.dataset.id === 'moon', null, { timeout: 8000 }).then(() => check(true, '航路「月までおつかい」がゲスト（webkit）にも見える'), () => check(false, 'ゲストに航路が届かない'))
await h.click('#startBtn')
await Promise.all([h, g].map(p => p.waitForFunction(() => window.__sc && window.__sc.phase === 'fly', null, { timeout: 20000 })))
await h.waitForTimeout(1500)
for (const [n, p] of [['chromium', h], ['webkit', g]]) {
  const r = await p.evaluate(() => ({ mode: window.__scv.mode(), v: Math.round(window.__scv.variance()), roles: window.__sc.roles.join('+') }))
  check(r.mode === '3d' && r.v > 80, `${n}: 3D で描けている（分散 ${r.v}、担当 ${r.roles}）`)
}
await h.screenshot({ path: new URL('./shots/live-chromium.png', import.meta.url).pathname }); await g.screenshot({ path: new URL('./shots/live-webkit.png', import.meta.url).pathname })
const st = await play.playToEnd([h, g], { timeout: 200000 })
await Promise.all([h, g].map(p => p.waitForSelector('#result:not([hidden])', { timeout: 60000 })))
check(true, `最後まで飛んで結果が出た（${await g.textContent('#resultTitle .stamp')}）操作 ${JSON.stringify(st)}`)
await h.click('#rematchBtn')
await Promise.all([h, g].map(p => p.waitForFunction(() => window.__sc && window.__sc.phase === 'fly', null, { timeout: 20000 })))
check(await g.evaluate(() => window.__scv.mode() === '3d' && window.__scv.variance() > 80), '再戦できて、webkit でも 3D が描けている')
check(await g.evaluate(() => document.getElementById('bootErr').hidden), 'webkit: 起動エラーの表示が出ていない')
check(errs.length === 0, `コンソールエラー0件 ${errs.slice(0, 3).join(' / ')}`)
const html = await (await fetch(base)).text()
const img = html.match(/og:image" content="([^"]+)/)
check(!!img && /^https?:\/\//.test(img[1]), `og:image が絶対URL（${img && img[1]}）`)
if (img) { const r = await fetch(img[1]); check(r.status === 200 && /image\/png/.test(r.headers.get('content-type') || ''), `OGP 画像が取れる ${r.status} ${r.headers.get('content-type')} ${(await r.arrayBuffer()).byteLength}バイト`) }
check(/og:title" content="宇宙船クルー/.test(html) && /twitter:card" content="summary_large_image/.test(html), 'og:title と twitter:card がある')
await bc.close(); await bw.close(); if (srv) await srv.close()
console.log(fail ? `NG ${fail}件` : 'すべてOK')
process.exit(fail ? 1 : 0)

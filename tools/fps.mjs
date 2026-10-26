// 3D の fps を測る（GPU を使う設定の headless Chromium）。スマホ相当（390x844・画素比3・タッチ）と横持ち（844x390）で、5つの航路を全開で数秒ずつ飛ぶ。
// 同じ条件で空のページの fps も測り、計測する Mac 自体の上限（電池駆動・ほかの重い処理）を並べて出す。
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
import { ROUTE_IDS } from '../public/routes.js'
const srv = await startServer({ port: 0, quiet: true, gameOpts: { config: { briefTime: 1 } } })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const N = Number(process.env.N) || 2
for (const [w, h] of [[390, 844], [844, 390]]) {
  const mk = async () => (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ja-JP' })).newPage()
  const blank = await mk()
  await blank.setContent('<body style="margin:0;background:#000"></body>')
  const bf = await blank.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)) }; requestAnimationFrame(f) }))
  console.log(`${w}x${h} 空のページ ${bf.toFixed(1)}fps`)
  await blank.context().close()
  for (const id of ROUTE_IDS) {
    const ps = []
    for (let i = 0; i < N; i++) ps.push(await mk())
    const [hp] = ps
    await hp.goto(base); await hp.fill('#name', 'A'); await hp.click('#createBtn'); await hp.waitForSelector('#lobby:not([hidden])')
    for (let i = 0; i < 6 && await hp.getAttribute('#routePick .pk-body', 'data-id') !== id; i++) await hp.click('#routePick .pk-btn[data-d="1"]')
    for (const p of ps.slice(1)) { await p.goto(await hp.inputValue('#invite')); await p.fill('#name', 'B'); await p.click('#joinBtn'); await p.waitForSelector('#lobby:not([hidden])') }
    await hp.click('#startBtn')
    await hp.waitForFunction(() => window.__sc && window.__sc.phase === 'fly', null, { timeout: 10000 })
    for (const p of ps) if (await p.evaluate(() => window.__sc.roles.includes('engine'))) { if (await p.$('.sc-tabs button[data-role="engine"]')) await p.dispatchEvent('.sc-tabs button[data-role="engine"]', 'pointerdown'); await p.dispatchEvent('.lever .kbtn[data-lv="3"]', 'pointerdown') }
    for (const p of ps) if (await p.evaluate(() => window.__sc.roles.includes('helm'))) { if (await p.$('.sc-tabs button[data-role="helm"]')) await p.dispatchEvent('.sc-tabs button[data-role="helm"]', 'pointerdown') }
    await hp.waitForTimeout(6000)
    const r = await hp.evaluate(() => ({ fps: window.__scv.fps(), tier: window.__scv.tier(), mode: window.__scv.mode() }))
    console.log(`${w}x${h} ${id.padEnd(6)} ${N}人 fps ${r.fps.toFixed(1)} 画質 ${r.tier}（2=高 1=中 0=低）`)
    for (const p of ps) await p.context().close()
  }
}
await b.close(); await srv.close()

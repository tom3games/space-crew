// 実ブラウザ（chromium と webkit）で3人つないで、作成→招待URLで参加→担当の確認→航行→結果→再戦 を通す。スクショは tools/shots/
// 使い方: node tools/e2e.mjs   （サーバーは自前で立てる。コースは短くしてある）
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { startServer } from '../server.mjs'
import * as play from './e2e-play.mjs'

const SHOTS = new URL('./shots/', import.meta.url).pathname
await mkdir(SHOTS, { recursive: true })
const srv = await startServer({ port: 0, quiet: true, gameOpts: { config: { goalDist: 1800, timeLimit: 90, briefTime: 2.5 } } })
const base = `http://localhost:${srv.port}`
let fail = 0
const check = (ok, label) => { console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const SIZES = [[390, 844], [360, 640], [844, 390]]

// 一画面に収まっているか（縦スクロールなし・操作できる部品が画面内）
async function fits(page) {
  return page.evaluate(() => {
    const H = innerHeight, W = innerWidth
    const bad = []
    if (document.documentElement.scrollHeight > H + 1) bad.push('html ' + document.documentElement.scrollHeight)
    if (document.body.scrollHeight > H + 1) bad.push('body ' + document.body.scrollHeight)
    for (const el of document.querySelectorAll('button, input, canvas, summary')) {
      if (!el.offsetParent && el.tagName !== 'CANVAS') continue
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      if (el.closest('.sc-alerts, .sc-calls')) continue // 横に流れる列
      if (r.bottom > H + 1 || r.right > W + 1 || r.top < -1 || r.left < -1) bad.push(`${el.id || el.className || el.tagName} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`)
      if (el.tagName === 'BUTTON' && r.height < 40) bad.push(`小さい ${el.id || el.className} ${Math.round(r.height)}px`)
    }
    return bad
  })
}
async function checkSizes(page, label, bname) {
  const orig = page.viewportSize()
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(250)
    const bad = await fits(page)
    check(bad.length === 0, `${bname}: ${label} ${w}x${h} 一画面に収まる ${bad.slice(0, 4).join(' / ')}`)
    if (bname === 'chromium') await page.screenshot({ path: `${SHOTS}${bname}-${label}-${w}x${h}.png` })
  }
  await page.setViewportSize(orig)
}

for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await bt.launch()
  const errors = []
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: bname === 'chromium' })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    p.on('requestfailed', r => errors.push('requestfailed ' + r.url()))
    return p
  }
  const host = await mk(), g1 = await mk(), g2 = await mk()
  await host.goto(base)
  await host.waitForSelector('#home:not([hidden])')
  if (bname === 'chromium') await checkSizes(host, 'home', bname)
  await host.fill('#name', 'ホスト')
  await host.click('#createBtn')
  await host.waitForSelector('#lobby:not([hidden])')
  const invite = await host.inputValue('#invite')
  check(/\/r\/[A-Z0-9]{4}$/.test(invite), `${bname}: 招待URLが出る ${invite}`)
  for (const [p, n] of [[g1, 'ゲスト1'], [g2, 'ゲスト2']]) {
    await p.goto(invite)
    check((await p.inputValue('#code')).length === 4, `${bname}: 招待URLを開くと参加コードが入っている`)
    await p.fill('#name', n)
    await p.click('#joinBtn')
    await p.waitForSelector('#lobby:not([hidden])')
  }
  await host.waitForFunction(() => document.querySelectorAll('#players li').length === 3)
  check(/3人のときの担当/.test(await host.textContent('#rolePreview')), `${bname}: 3人がロビーにそろい、担当の分け方が出る`)
  await host.screenshot({ path: `${SHOTS}${bname}-lobby.png` })
  if (bname === 'chromium') await checkSizes(host, 'lobby', bname)
  await host.click('#startBtn')
  await g1.waitForSelector('#game:not([hidden])')
  await g1.waitForSelector('#sc-brief:not([hidden])')
  check(true, `${bname}: ゲームが始まり、担当の説明が出る`)
  await g1.screenshot({ path: `${SHOTS}${bname}-brief.png` })
  // 担当がそれぞれ違い、全部の担当が誰かに配られている
  const roles = await Promise.all([host, g1, g2].map(p => p.evaluate(() => window.__sc.roles)))
  const all = roles.flat().sort().join()
  check(all === 'defense,engine,helm,nav,repair', `${bname}: 5つの担当が3人に分かれる ${roles.map(r => r.join('+')).join(' / ')}`)
  // ナビ以外には危険地帯の地図が届かない
  await host.waitForTimeout(3500)
  const maps = await Promise.all([host, g1, g2].map(p => p.evaluate(() => ({ nav: window.__sc.roles.includes('nav'), map: !!window.__scMap }))))
  check(maps.every(m => m.nav === m.map), `${bname}: 地図が届くのはナビだけ`)
  // 担当の画面が出ているか（キャンバスが空でない）
  for (const [k, p] of [host, g1, g2].entries()) {
    const lum = await p.evaluate(() => {
      const c = [...document.querySelectorAll('.pn:not([hidden]) canvas')][0]
      if (!c) return { kind: 'dom', ok: !!document.querySelector('.pn:not([hidden]) button') }
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let sum = 0, sq = 0, n = 0
      for (let i = 0; i < d.length; i += 64) { const v = d[i] + d[i + 1] + d[i + 2]; sum += v; sq += v * v; n++ }
      const m = sum / n
      return { kind: 'canvas', ok: sq / n - m * m > 30, varc: Math.round(sq / n - m * m) }
    })
    check(lum.ok, `${bname}: ${k + 1}人目の操作盤が描けている ${JSON.stringify(lum)}`)
  }
  if (bname === 'chromium') {
    // 全員の、全部の担当の操作盤を各サイズで
    for (const p of [host, g1, g2]) {
      for (const r of await p.evaluate(() => window.__sc.roles)) {
        if (await p.$(`.sc-tabs button[data-role="${r}"]`)) await p.dispatchEvent(`.sc-tabs button[data-role="${r}"]`, 'pointerdown')
        await checkSizes(p, 'game-' + r, bname)
      }
    }
  }
  await play.playToEnd([host, g1, g2], { shots: SHOTS, prefix: bname })
  await g1.waitForSelector('#result:not([hidden])', { timeout: 60000 })
  const title = await g1.textContent('#resultTitle')
  check(true, `${bname}: 結果画面が出る（${title}）`)
  await g1.waitForTimeout(400)
  await g1.screenshot({ path: `${SHOTS}${bname}-result.png` })
  await host.waitForSelector('#result:not([hidden])')
  if (bname === 'chromium') await checkSizes(host, 'result', bname)
  await host.click('#rematchBtn')
  await g2.waitForSelector('#game:not([hidden])')
  await g2.waitForSelector('#sc-brief:not([hidden])')
  check(true, `${bname}: 再戦できる（担当の説明からやり直し）`)
  check(errors.length === 0, `${bname}: コンソールエラー0件 ${errors.slice(0, 3).join(' / ')}`)
  await browser.close()
}
await srv.close()
console.log(fail ? `NG ${fail}件` : 'すべてOK')
process.exit(fail ? 1 : 0)

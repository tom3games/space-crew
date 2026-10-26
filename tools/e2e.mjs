// 実ブラウザ（chromium と webkit）で3人つないで、作成→招待URLで参加→航路を選ぶ（参加者にも見える）→担当の確認→航行→結果→再戦 を通す。
// あわせて、各画面が 390x844 / 360x640 / 844x390 / 568x320 で上下にスクロールせず収まるか、ボタンが44px以上あるかを数値で確かめる。
// 3D が描けているか（画素の分散）、WebGL が無いとき（?2d）に 2D で描けるか、コンソールエラーが0件かも見る。スクショは tools/shots/
// 使い方: node tools/e2e.mjs   （サーバーは自前で立てる。コースは短くしてある）  BROWSER=webkit で片方だけ
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { startServer } from '../server.mjs'
import * as play from './e2e-play.mjs'

const SHOTS = new URL('./shots/', import.meta.url).pathname
await mkdir(SHOTS, { recursive: true })
const srv = await startServer({ port: 0, quiet: true, gameOpts: { config: { goalDist: 1800, timeLimit: 90, briefTime: 2.5 } } })
const base = `http://localhost:${srv.port}`
let fail = 0, total = 0
const check = (ok, label) => { total++; console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const SIZES = [[390, 844], [360, 640], [844, 390], [568, 320]]
const ONLY = process.env.BROWSER

// 一画面に収まっているか（縦横スクロールなし・見えているボタンが画面内で44px以上）
async function fits(page) {
  return page.evaluate(() => {
    const H = innerHeight, W = innerWidth, de = document.documentElement
    const bad = []
    const sh = Math.max(de.scrollHeight, document.body.scrollHeight), sw = de.scrollWidth
    if (sh > H + 1) bad.push('高さ ' + sh)
    if (sw > W + 1) bad.push('幅 ' + sw)
    for (const el of document.querySelectorAll('button, input, summary, canvas')) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue
      if (el.closest('[hidden]')) continue
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const name = (el.id || el.dataset.call || el.dataset.role || el.dataset.sys || el.dataset.lv || el.className || el.tagName).toString().slice(0, 16)
      if (el.closest('.sc-alerts, .sc-calls')) { if (r.top < -1 || r.bottom > H + 1) bad.push(name + ' 画面外'); if (el.tagName === 'BUTTON' && r.height < 43.5) bad.push(`${name} 高さ${Math.round(r.height)}`); continue } // 横に流れる列
      if (r.bottom > H + 1 || r.right > W + 1 || r.top < -1 || r.left < -1) bad.push(`${name} 画面外 ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`)
      if ((el.tagName === 'BUTTON' || el.tagName === 'SUMMARY') && r.height < 43.5) bad.push(`${name} 高さ${Math.round(r.height)}`)
    }
    const cv = document.querySelector('#sc-cv')
    if (cv && cv.offsetParent && cv.getBoundingClientRect().height < 100) bad.push('3D が低い ' + Math.round(cv.getBoundingClientRect().height))
    return bad
  })
}
async function checkSizes(page, label, bname) {
  const orig = page.viewportSize()
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(300)
    const bad = await fits(page)
    check(bad.length === 0, `${bname}: ${label} ${w}x${h} 一画面に収まる ${bad.slice(0, 4).join(' / ')}`)
    await page.screenshot({ path: `${SHOTS}${bname}-${label}-${w}x${h}.png` })
  }
  await page.setViewportSize(orig)
}

// chromium は GPU を使う設定で起動する（ソフトウェア描画だと 3D が遅く、操作の確認が間に合わない）
const GPU = { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }
for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  if (ONLY && ONLY !== bname) continue
  const browser = await bt.launch(bname === 'chromium' ? GPU : {})
  const errors = []
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: bname === 'chromium' })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push('requestfailed ' + r.url()) })
    return p
  }
  const host = await mk(), g1 = await mk(), g2 = await mk()
  await host.goto(base)
  await host.waitForSelector('#home:not([hidden])')
  check(await host.evaluate(() => !!document.querySelector('.logo-svg') && document.querySelector('#bootErr').hidden), `${bname}: ホームにロゴが出て、起動エラーは出ない`)
  if (bname === 'chromium') {
    await checkSizes(host, 'home', bname)
    await host.click('#howBtn'); await host.waitForSelector('#howto:not([hidden])')
    await checkSizes(host, 'howto', bname)
    await host.click('#howClose')
  }
  await host.fill('#name', 'ホスト')
  await host.click('#createBtn')
  await host.waitForSelector('#lobby:not([hidden])')
  const invite = await host.inputValue('#invite')
  check(/\/r\/[A-Z0-9]{4}$/.test(invite), `${bname}: 招待URLが出る ${invite}`)
  // 航路を「小惑星帯」にする
  for (let k = 0; k < 6 && await host.getAttribute('#routePick .pk-body', 'data-id') !== 'belt'; k++) await host.click('#routePick .pk-btn[data-d="1"]')
  for (const [p, n, q] of [[g1, 'ゲスト1', ''], [g2, 'とても長い名前のひと', bname === 'chromium' ? '?2d' : '']]) {
    await p.goto(invite + q)
    check((await p.inputValue('#code')).length === 4, `${bname}: 招待URLを開くと参加コードが入っている`)
    await p.fill('#name', n)
    await p.click('#joinBtn')
    await p.waitForSelector('#lobby:not([hidden])')
  }
  await host.waitForFunction(() => document.querySelectorAll('#players li').length === 3)
  check(/3人のときの担当/.test(await host.textContent('#rolePreview')), `${bname}: 3人がロビーにそろい、担当の分け方が出る`)
  await g1.waitForFunction(() => document.querySelector('#routePick .pk-body')?.dataset.id === 'belt', null, { timeout: 5000 }).catch(() => {})
  check(await g1.getAttribute('#routePick .pk-body', 'data-id') === 'belt' && await g1.evaluate(() => [...document.querySelectorAll('#routePick .pk-btn')].every(b => b.hidden)), `${bname}: ホストが選んだ航路が参加者にも見える（参加者は変えられない）`)
  if (bname === 'chromium') { await checkSizes(host, 'lobby', bname); await checkSizes(g2, 'lobby-guest', bname) }
  await host.click('#startBtn')
  await Promise.all([host, g1, g2].map(p => p.waitForSelector('#sc-brief:not([hidden])'))) // 説明は数秒で消えるので3人同時に待つ
  check(true, `${bname}: ゲームが始まり、全員に担当の説明が出る`)
  check(/小惑星帯/.test(await g1.textContent('#brief-route')), `${bname}: 担当の説明に航路の名前が出る`)
  await g1.screenshot({ path: `${SHOTS}${bname}-brief.png` })
  if (bname === 'chromium') await checkSizes(g1, 'brief', bname)
  const roles = await Promise.all([host, g1, g2].map(p => p.evaluate(() => window.__sc.roles)))
  check(roles.flat().sort().join() === 'defense,engine,helm,nav,repair', `${bname}: 5つの担当が3人に分かれる ${roles.map(r => r.join('+')).join(' / ')}`)
  await host.waitForFunction(() => window.__sc.phase === 'fly', null, { timeout: 8000 })
  await host.waitForTimeout(3500)
  const maps = await Promise.all([host, g1, g2].map(p => p.evaluate(() => ({ nav: window.__sc.roles.includes('nav'), map: !!window.__scMap }))))
  check(maps.every(m => m.nav === m.map), `${bname}: 危険地帯の地図が届くのはナビだけ`)
  // 描けているか（3D は画素の分散。?2d の人は 2D）
  for (const [k, p] of [host, g1, g2].entries()) {
    const r = await p.evaluate(() => ({ mode: window.__scv.mode(), v: Math.round(window.__scv.variance()) }))
    const want = bname === 'chromium' && k === 2 ? '2d' : '3d'
    check(r.mode === want && r.v > 80, `${bname}: ${k + 1}人目の画面が ${want} で描けている（分散 ${r.v}）`)
  }
  // 操縦は切り替え式: 1回押すと曲がりっぱなし、もう1回で戻る
  const helmP = [host, g1, g2][roles.findIndex(r => r.includes('helm'))]
  if (await helmP.$('.sc-tabs button[data-role="helm"]')) await helmP.dispatchEvent('.sc-tabs button[data-role="helm"]', 'pointerdown')
  await helmP.dispatchEvent('.steer .kbtn[data-dir="-1"]', 'pointerdown')
  await helmP.waitForTimeout(900)
  const s1 = await helmP.evaluate(() => ({ steer: window.__sc.steer, pressed: document.querySelector('.steer .kbtn[data-dir="-1"]').getAttribute('aria-pressed') }))
  await helmP.dispatchEvent('.steer .kbtn[data-dir="-1"]', 'pointerdown')
  await helmP.waitForTimeout(500)
  const s2 = await helmP.evaluate(() => window.__sc.steer)
  check(s1.steer === -1 && s1.pressed === 'true' && s2 === 0, `${bname}: 舵は1回押すと曲がりっぱなし、もう1回で戻る（${s1.steer} → ${s2}）`)
  // 掛け声が全員の画面に吹き出しで出る
  await helmP.dispatchEvent('.call-btn[data-call="help"]', 'pointerdown')
  const other = [host, g1, g2].find(p => p !== helmP)
  const bub = await other.waitForFunction(() => [...document.querySelectorAll('.bub')].some(b => !b.hidden && /手伝って/.test(b.textContent)), null, { timeout: 3000 }).then(() => true).catch(() => false)
  check(bub, `${bname}: 掛け声が他の人の画面に吹き出しで出る`)
  if (bname === 'webkit') await checkSizes(helmP, 'game-helm', bname) // iOS Safari 相当でも収まるか
  if (bname === 'chromium') {
    // 全員の、全部の担当の操作盤を各サイズで
    for (const [k, p] of [host, g1, g2].entries()) {
      for (const r of await p.evaluate(() => window.__sc.roles)) {
        if (await p.$(`.sc-tabs button[data-role="${r}"]`)) await p.dispatchEvent(`.sc-tabs button[data-role="${r}"]`, 'pointerdown')
        await checkSizes(p, `game-p${k + 1}-${r}`, bname)
      }
    }
  }
  const st = await play.playToEnd([host, g1, g2], { shots: SHOTS, prefix: bname })
  for (const p of [host, g1, g2]) await p.waitForSelector('#result:not([hidden])', { timeout: 60000 })
  const res = await g1.evaluate(() => ({ title: document.querySelector('#resultTitle .stamp')?.textContent, crew: document.querySelectorAll('.res-crew li').length, stats: document.querySelectorAll('.res-stats > div').length }))
  check(!!res.title && res.crew === 3 && res.stats === 6, `${bname}: 結果画面にハンコ・6つの成績・3人の称号が出る（${res.title}）操作 ${JSON.stringify(st)}`)
  await g1.waitForTimeout(900)
  await g1.screenshot({ path: `${SHOTS}${bname}-result.png` })
  if (bname === 'chromium') { await checkSizes(host, 'result', bname); await checkSizes(g1, 'result-guest', bname) } else await checkSizes(host, 'result', bname)
  await host.click('#rematchBtn')
  await Promise.all([host, g1, g2].map(p => p.waitForSelector('#sc-brief:not([hidden])', { timeout: 10000 })))
  const again = await Promise.all([host, g1, g2].map(p => p.evaluate(() => window.__scv.mode())))
  check(again[0] === '3d', `${bname}: 再戦できる（担当の説明からやり直し、画面も作り直す ${again.join(',')}）`)
  await host.waitForFunction(() => window.__sc.phase === 'fly', null, { timeout: 8000 })
  await host.waitForTimeout(1200)
  check(await host.evaluate(() => window.__scv.variance() > 80), `${bname}: 再戦でも 3D が描けている`)
  check(await host.evaluate(() => !!document.querySelector('#quitBtn')), `${bname}: 再戦でも退出ボタンが残っている`)
  check(errors.length === 0, `${bname}: コンソールエラー0件 ${errors.slice(0, 3).join(' / ')}`)
  await browser.close()
}
await srv.close()
console.log(fail ? `NG ${fail}件 / ${total}項目` : `すべてOK（${total}項目）`)
process.exit(fail ? 1 : 0)

// 宇宙船クルーを「最後まで遊ぶ」手順。各ページが自分の担当の操作盤だけを触る（画面に届いた状態 window.__sc を見て判断する）。
// 操縦は目的地へ向け、ナビの地図（window.__scMap）にある危険地帯を避ける。舵は切り替え式なので、向きを変えたいときだけ押す。
// エンジンは全開と冷却、修理は故障を連打、防衛は上の画面の隕石をタップ（と自動照準のボタン）で撃つ。ネコが乗ったら連打で追い払う。

const roleOf = p => p.evaluate(() => window.__sc ? window.__sc.roles : [])

export async function playToEnd(pages, { shots, prefix, timeout = 150000 } = {}) {
  const roles = await Promise.all(pages.map(roleOf))
  const who = r => pages[roles.findIndex(rs => rs.includes(r))]
  const helm = who('helm'), engine = who('engine'), repair = who('repair'), nav = who('nav'), def = who('defense')
  const tab = async (p, r) => { if (await p.$(`.sc-tabs button[data-role="${r}"]:not([aria-selected="true"])`)) await p.dispatchEvent(`.sc-tabs button[data-role="${r}"]`, 'pointerdown') }
  const t0 = Date.now()
  let i = 0, marked = false, tapped = 0
  const stats = { steerPress: 0, taps: 0, shots: 0, shoo: 0 }
  while (Date.now() - t0 < timeout) {
    const done = await helm.evaluate(() => document.body.dataset.screen === 'result')
    if (done) return stats
    const g = await helm.evaluate(() => window.__sc)
    if (!g || g.phase !== 'fly') { await helm.waitForTimeout(200); continue }
    // ネコ（乗られた人が連打で追い払う）
    for (const p of pages) {
      if (await p.evaluate(() => !!(window.__sc && window.__sc.cat && window.__sc.cat.me))) { for (let k = 0; k < 7; k++) await p.dispatchEvent('#sc-cat', 'pointerdown'); stats.shoo++ }
    }
    // ナビ: 1回だけ地図に目印を置く
    if (!marked) { await tab(nav, 'nav'); const box = await nav.locator('#cv-nav').boundingBox(); if (box) await nav.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3); marked = true }
    const map = await nav.evaluate(() => window.__scMap || [])
    // 操縦
    await tab(helm, 'helm')
    let tx = g.goal.x, ty = g.goal.y
    const sx = g.ship.x, sy = g.ship.y
    let best = null
    for (const [, hx, hy, r] of map) {
      const dx = tx - sx, dy = ty - sy, l = Math.hypot(dx, dy) || 1
      const u = ((hx - sx) * dx + (hy - sy) * dy) / l
      if (u < 0 || u > l || u > 1500) continue
      const px = sx + dx / l * u, py = sy + dy / l * u
      if (Math.hypot(px - hx, py - hy) < r + 90 && (!best || u < best.u)) best = { u, px, py, hx, hy, r }
    }
    if (best) { let nx = best.px - best.hx, ny = best.py - best.hy; const nl = Math.hypot(nx, ny); if (nl < 1) { nx = 1; ny = 0 } else { nx /= nl; ny /= nl } tx = best.hx + nx * (best.r + 200); ty = best.hy + ny * (best.r + 200) }
    let d = Math.atan2(tx - sx, ty - sy) - g.ship.h
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    const want = Math.abs(d) < 0.08 ? 0 : Math.sign(d)
    if (want !== g.steer) { await helm.dispatchEvent(`.steer .kbtn[data-dir="${want}"]`, 'pointerdown'); stats.steerPress++ }
    // エンジン
    if (engine !== helm || i % 4 === 0) {
      await tab(engine, 'engine')
      const ge = await engine.evaluate(() => window.__sc)
      if (ge.throttle !== 3 && ge.heat < 70) await engine.dispatchEvent('.lever .kbtn[data-lv="3"]', 'pointerdown')
      if (ge.heat >= 75) await engine.dispatchEvent('.lever .kbtn[data-lv="1"]', 'pointerdown')
      if (ge.heat >= 60) await engine.dispatchEvent('#eng-vent', 'pointerdown')
      if (engine === helm) await tab(helm, 'helm')
    }
    // 修理
    const gr = await repair.evaluate(() => window.__sc)
    const broken = Object.entries(gr.sys).filter(([, v]) => v >= 0).map(([k]) => k)
    if (broken.length) {
      await tab(repair, 'repair')
      for (let k = 0; k < 4; k++) await repair.dispatchEvent(`.tile[data-sys="${broken[0]}"]`, 'pointerdown')
      stats.taps += 4
    }
    // 防衛: 最初の3回は上の画面をタップして撃つ。あとは自動照準のボタン
    const gd = await def.evaluate(() => window.__sc)
    if ((gd.meteors || []).length) {
      await tab(def, 'defense')
      if (tapped < 3) { const box = await def.locator('#sc-cv').boundingBox(); if (box) { await def.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.35); tapped++ } }
      else await def.dispatchEvent('#def-auto', 'pointerdown')
      stats.shots++
    }
    if (shots && i === 25) for (const [k, p] of pages.entries()) await p.screenshot({ path: `${shots}${prefix}-game-p${k + 1}.png` })
    i++
    await helm.waitForTimeout(80)
  }
  return stats
}

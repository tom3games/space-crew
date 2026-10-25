// og.png（1200x630）を Canvas で描いて public/og.png に保存する。使い方: node tools/make-og.mjs
import { chromium } from 'playwright'
const out = new URL('../public/og.png', import.meta.url).pathname
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b1020"><canvas id="c" width="1200" height="630"></canvas><script>
const c = document.getElementById('c'), x = c.getContext('2d')
const g = x.createRadialGradient(950, 80, 50, 950, 80, 900); g.addColorStop(0, '#22306a'); g.addColorStop(1, '#0b1020')
x.fillStyle = g; x.fillRect(0, 0, 1200, 630)
let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647
for (let i = 0; i < 260; i++) { x.fillStyle = 'rgba(220,230,255,' + (0.2 + r() * 0.7) + ')'; const z = r() < 0.08 ? 2.5 : 1.4; x.fillRect(r() * 1200, r() * 630, z, z) }
// 危険地帯
function field(cx, cy, R) { x.fillStyle = 'rgba(224,146,92,.2)'; x.strokeStyle = '#e0925c'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill(); x.stroke(); x.fillStyle = '#e0925c'; for (let i = 0; i < 9; i++) { const a = r() * 6.28, d = r() * R * .8; x.fillRect(cx + Math.cos(a) * d - 4, cy + Math.sin(a) * d - 4, 8, 8) } }
function storm(cx, cy, R) { x.fillStyle = 'rgba(180,140,255,.18)'; x.strokeStyle = '#b48cff'; x.lineWidth = 3; x.setLineDash([12, 9]); x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill(); x.stroke(); x.setLineDash([]); x.fillStyle = '#b48cff'; x.beginPath(); x.moveTo(cx, cy - 16); x.lineTo(cx + 16, cy + 12); x.lineTo(cx - 16, cy + 12); x.fill() }
field(800, 330, 90); storm(1050, 250, 65); field(1030, 500, 75); storm(650, 250, 55)
// 目的地
x.strokeStyle = '#54e0a0'; x.lineWidth = 4; for (const k of [1, .66, .33]) { x.globalAlpha = k; x.beginPath(); x.arc(1090, 80, 70 * (1.4 - k), 0, 7); x.stroke() } x.globalAlpha = 1
// 航路
x.strokeStyle = '#5fd4ff'; x.lineWidth = 4; x.setLineDash([14, 12]); x.beginPath(); x.moveTo(690, 560); x.bezierCurveTo(800, 480, 920, 470, 925, 380); x.bezierCurveTo(930, 250, 980, 140, 1090, 80); x.stroke(); x.setLineDash([])
// 船
x.save(); x.translate(670, 575); x.rotate(0.95)
x.fillStyle = 'rgba(255,181,71,.7)'; x.beginPath(); x.moveTo(-18, 40); x.lineTo(0, 100); x.lineTo(18, 40); x.fill()
x.fillStyle = '#1a2440'; x.strokeStyle = '#ffb547'; x.lineWidth = 5; x.beginPath(); x.moveTo(0, -55); x.lineTo(34, 30); x.lineTo(12, 44); x.lineTo(-12, 44); x.lineTo(-34, 30); x.closePath(); x.fill(); x.stroke()
x.fillStyle = '#ffb547'; x.beginPath(); x.arc(0, -10, 10, 0, 7); x.fill(); x.restore()
// 文字
x.fillStyle = '#ffb547'; x.font = '700 30px "Hiragino Sans", sans-serif'; x.fillText('3〜8人で遊ぶ協力ゲーム', 72, 140)
x.fillStyle = '#e8ecf6'; x.font = '800 100px "Hiragino Sans", sans-serif'; x.fillText('宇宙船', 66, 260); x.fillText('クルー', 66, 372)
x.fillStyle = '#93a0bd'; x.font = '600 30px "Hiragino Sans", sans-serif'; x.fillText('危険が見えるのはナビだけ。', 72, 440); x.fillText('声を掛け合って目的地へ。', 72, 484)
const roles = ['操縦', 'エンジン', '修理', 'ナビ', '防衛']; let px = 72
x.font = '700 24px "Hiragino Sans", sans-serif'
for (const t of roles) { const w = x.measureText(t).width + 32; x.strokeStyle = '#3b4d7a'; x.lineWidth = 2; x.fillStyle = '#121a2e'; x.beginPath(); x.roundRect(px, 528, w, 48, 10); x.fill(); x.stroke(); x.fillStyle = '#e8ecf6'; x.fillText(t, px + 16, 561); px += w + 10 }
</script>`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 630 } })
await p.setContent(html)
await p.locator('#c').screenshot({ path: out })
await b.close()
console.log('wrote', out)

// ゲーム中の 3D 描画（Three.js）。動きの計算はサーバーがするので、ここは届いた状態を立体で見せるだけ。
// 座標: ワールドの x（右）→ 3D の x、y（前＝目的地の方向）→ 3D の -z。S=1/40 で縮める（船の半径28 → 0.7）。
// カメラは船の後ろ・少し上からの追いかけ視点。カメラの向きは船の向きに追従するので、
// 「左」ボタン＝画面の左へ曲がる、がいつも一致する。
// 見えるものは自分に届いた view のとおり（危険地帯はナビにだけ届くので、ナビの画面にだけ出る。隕石は操縦と防衛だけ）。
import * as THREE from './vendor/three.module.js'
import { CREW_COLORS } from './routes.js'

const S = 1 / 40
const THEMES = {
  moon: { sky: ['#0d1a4a', '#24407e', '#050818'], neb: ['#3d63d0', '#86c1ff', '#b48cff'], fog: 0x14244f, hemi: [0xc9dcff, 0x2a2456], sun: 0xfff1d6, grid: 0x6fa8ff, body: 'moon' },
  belt: { sky: ['#1b0f30', '#56264a', '#0a0512'], neb: ['#ff8a4a', '#c8507a', '#ffd23f'], fog: 0x2b1533, hemi: [0xffd9c2, 0x2b1440], sun: 0xffe2b8, grid: 0xff9a5c, body: 'gas' },
  storm: { sky: ['#150a3c', '#40177a', '#07031a'], neb: ['#c86bff', '#4fd8ff', '#ff7ab8'], fog: 0x24104d, hemi: [0xe2ccff, 0x1d0f44], sun: 0xf0e2ff, grid: 0xc86bff, body: 'storm' },
  hole: { sky: ['#07040f', '#22102e', '#000000'], neb: ['#ff9a3a', '#7a2a9a', '#ff4a5e'], fog: 0x120818, hemi: [0xffd2b0, 0x150a20], sun: 0xffd0a0, grid: 0xff9a3a, body: 'hole' },
  galaxy: { sky: ['#0b0832', '#2c1c70', '#03021a'], neb: ['#ff7ab8', '#4fd8ff', '#ffd23f'], fog: 0x1a1250, hemi: [0xd8d4ff, 0x1a1250], sun: 0xfff4e0, grid: 0x8f9bff, body: 'galaxy' }
}
const POD_COLORS = { hull: 0xff8a1f, o2: 0x4fd8ff, energy: 0xffd23f }

// 決まった乱数（同じ id なら同じ形）
function hash(a, b = 0) { let n = (a * 374761393 + b * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
function seeded(seed) { let s = seed | 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 } }

let gradTex = null
function toon(color, extra = {}) {
  if (!gradTex) {
    gradTex = new THREE.DataTexture(new Uint8Array([80, 80, 80, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat)
    gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter; gradTex.needsUpdate = true
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: gradTex, ...extra })
}
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra })
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}
// ふわっとした丸（光・煙・雲）
let softTex = null
function soft() {
  return softTex || (softTex = canvasTex(64, 64, (x, w) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g; x.fillRect(0, 0, w, w)
  }))
}

// 空（正距円筒の絵を大きな球の内側に貼る）
function skyTexture(th) {
  return canvasTex(1024, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, th.sky[2]); g.addColorStop(0.42, th.sky[0]); g.addColorStop(0.55, th.sky[1]); g.addColorStop(1, th.sky[2])
    x.fillStyle = g; x.fillRect(0, 0, w, h)
    const r = seeded(11)
    // 星雲（色のにじみ）
    for (let i = 0; i < 26; i++) {
      const cx = r() * w, cy = h * (0.25 + r() * 0.5), R = 60 + r() * 180
      const c = th.neb[i % th.neb.length]
      const gg = x.createRadialGradient(cx, cy, 0, cx, cy, R)
      gg.addColorStop(0, c + '55'); gg.addColorStop(1, c + '00')
      x.fillStyle = gg; x.fillRect(cx - R, cy - R, R * 2, R * 2)
      if (cx < R) { x.save(); x.translate(w, 0); x.fillRect(cx - R, cy - R, R * 2, R * 2); x.restore() }
    }
    // 星
    for (let i = 0; i < 900; i++) {
      const s = r() < 0.05 ? 2.2 : r() < 0.3 ? 1.4 : 0.9
      x.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.65})`
      x.fillRect(r() * w, r() * h, s, s)
    }
  })
}

// 遠くの天体（航路ごと）
function makeBackdrop(kind, th) {
  const g = new THREE.Group()
  if (kind === 'moon') {
    const tex = canvasTex(256, 128, (x, w, h) => {
      x.fillStyle = '#c9cbd6'; x.fillRect(0, 0, w, h)
      const r = seeded(3)
      for (let i = 0; i < 70; i++) { const cx = r() * w, cy = r() * h, R = 2 + r() * 12; x.fillStyle = `rgba(110,112,135,${0.3 + r() * 0.4})`; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill(); x.strokeStyle = 'rgba(240,240,250,.35)'; x.beginPath(); x.arc(cx - 1, cy - 1, R, 3.5, 5.5); x.stroke() }
    })
    g.add(new THREE.Mesh(new THREE.SphereGeometry(70, 32, 20), new THREE.MeshLambertMaterial({ map: tex, fog: false })))
    const earth = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 16), new THREE.MeshLambertMaterial({ color: 0x3a8cff, emissive: 0x0a2a60, fog: false }))
    earth.position.set(-120, 40, 60); g.add(earth)
  } else if (kind === 'gas') {
    const tex = canvasTex(64, 256, (x, w, h) => {
      const cols = ['#ffb36b', '#e0784a', '#ffd9a0', '#c8507a', '#ff9a5c', '#f2c28a']
      for (let i = 0; i < 32; i++) { x.fillStyle = cols[i % cols.length]; x.fillRect(0, i * 8, w, 8) }
    })
    const p = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 24), new THREE.MeshLambertMaterial({ map: tex, fog: false }))
    p.rotation.z = 0.25; g.add(p)
    const ring = new THREE.Mesh(new THREE.RingGeometry(100, 140, 64), new THREE.MeshBasicMaterial({ color: 0xffd2a0, transparent: true, opacity: 0.3, side: THREE.DoubleSide, fog: false, depthWrite: false }))
    ring.rotation.x = -1.25; ring.rotation.y = 0.25; g.add(ring)
  } else if (kind === 'storm') {
    const tex = canvasTex(256, 128, (x, w, h) => {
      x.fillStyle = '#5a2aa8'; x.fillRect(0, 0, w, h)
      const r = seeded(9)
      for (let i = 0; i < 40; i++) { x.strokeStyle = i % 2 ? 'rgba(200,107,255,.6)' : 'rgba(79,216,255,.45)'; x.lineWidth = 2 + r() * 5; x.beginPath(); const y = r() * h; x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + 30 * (r() - 0.5), w * 0.6, y - 30 * (r() - 0.5), w, y + 10 * (r() - 0.5)); x.stroke() }
    })
    const p = new THREE.Mesh(new THREE.SphereGeometry(85, 32, 24), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x2a0a50, fog: false }))
    g.add(p); g.userData.flash = p.material
  } else if (kind === 'hole') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(38, 32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })))
    const disk = canvasTex(256, 256, (x, w) => {
      const gg = x.createRadialGradient(w / 2, w / 2, w * 0.18, w / 2, w / 2, w / 2)
      gg.addColorStop(0, 'rgba(255,240,200,1)'); gg.addColorStop(0.25, 'rgba(255,154,58,.9)'); gg.addColorStop(0.6, 'rgba(160,40,140,.5)'); gg.addColorStop(1, 'rgba(60,10,80,0)')
      x.fillStyle = gg; x.fillRect(0, 0, w, w)
      x.globalCompositeOperation = 'destination-out'
      x.lineWidth = 3
      for (let i = 0; i < 30; i++) { x.strokeStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.arc(w / 2, w / 2, w * (0.2 + i * 0.01), i, i + 2); x.stroke() }
    })
    const d = new THREE.Mesh(new THREE.RingGeometry(40, 150, 96), new THREE.MeshBasicMaterial({ map: disk, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
    // RingGeometry の uv は四角いので、中心からの距離で絵が出るように uv を作り直す
    const pos = d.geometry.attributes.position, uv = d.geometry.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / 300, 0.5 + pos.getY(i) / 300)
    d.rotation.x = -1.35; g.add(d); g.userData.spin = d
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: 0xff9a3a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
    halo.scale.set(200, 200, 1); g.add(halo)
  } else {
    const tex = canvasTex(256, 256, (x, w) => {
      x.translate(w / 2, w / 2)
      const core = x.createRadialGradient(0, 0, 0, 0, 0, 40); core.addColorStop(0, 'rgba(255,250,230,1)'); core.addColorStop(1, 'rgba(255,200,240,0)')
      x.fillStyle = core; x.fillRect(-60, -60, 120, 120)
      const r = seeded(5)
      for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 260; i++) {
        const t = i / 260, a = arm * 2.09 + t * 5.5, R = 8 + t * 115
        const c = ['255,122,184', '79,216,255', '255,210,63'][arm]
        x.fillStyle = `rgba(${c},${0.5 * (1 - t) + 0.1})`
        x.beginPath(); x.arc(Math.cos(a) * R + (r() - 0.5) * 14 * t, Math.sin(a) * R + (r() - 0.5) * 14 * t, 1 + r() * 2.5, 0, 7); x.fill()
      }
    })
    const s = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }))
    s.rotation.x = -1.1; g.add(s); g.userData.spin = s
  }
  return g
}

// 顔（表情ごとに1枚ずつ描いておく）
const FACES = ['normal', 'blink', 'happy', 'shout', 'panic', 'shock', 'dizzy', 'cry', 'gasp', 'annoyed', 'sleep']
function faceTexture(kind) {
  return canvasTex(128, 128, (x) => {
    x.lineCap = 'round'; x.lineJoin = 'round'
    const ink = '#1a1030'
    x.strokeStyle = ink; x.fillStyle = ink; x.lineWidth = 7
    const eye = (cx, cy) => { x.beginPath(); x.ellipse(cx, cy, 7, 10, 0, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(cx + 2, cy - 4, 3, 0, 7); x.fill(); x.fillStyle = ink }
    // ほっぺ
    if (kind !== 'gasp' && kind !== 'dizzy') { x.fillStyle = 'rgba(255,110,140,.5)'; x.beginPath(); x.ellipse(30, 78, 11, 7, 0, 0, 7); x.ellipse(98, 78, 11, 7, 0, 0, 7); x.fill(); x.fillStyle = ink }
    switch (kind) {
      case 'normal': eye(44, 58); eye(84, 58); x.beginPath(); x.arc(64, 78, 12, 0.3, Math.PI - 0.3); x.stroke(); break
      case 'blink': x.beginPath(); x.moveTo(36, 60); x.lineTo(52, 60); x.moveTo(76, 60); x.lineTo(92, 60); x.stroke(); x.beginPath(); x.arc(64, 78, 12, 0.3, Math.PI - 0.3); x.stroke(); break
      case 'happy':
        x.beginPath(); x.moveTo(34, 62); x.lineTo(44, 50); x.lineTo(54, 62); x.moveTo(74, 62); x.lineTo(84, 50); x.lineTo(94, 62); x.stroke()
        x.beginPath(); x.moveTo(46, 74); x.quadraticCurveTo(64, 104, 82, 74); x.closePath(); x.fill(); x.fillStyle = '#ff6f8a'; x.beginPath(); x.arc(64, 88, 7, 0, Math.PI); x.fill(); break
      case 'shout': eye(44, 54); eye(84, 54); x.beginPath(); x.ellipse(64, 84, 14, 12, 0, 0, 7); x.fill(); x.fillStyle = '#ff6f8a'; x.beginPath(); x.ellipse(64, 90, 8, 5, 0, 0, 7); x.fill(); break
      case 'panic':
        x.lineWidth = 5; x.beginPath(); x.arc(44, 56, 11, 0, 7); x.arc(84, 56, 11, 0, 7); x.stroke(); x.beginPath(); x.arc(44, 56, 3, 0, 7); x.arc(84, 56, 3, 0, 7); x.fill()
        x.beginPath(); x.moveTo(44, 86); for (let i = 0; i < 5; i++) x.lineTo(48 + i * 8, i % 2 ? 82 : 90); x.stroke()
        x.fillStyle = '#5ecbff'; x.beginPath(); x.moveTo(104, 30); x.quadraticCurveTo(114, 46, 104, 50); x.quadraticCurveTo(94, 46, 104, 30); x.fill(); break
      case 'shock': x.lineWidth = 5; x.beginPath(); x.arc(44, 56, 10, 0, 7); x.stroke(); x.beginPath(); x.arc(84, 56, 10, 0, 7); x.stroke(); x.beginPath(); x.arc(44, 56, 2.5, 0, 7); x.arc(84, 56, 2.5, 0, 7); x.fill(); x.beginPath(); x.ellipse(64, 88, 9, 12, 0, 0, 7); x.fill(); break
      case 'dizzy':
        x.lineWidth = 4
        for (const cx of [44, 84]) { x.beginPath(); for (let a = 0; a < 12; a += 0.3) { const R = a * 1.1; x.lineTo(cx + Math.cos(a) * R, 56 + Math.sin(a) * R) } x.stroke() }
        x.lineWidth = 6; x.beginPath(); x.moveTo(44, 86); x.quadraticCurveTo(54, 78, 64, 86); x.quadraticCurveTo(74, 94, 84, 86); x.stroke(); break
      case 'cry':
        x.beginPath(); x.moveTo(34, 54); x.quadraticCurveTo(44, 64, 54, 54); x.moveTo(74, 54); x.quadraticCurveTo(84, 64, 94, 54); x.stroke()
        x.beginPath(); x.arc(64, 94, 12, Math.PI + 0.4, -0.4); x.stroke()
        x.fillStyle = '#5ecbff'; x.fillRect(38, 62, 9, 40); x.fillRect(80, 62, 9, 40); break
      case 'gasp':
        x.fillStyle = 'rgba(80,140,255,.45)'; x.beginPath(); x.arc(64, 64, 60, 0, 7); x.fill(); x.fillStyle = ink
        x.beginPath(); x.moveTo(36, 52); x.lineTo(52, 60); x.lineTo(36, 66); x.moveTo(92, 52); x.lineTo(76, 60); x.lineTo(92, 66); x.stroke()
        x.beginPath(); x.ellipse(64, 88, 7, 9, 0, 0, 7); x.fill(); break
      case 'annoyed':
        x.beginPath(); x.moveTo(34, 58); x.lineTo(54, 58); x.moveTo(74, 58); x.lineTo(94, 58); x.stroke(); x.beginPath(); x.arc(44, 62, 4, 0, 7); x.arc(84, 62, 4, 0, 7); x.fill()
        x.beginPath(); x.moveTo(50, 88); x.lineTo(78, 84); x.stroke(); break
      case 'sleep':
        x.beginPath(); x.arc(44, 58, 9, 0.2, Math.PI - 0.2); x.moveTo(93, 58); x.arc(84, 58, 9, 0.2, Math.PI - 0.2); x.stroke()
        x.beginPath(); x.ellipse(64, 86, 6, 5, 0, 0, 7); x.stroke(); break
    }
  })
}

export function createView3D(canvas, { theme = 'belt', n = 1, mySeat = -1, len = 6000, w = 1400 } = {}) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    if (!renderer.getContext()) throw new Error('no gl')
  } catch { return null }
  const th = THEMES[theme] || THEMES.belt
  const coarse = matchMedia('(pointer: coarse)').matches
  let tier = coarse ? 1 : 2 // 2=高 1=中 0=低。fps が出なければ下げる
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(th.sky[0])
  scene.fog = new THREE.Fog(th.fog, 45, 150)
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900)
  scene.add(new THREE.HemisphereLight(th.hemi[0], th.hemi[1], 1.6))
  const sun = new THREE.DirectionalLight(th.sun, 2.4); sun.position.set(-30, 50, 20); scene.add(sun); scene.add(sun.target)
  const rim = new THREE.DirectionalLight(new THREE.Color(th.neb[0]), 1.2); rim.position.set(30, 10, -40); scene.add(rim)

  // 空
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(th), side: THREE.BackSide, fog: false, depthWrite: false }))
  sky.renderOrder = -2; scene.add(sky)
  const backdrop = makeBackdrop(th.body, th); scene.add(backdrop)
  backdrop.traverse(ob => { if (ob.material) { ob.material.depthTest = false; ob.material.depthWrite = false; ob.renderOrder = -1 } })

  // 流れていく宇宙のちり（速さが分かる）
  const DUST = 420, DL = 90
  const dustPos = new Float32Array(DUST * 3), dustBase = new Float32Array(DUST * 3)
  { const r = seeded(21); for (let i = 0; i < DUST * 3; i++) dustBase[i] = r() * DL }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 0.16, transparent: true, opacity: 0.8, depthWrite: false }))
  dust.frustumCulled = false; scene.add(dust)

  // 足もとの格子（宇宙の航路。奥行きと速さの手がかり）
  const GRID_Y = -5, GS = 10
  const gridGeo = new THREE.BufferGeometry()
  { const pts = []; const N = 24; for (let i = -N; i <= N; i++) { pts.push(i * GS, 0, -N * GS, i * GS, 0, N * GS, -N * GS, 0, i * GS, N * GS, 0, i * GS) } gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)) }
  const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: th.grid, transparent: true, opacity: 0.22, depthWrite: false }))
  scene.add(grid)
  // 航路の端（赤いブイと線）
  const edge = new THREE.Group(); scene.add(edge)
  {
    const L0 = -300, L1 = len + 600
    const buoyGeo = new THREE.OctahedronGeometry(0.6, 0)
    const cnt = Math.ceil((L1 - L0) / 500) + 1
    const buoys = new THREE.InstancedMesh(buoyGeo, basic(0xff4a5e), cnt * 2)
    const m = new THREE.Matrix4(); let k = 0
    for (let i = 0; i < cnt; i++) for (const sx of [-1, 1]) { m.makeTranslation(sx * w * S, 0, -(L0 + i * 500) * S); buoys.setMatrixAt(k++, m) }
    edge.add(buoys)
    const lineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-w * S, GRID_Y + 0.05, -L0 * S, -w * S, GRID_Y + 0.05, -L1 * S, w * S, GRID_Y + 0.05, -L0 * S, w * S, GRID_Y + 0.05, -L1 * S], 3))
    edge.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xff4a5e })))
  }

  // ---- 船
  const ship = new THREE.Group(); scene.add(ship)
  const body = new THREE.Group(); ship.add(body) // 傾き（バンク）はこちら
  const hullMat = toon(0xf6f1e7), orange = toon(0xff8a1f), darkM = toon(0x2a2350), redM = toon(0xff4a5e)
  {
    const prof = [[0, -1.7], [0.5, -1.6], [0.78, -1.0], [0.86, -0.1], [0.74, 0.8], [0.42, 1.5], [0.12, 1.85], [0, 1.9]].map(([r, y]) => new THREE.Vector2(r, y))
    const lg = new THREE.LatheGeometry(prof, 24); lg.rotateX(-Math.PI / 2)
    const fus = new THREE.Mesh(lg, hullMat); body.add(fus)
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.09, 8, 28), orange); band.position.z = 0.45; body.add(band)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.55, 18), redM); nose.rotation.x = -Math.PI / 2; nose.position.z = -1.68; body.add(nose)
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.12, 0.85), orange)
      wing.position.set(sx * 1.15, -0.12, 0.75); wing.rotation.z = sx * -0.28; wing.rotation.y = sx * 0.35; body.add(wing)
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), basic(sx < 0 ? 0xff4a5e : 0x3ef0b0)); tip.position.set(sx * 1.72, -0.28, 0.95); body.add(tip)
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.9, 12), darkM); pod.rotation.x = Math.PI / 2; pod.position.set(sx * 0.7, -0.45, 1.25); body.add(pod)
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.75), orange); fin.position.set(0, 0.75, 1.25); fin.rotation.x = 0.45; body.add(fin)
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.4, 16, 1, true), darkM); noz.rotation.x = Math.PI / 2; noz.position.z = 1.85; body.add(noz)
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 16, 1, true), glow(0xffa040, 0.6)); flame.rotation.x = -Math.PI / 2; flame.position.z = 2.3; body.add(flame)
  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1, 12, 1, true), glow(0xfff0b0, 0.6)); flameCore.rotation.x = -Math.PI / 2; flameCore.position.z = 2.2; body.add(flameCore)
  const sideFl = [-1, 1].map(sx => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.7, 10, 1, true), glow(0x4fd8ff, 0.8)); f.rotation.x = -Math.PI / 2; f.position.set(sx * 0.7, -0.45, 2.0); body.add(f); return f })
  // 操縦席の窓（中にクルー）
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.2, shininess: 120, specular: 0xffffff, depthWrite: false }))
  canopy.scale.set(1.25, 1.0, 1.6); canopy.position.set(0, 0.68, -0.35); canopy.renderOrder = 2; body.add(canopy)
  const canopyRim = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 8, 32), darkM); canopyRim.rotation.x = Math.PI / 2; canopyRim.scale.set(1.25, 1.6, 1); canopyRim.position.set(0, 0.68, -0.35); body.add(canopyRim)
  // 被弾したときに光る盾
  const shield = new THREE.Mesh(new THREE.SphereGeometry(2.3, 24, 16), glow(0x4fd8ff, 0)); shield.scale.set(1, 0.7, 1.15); body.add(shield)
  // 船の下の影（格子に落とす）
  const blob = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }))
  blob.rotation.x = -Math.PI / 2; blob.scale.set(0.8, 1.3, 1); blob.visible = false; scene.add(blob)

  // クルー（頭の大きいちびキャラ。カメラの方を振り向く）
  const faceMats = Object.fromEntries(FACES.map(k => [k, new THREE.MeshBasicMaterial({ map: faceTexture(k), transparent: true, depthWrite: false })]))
  const crew = []
  const seats = Math.max(1, Math.min(8, n))
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group()
    const col = new THREE.Color(CREW_COLORS[i])
    const skin = toon(0xffdcbc)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin); g.add(head)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.215, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), toon(col)); cap.position.y = 0.02; cap.rotation.x = -0.25; g.add(cap)
    const ant = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), basic(col)); ant.position.set(0, 0.3, 0.06); g.add(ant)
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5), darkM); stick.position.set(0, 0.24, 0.04); g.add(stick)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), faceMats.normal); face.position.set(0, -0.02, 0.205); face.renderOrder = 3; g.add(face)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.22, 10), toon(col)); torso.position.y = -0.25; g.add(torso)
    g.visible = i < seats
    body.add(g)
    crew.push({ g, face, head, skin, base: new THREE.Vector3(), expr: 'normal', fly: null })
  }
  function placeCrew(present) {
    const list = present.filter(s => s < 8)
    const rows = list.length > 4 ? 2 : 1
    const perRow = Math.ceil(list.length / rows)
    list.forEach((s, k) => {
      const row = Math.floor(k / perRow), col = k % perRow, cnt = Math.min(perRow, list.length - row * perRow)
      const hk = list.length <= 2 ? 1.55 : list.length <= 4 ? 1.25 : 1.05
      const sp = 0.42 * hk
      const x = (col - (cnt - 1) / 2) * sp
      const z = rows === 2 ? (row ? 0.12 : -0.62) : -0.3
      crew[s].base.set(x, 0.8 + (rows === 2 && row ? 0.1 : 0), z)
      crew[s].g.position.copy(crew[s].base)
      crew[s].g.scale.setScalar(hk)
    })
    for (let i = 0; i < 8; i++) crew[i].g.visible = list.includes(i)
  }
  placeCrew([...Array(seats).keys()])
  let crewKey = ''

  // 宇宙ネコ（乗っている間、窓の上に座る）
  const cat = new THREE.Group()
  {
    const fur = toon(0xffa64d), white = toon(0xffffff)
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), fur); b.scale.set(1, 0.8, 1.2); cat.add(b)
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), fur); h.position.set(0, 0.3, 0.2); cat.add(h)
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 4), fur); e.position.set(sx * 0.13, 0.52, 0.2); cat.add(e) }
    const mz = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), white); mz.position.set(0, 0.25, 0.4); mz.scale.set(1.2, 0.8, 0.6); cat.add(mz)
    const cf = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), faceMats.happy); cf.position.set(0, 0.32, 0.43); cat.add(cf)
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 6), fur); tail.position.set(0, 0.2, -0.38); tail.rotation.x = -0.9; cat.add(tail); cat.userData.tail = tail
  }
  cat.position.set(0, 1.55, -0.1); cat.visible = false; body.add(cat)

  // ---- 目的地のビーコン
  const goalG = new THREE.Group(); scene.add(goalG)
  {
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.4, 5, 48), glow(0x3ef0b0, 0.7)); ring.rotation.x = -Math.PI / 2; ring.position.y = -0.4; goalG.add(ring)
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 6, 12), hullMat); tower.position.y = -2; goalG.add(tower)
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), basic(0x3ef0b0)); top.position.y = 1.3; goalG.add(top)
    const tori = [2, 2.7, 3.4].map((r, i) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 8, 40), basic([0x3ef0b0, 0xffd23f, 0x4fd8ff][i])); t.position.y = 1.3; goalG.add(t); return t })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 60, 16, 1, true), glow(0x3ef0b0, 0.18)); beam.position.y = 31; goalG.add(beam)
    goalG.userData.tori = tori
  }

  // ---- 中継ライン（区間の境目）
  const gateGs = []
  const gateTex = canvasTex(256, 64, (x, ww, hh) => {
    const g = x.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g; x.fillRect(0, 0, ww, hh)
    x.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(i * 32 + 4, 0); x.lineTo(i * 32 + 20, hh / 2); x.lineTo(i * 32 + 4, hh); x.lineTo(i * 32 + 12, hh); x.lineTo(i * 32 + 28, hh / 2); x.lineTo(i * 32 + 12, 0); x.fill() }
  })
  gateTex.wrapS = THREE.RepeatWrapping; gateTex.repeat.set(w * 2 / 400, 1)
  function buildGates(ys) {
    for (const gg of gateGs) scene.remove(gg)
    gateGs.length = 0
    for (const y of ys) {
      const g = new THREE.Group()
      const mat = new THREE.MeshBasicMaterial({ map: gateTex, color: 0xffd23f, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * 2 * S, 3), mat); plane.position.y = 0; g.add(plane)
      const postMat = basic(0xffd23f)
      for (let x = -w; x <= w + 1; x += 350) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6.5, 6), postMat); p.position.set(x * S, -1.75, 0); g.add(p) }
      g.position.z = -y * S
      g.userData = { mat, postMat }
      scene.add(g); gateGs.push(g)
    }
  }

  // ---- 重力井戸と補給ポッド（全員に見える）
  const objG = new THREE.Group(); scene.add(objG)
  let objKey = ''
  const pods = new Map(), wells = []
  const spiral = canvasTex(256, 256, (x, ww) => {
    x.translate(ww / 2, ww / 2)
    const g = x.createRadialGradient(0, 0, 0, 0, 0, ww / 2); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.3, 'rgba(40,0,70,.9)'); g.addColorStop(1, 'rgba(120,60,200,0)')
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, ww / 2, 0, 7); x.fill()
    x.lineWidth = 6
    for (let arm = 0; arm < 4; arm++) { x.strokeStyle = arm % 2 ? 'rgba(200,107,255,.7)' : 'rgba(79,216,255,.55)'; x.beginPath(); for (let t = 0; t < 1; t += 0.02) { const a = arm * Math.PI / 2 + t * 7, R = 20 + t * 105; x.lineTo(Math.cos(a) * R, Math.sin(a) * R) } x.stroke() }
  })
  function buildObjs(objs) {
    objG.clear(); pods.clear(); wells.length = 0
    for (const o of objs) {
      if (o[0] === 'well') {
        const [, , x, y, r] = o
        const g = new THREE.Group(); g.position.set(x * S, 0, -y * S)
        const disk = new THREE.Mesh(new THREE.CircleGeometry(r * S, 48), new THREE.MeshBasicMaterial({ map: spiral, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }))
        disk.rotation.x = -Math.PI / 2; disk.position.y = -1.2; g.add(disk)
        const core = new THREE.Mesh(new THREE.SphereGeometry(r * S * 0.2, 20, 14), basic(0x000000)); core.position.y = -0.6; g.add(core)
        const halo = new THREE.Mesh(new THREE.TorusGeometry(r * S * 0.24, 0.12, 8, 40), glow(0xc86bff, 0.9)); halo.rotation.x = Math.PI / 2; halo.position.y = -0.6; g.add(halo)
        const edgeR = new THREE.Mesh(new THREE.RingGeometry(r * S - 0.15, r * S, 64), glow(0xc86bff, 0.5)); edgeR.rotation.x = -Math.PI / 2; edgeR.position.y = -1.15; g.add(edgeR)
        objG.add(g); wells.push(disk)
      } else {
        const [kind, id, x, y] = o
        const g = new THREE.Group(); g.position.set(x * S, 0, -y * S)
        const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 6, 14), toon(POD_COLORS[kind] || 0xffffff)); cap.rotation.z = Math.PI / 2; g.add(cap)
        const bandM = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 8, 20), toon(0xffffff)); bandM.rotation.y = Math.PI / 2; g.add(bandM)
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: POD_COLORS[kind] || 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
        sp.scale.set(3, 3, 1); g.add(sp)
        objG.add(g); pods.set(id, { g, x, y, kind, got: false })
      }
    }
  }

  // ---- 危険地帯（ナビにだけ届く）
  const hzG = new THREE.Group(); scene.add(hzG)
  let hzKey = '', storms = []
  const rockGeo = new THREE.DodecahedronGeometry(1, 0)
  const rockMat = toon(0x8a6a52, { flatShading: true })
  const cloudMat = new THREE.SpriteMaterial({ map: soft(), color: 0xb070ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })
  function buildHazards(map) {
    hzG.clear(); storms = []
    const fields = map.filter(h => h[0] === 'field')
    const counts = fields.map(h => Math.max(8, Math.round(h[3] / 12)))
    const total = counts.reduce((a, b) => a + b, 0)
    if (total) {
      const im = new THREE.InstancedMesh(rockGeo, rockMat, total)
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3()
      let k = 0
      fields.forEach((h, i) => {
        const [, x, y, r] = h
        const rr = seeded(x * 7 + y * 13 + 1)
        for (let j = 0; j < counts[i]; j++) {
          const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * r * 0.92
          p.set((x + Math.cos(a) * d) * S, (rr() - 0.5) * 3, -(y + Math.sin(a) * d) * S)
          const s = 0.4 + rr() * 1.3
          sc.set(s, s * (0.6 + rr() * 0.5), s)
          q.setFromEuler(e.set(rr() * 6, rr() * 6, rr() * 6))
          m.compose(p, q, sc); im.setMatrixAt(k++, m)
        }
        const ring = new THREE.Mesh(new THREE.RingGeometry(r * S - 0.25, r * S, 48), glow(0xff8a1f, 0.55)); ring.rotation.x = -Math.PI / 2; ring.position.set(x * S, GRID_Y + 0.1, -y * S); hzG.add(ring)
      })
      hzG.add(im)
    }
    for (const h of map) {
      if (h[0] !== 'storm') continue
      const [, x, y, r] = h
      const g = new THREE.Group(); g.position.set(x * S, 0, -y * S)
      const rr = seeded(x * 3 + y * 5 + 7)
      for (let j = 0; j < 7; j++) {
        const sp = new THREE.Sprite(cloudMat.clone())
        const a = rr() * 6.28, d = rr() * r * 0.55
        sp.position.set(Math.cos(a) * d * S, (rr() - 0.5) * 2.5, Math.sin(a) * d * S)
        const s = r * S * (0.9 + rr() * 0.6); sp.scale.set(s, s * 0.7, 1); g.add(sp)
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * S - 0.25, r * S, 48), glow(0xc86bff, 0.6)); ring.rotation.x = -Math.PI / 2; ring.position.y = GRID_Y + 0.1; g.add(ring)
      hzG.add(g); storms.push(g)
    }
  }

  // ---- 隕石・弾・目印
  const MET = 24
  const meteorMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), toon(0xa0644a, { flatShading: true, emissive: 0x3a0a00 }), MET)
  meteorMesh.count = 0; meteorMesh.frustumCulled = false; scene.add(meteorMesh)
  const meteorGlowMat = new THREE.SpriteMaterial({ map: soft(), color: 0xff5a2a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
  const meteorGlows = [...Array(MET)].map(() => { const s = new THREE.Sprite(meteorGlowMat); s.scale.set(2.4, 2.4, 1); s.visible = false; scene.add(s); return s })
  const boltMat = new THREE.SpriteMaterial({ map: soft(), color: 0xffd23f, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  const bolts = [...Array(16)].map(() => { const s = new THREE.Sprite(boltMat); s.scale.set(1.1, 1.1, 1); s.visible = false; scene.add(s); return s })
  const marker = new THREE.Group()
  {
    const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), basic(0x4fd8ff)); d.scale.y = 1.4; marker.add(d); marker.userData.d = d
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 30, 8, 1, true), glow(0x4fd8ff, 0.35)); beam.position.y = 10; marker.add(beam)
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), glow(0x4fd8ff, 0.7)); ring.rotation.x = -Math.PI / 2; ring.position.y = GRID_Y + 0.1 - 0; marker.add(ring)
  }
  marker.visible = false; scene.add(marker)

  // ---- 粒（火花・紙吹雪・破片）と煙
  const PN = 260
  const partMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), PN)
  partMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PN * 3), 3)
  partMesh.count = 0; partMesh.frustumCulled = false; scene.add(partMesh)
  const parts = []
  const puffAdd = new THREE.SpriteMaterial({ map: soft(), color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  const puffs = [...Array(40)].map(() => { const s = new THREE.Sprite(puffAdd.clone()); s.visible = false; scene.add(s); return { s, life: 0, age: 0 } })
  const smokeMat = new THREE.SpriteMaterial({ map: soft(), color: 0x5a5470, transparent: true, depthWrite: false })
  const smokes = [...Array(24)].map(() => { const s = new THREE.Sprite(smokeMat.clone()); s.visible = false; scene.add(s); return { s, life: 0, age: 0 } })
  let puffI = 0, smokeI = 0
  function puff(pos, color, size, life, vel) {
    const p = puffs[puffI++ % puffs.length]
    p.s.visible = true; p.s.position.copy(pos); p.s.material.color.set(color); p.size = size; p.life = life; p.age = 0; p.vel = vel || new THREE.Vector3()
  }
  function smoke(pos) {
    const p = smokes[smokeI++ % smokes.length]
    p.s.visible = true; p.s.position.copy(pos); p.size = 0.8; p.life = 1.4; p.age = 0; p.vel = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.8, 0)
  }
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpC = new THREE.Color()
  function spray(x, y, z, colors, count, speed = 6, life = 1.2, up = 2) {
    for (let i = 0; i < count; i++) {
      if (parts.length >= PN) parts.shift()
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.3) * 1.4, v = speed * (0.4 + Math.random() * 0.8)
      parts.push({ x, y, z, vx: Math.cos(a) * Math.cos(b) * v, vy: Math.sin(b) * v + up, vz: Math.sin(a) * Math.cos(b) * v, life, age: 0, col: new THREE.Color(colors[i % colors.length]), spin: Math.random() * 10, rx: Math.random() * 6 })
    }
  }

  // ---- 画質
  function setTier(t) {
    tier = Math.max(0, Math.min(2, t))
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, [1, 1.5, 2][tier]))
    dust.visible = tier > 0
    grid.visible = tier > 0
  }
  setTier(tier)

  let sizeW = 1, sizeH = 1
  const fpsLog = []
  let lastTierCheck = performance.now() + 3000
  let camYaw = 0, camInit = false, shake = 0, lastHitSeen = 0, flameLen = 0
  const camPos = new THREE.Vector3(), lookAt = new THREE.Vector3()
  let endStart = 0, endKind = null, trailAt = 0, smokeAt = 0, blinkAt = 0, confAt = 0
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  function project(v) {
    tmpV.copy(v).project(camera)
    const behind = tmpV.z > 1
    return { x: (tmpV.x * 0.5 + 0.5) * sizeW, y: (-tmpV.y * 0.5 + 0.5) * sizeH, behind }
  }

  const api = {
    is3d: true,
    get tier() { return tier },
    setSize(wd, ht) {
      if (wd === sizeW && ht === sizeH) return
      sizeW = Math.max(1, wd); sizeH = Math.max(1, ht)
      renderer.setSize(sizeW, sizeH, false)
      camera.aspect = sizeW / sizeH
      camera.updateProjectionMatrix()
    },
    // 画面の点 → 船と同じ高さの面の上のワールド座標（防衛の照準）
    pick(px, py) {
      ndc.set(px / sizeW * 2 - 1, -(py / sizeH) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.ray.intersectPlane(plane, tmpV)
      if (hit && hit.distanceTo(camera.position) < 200) return { x: hit.x / S, y: -hit.z / S }
      const d = raycaster.ray.direction
      return { x: ship.position.x / S + d.x * 4000, y: -ship.position.z / S - d.z * 4000 }
    },
    // ワールドの (x, y) で粒をはじけさせる（隕石が砕けた、補給を拾った など）
    burst(x, y, kind) {
      const p = tmpV.set(x * S, 0, -y * S)
      if (kind === 'rock') { spray(p.x, p.y, p.z, ['#c08a6a', '#ffd23f', '#ff8a1f'], 18, 5, 0.9, 1); puff(p, 0xff8a3a, 3, 0.4) }
      else if (kind === 'pod') { spray(p.x, p.y, p.z, ['#3ef0b0', '#ffd23f', '#ffffff', '#4fd8ff'], 30, 4, 1.1, 3); puff(p, 0x3ef0b0, 5, 0.5) }
      else if (kind === 'hit') { spray(p.x, p.y, p.z, ['#ffd23f', '#ff4a5e', '#ffffff'], 24, 7, 0.8, 1); puff(p, 0xff5a2a, 4, 0.45) }
    },
    hit() { shake = 1; shield.material.opacity = 0.7 },
    // 1フレーム分。戻り値は HTML の札を重ねる位置
    frame(o) {
      const { now, dt, s, g } = o
      fpsLog.push(dt); if (fpsLog.length > 90) fpsLog.shift()
      if (now > lastTierCheck && fpsLog.length >= 60) {
        lastTierCheck = now + 2500
        const fps = fpsLog.length / fpsLog.reduce((a, b) => a + b, 0)
        if (fps < 40 && tier > 0) setTier(tier - 1)
      }
      const t = now / 1000
      const sx = s.x * S, sz = -s.y * S
      const fwdX = Math.sin(s.h), fwdZ = -Math.cos(s.h)
      ship.position.set(sx, 0, sz)
      ship.rotation.y = -s.h
      // 傾き: 曲がる向きに機体を倒し、ふわふわ浮く
      const steer = g.sys && g.sys.helm >= 0 ? 0 : g.steer || 0
      body.rotation.z += ((-steer * 0.42) - body.rotation.z) * Math.min(1, dt * 5)
      body.rotation.x = Math.sin(t * 1.7) * 0.04
      body.position.y = Math.sin(t * 2.1) * 0.12
      // 噴射: 速さに合わせて伸びる
      flameLen += ((0.3 + s.v / 105 * 1.5) - flameLen) * Math.min(1, dt * 4)
      const fl = flameLen * (0.85 + Math.random() * 0.3)
      flame.scale.set(1, fl, 1); flame.position.z = 1.9 + fl * 0.5
      flameCore.scale.set(1, fl * 0.7, 1); flameCore.position.z = 1.9 + fl * 0.35
      const engBroken = g.sys && g.sys.engine >= 0
      flame.material.color.set(engBroken ? 0x777777 : g.heat >= 80 ? 0xff4020 : 0xffa040)
      for (const f of sideFl) { f.scale.set(1, steer ? 1.4 : 0.6, 1); f.position.z = 2.0 }
      blob.position.set(sx, GRID_Y + 0.02, sz); blob.rotation.z = s.h

      // カメラ: 船の後ろ・少し上。向きは船にゆっくり追従
      if (!camInit) { camYaw = s.h; camInit = true }
      let dy = s.h - camYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI
      camYaw += dy * Math.min(1, dt * 3.2)
      const cyX = Math.sin(camYaw), cyZ = -Math.cos(camYaw)
      const portrait = sizeH > sizeW
      let dist = portrait ? 7.2 : 6.6, hgt = portrait ? 3.7 : 3.1
      const ended = g.phase === 'end' && g.end
      if (ended && !endKind) { endKind = g.end.win ? 'win' : g.end.reason; endStart = now }
      if (!ended) endKind = null
      const ee = endKind ? (now - endStart) / 1000 : 0
      if (endKind === 'win') {
        // 到着: 船のまわりをぐるっと回る
        const a = camYaw + Math.PI + ee * 0.9
        camPos.set(sx + Math.sin(a) * 7, 2.6 + ee * 0.4, sz - Math.cos(a) * 7)
        lookAt.set(sx, 0.4, sz)
      } else {
        if (endKind) { dist += ee * 3; hgt += ee * 1.5 }
        camPos.set(sx - cyX * dist, hgt, sz - cyZ * dist)
        lookAt.set(sx + cyX * 7, 0.2, sz + cyZ * 7)
      }
      if (o.hitAt && o.hitAt !== lastHitSeen) { lastHitSeen = o.hitAt; api.hit() }
      shake = Math.max(0, shake - dt * 2.2)
      camera.position.copy(camPos)
      if (shake > 0) camera.position.add(tmpV.set((Math.random() - 0.5) * shake * 0.7, (Math.random() - 0.5) * shake * 0.5, 0))
      camera.lookAt(lookAt)
      // 縦長の画面でも左右が見えるように、横の視野で決める
      const hfov = portrait ? 78 : 92
      const vfov = Math.max(48, Math.min(78, 2 * Math.atan(Math.tan(hfov * Math.PI / 360) / camera.aspect) * 180 / Math.PI)) + Math.min(6, s.v / 105 * 6)
      if (Math.abs(camera.fov - vfov) > 0.05) { camera.fov = vfov; camera.updateProjectionMatrix() }
      shield.material.opacity = Math.max(0, shield.material.opacity - dt * 1.8)

      // 空と遠くの天体はカメラについてくる（遠くにあるように見せる）
      sky.position.copy(camera.position)
      const gdx = o.goal.x * S - sx, gdz = -o.goal.y * S - sz, gl = Math.hypot(gdx, gdz) || 1
      backdrop.position.set(camera.position.x + gdx / gl * 520 + gdz / gl * 170, 120, camera.position.z + gdz / gl * 520 - gdx / gl * 170)
      if (backdrop.userData.spin) backdrop.userData.spin.rotation.z = t * 0.05
      if (backdrop.userData.flash) backdrop.userData.flash.emissive.setRGB(0.16 + (Math.random() < 0.02 ? 0.6 : 0), 0.04, 0.3)
      sun.position.set(sx - 30, 50, sz + 20); sun.target.position.set(sx, 0, sz)
      // ちり（カメラのまわりの箱の中でぐるぐる回す）
      if (dust.visible) {
        const cx = camera.position.x - DL / 2, cy = -DL / 2 + 2, cz = camera.position.z - DL / 2
        for (let i = 0; i < DUST; i++) {
          const k = i * 3
          dustPos[k] = cx + (((dustBase[k] - cx) % DL) + DL) % DL
          dustPos[k + 1] = cy + dustBase[k + 1]
          dustPos[k + 2] = cz + (((dustBase[k + 2] - cz) % DL) + DL) % DL
        }
        dustGeo.attributes.position.needsUpdate = true
      }
      grid.position.set(Math.round(sx / GS) * GS, GRID_Y, Math.round(sz / GS) * GS)

      // 目的地
      goalG.position.set(o.goal.x * S, 0, -o.goal.y * S)
      goalG.userData.tori.forEach((tr, i) => { tr.rotation.x = t * (0.6 + i * 0.3); tr.rotation.y = t * (0.4 + i * 0.25) })
      // 中継ライン
      if (o.gates && gateGs.length !== o.gates.length) buildGates(o.gates)
      gateTex.offset.x = -t * 0.6
      gateGs.forEach((gg, i) => { const done = i < (g.sec || 0); gg.userData.mat.color.set(done ? 0x3ef0b0 : 0xffd23f); gg.userData.postMat.color.set(done ? 0x3ef0b0 : 0xffd23f) })
      // 井戸と補給
      if (o.objs) {
        const k = o.objs.length + ':' + (o.objs[0] || []).join()
        if (k !== objKey) { objKey = k; buildObjs(o.objs) }
      }
      for (const wl of wells) wl.rotation.z = t * 1.2
      for (const [id, p] of pods) {
        const got = o.got && o.got.includes(id)
        if (got && !p.got) { p.got = true; api.burst(p.x, p.y, 'pod') }
        p.g.visible = !got
        p.g.position.y = Math.sin(t * 2 + id) * 0.3
        p.g.rotation.y = t * 1.5 + id
      }
      // 危険地帯
      if (o.map) {
        const k = o.map.length + ':' + (o.map[0] || []).join()
        if (k !== hzKey) { hzKey = k; buildHazards(o.map) }
      }
      hzG.visible = !!o.map && g.radar !== false
      for (const st of storms) for (const c of st.children) if (c.isSprite) c.material.opacity = 0.22 + (Math.random() < 0.015 ? 0.5 : 0) + Math.sin(t * 2 + c.position.x) * 0.06
      // 目印
      marker.visible = !!g.marker
      if (g.marker) { marker.position.set(g.marker.x * S, 0, -g.marker.y * S); marker.userData.d.rotation.y = t * 2; marker.userData.d.position.y = Math.sin(t * 3) * 0.3 }
      // 隕石
      const ms = o.meteors || []
      meteorMesh.count = Math.min(MET, ms.length)
      for (let i = 0; i < MET; i++) {
        const m = ms[i]
        if (!m) { meteorGlows[i].visible = false; continue }
        const sc = 0.62 + hash(m[0]) * 0.25
        tmpQ.setFromEuler(tmpE.set(t * (1 + hash(m[0], 1)) + m[0], t * 0.7 + m[0] * 2, 0))
        tmpM.compose(tmpV.set(m[1] * S, Math.sin(m[0]) * 0.4, -m[2] * S), tmpQ, tmpS.set(sc, sc * 0.85, sc))
        meteorMesh.setMatrixAt(i, tmpM)
        meteorGlows[i].visible = true; meteorGlows[i].position.set(m[1] * S, Math.sin(m[0]) * 0.4, -m[2] * S)
      }
      meteorMesh.instanceMatrix.needsUpdate = true
      const bs = o.bolts || []
      bolts.forEach((b, i) => { const v = bs[i]; b.visible = !!v; if (v) b.position.set(v[1] * S, 0.2, -v[2] * S) })

      // クルー: カメラの方へ振り向く。表情
      const present = (g.crew || []).map(c => c.seat)
      const ck = present.join()
      if (ck !== crewKey) { crewKey = ck; placeCrew(present) }
      if (now > blinkAt) blinkAt = now + 2500 + Math.random() * 2000
      const blinking = blinkAt - now < 130
      crew.forEach((c, i) => {
        if (!c.g.visible) return
        let ex = (o.expr && o.expr[i]) || 'normal'
        if (ex === 'normal' && blinking) ex = 'blink'
        if (c.face.material !== faceMats[ex]) c.face.material = faceMats[ex]
        c.skin.color.set(ex === 'gasp' ? 0x9fc4ff : 0xffdcbc)
        let bounce = 0
        if (endKind === 'win') bounce = Math.abs(Math.sin(ee * 7 + i)) * 0.25
        else if (ex === 'panic' || ex === 'shout') bounce = Math.abs(Math.sin(t * 14 + i)) * 0.05
        if (endKind === 'hull') {
          // 大破: クルーが窓から飛び出してくるくる回る
          if (!c.fly) c.fly = new THREE.Vector3((Math.random() - 0.5) * 3, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 3)
          c.g.position.set(c.base.x + c.fly.x * ee, c.base.y + c.fly.y * ee - 0.8 * ee * ee, c.base.z + c.fly.z * ee)
          c.g.rotation.set(ee * 5 + i, ee * 4, ee * 3)
        } else {
          c.fly = null
          c.g.position.set(c.base.x, c.base.y + bounce, c.base.z)
          // カメラの方を向く（顔が見えるように）。眠い・めまいは首をかしげる
          c.g.lookAt(camera.position)
          if (ex === 'dizzy') c.g.rotateZ(Math.sin(t * 6 + i) * 0.3)
          if (endKind === 'time') c.g.rotateX(0.35)
        }
      })
      // ネコ
      cat.visible = !!g.cat
      if (g.cat) { cat.userData.tail.rotation.z = Math.sin(t * 8) * 0.6; cat.rotation.y = Math.sin(t * 1.3) * 0.4 + Math.PI }
      // 終わりの演出
      if (endKind === 'hull') {
        const k = Math.max(0, 1 - ee * 0.8)
        for (const ch of body.children) if (!crew.some(c => c.g === ch)) ch.visible = ee < 0.35 || Math.random() < k
        body.rotation.y = ee * 3; body.rotation.z = ee * 2
        if (ee < 1.2 && Math.random() < 0.6) puff(tmpV.set(sx + (Math.random() - 0.5) * 3, Math.random() * 2, sz + (Math.random() - 0.5) * 3), Math.random() < 0.5 ? 0xff8a1f : 0xffd23f, 3 + Math.random() * 3, 0.6)
        if (ee < 0.05) { spray(sx, 0, sz, ['#f6f1e7', '#ff8a1f', '#2a2350', '#ffd23f'], 80, 9, 2, 2); shake = 1.4 }
      } else {
        for (const ch of body.children) if (ch !== cat && ch !== shield) ch.visible = ch.userData.hide ? false : (crew.some(c => c.g === ch) ? ch.visible : true)
        if (!endKind) body.rotation.y = 0
      }
      if (endKind === 'win' && now > confAt) { confAt = now + 350; spray(sx, 2, sz, ['#ff8a1f', '#3ef0b0', '#4fd8ff', '#c86bff', '#ffd23f', '#ff7ab8'], 30, 5, 2.4, 6) }
      // 噴射の跡と煙
      if (!endKind && now > trailAt && s.v > 5) { trailAt = now + 60; puff(tmpV.set(sx - fwdX * 2.4, body.position.y, sz - fwdZ * 2.4), engBroken ? 0x777777 : 0xff9a3a, 0.5 + s.v / 105 * 0.6, 0.45, new THREE.Vector3(-fwdX * 2, 0, -fwdZ * 2)) }
      if (!endKind && (g.hull < 45 || engBroken) && now > smokeAt) { smokeAt = now + (g.hull < 25 ? 90 : 200); smoke(tmpV.set(sx + (Math.random() - 0.5), 0.6, sz + (Math.random() - 0.5))) }

      // 粒
      let k = 0
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.age += dt
        if (p.age > p.life) { parts.splice(i, 1); continue }
      }
      for (const p of parts) {
        p.vy -= 6 * dt; p.vx *= 0.99; p.vz *= 0.99
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
        tmpQ.setFromEuler(tmpE.set(p.rx + p.age * p.spin, p.age * p.spin * 0.7, 0))
        const sc = 1 - p.age / p.life * 0.5
        tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ, tmpS.set(sc, sc, sc))
        partMesh.setMatrixAt(k, tmpM); partMesh.setColorAt(k, p.col); k++
      }
      partMesh.count = k
      partMesh.instanceMatrix.needsUpdate = true
      if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true
      for (const p of [...puffs, ...smokes]) {
        if (!p.s.visible) continue
        p.age += dt
        if (p.age >= p.life) { p.s.visible = false; continue }
        const u = p.age / p.life
        p.s.position.addScaledVector(p.vel, dt)
        const sz2 = p.size * (0.6 + u * 1.2)
        p.s.scale.set(sz2, sz2, 1)
        p.s.material.opacity = (1 - u) * 0.85
      }

      renderer.render(scene, camera)

      // HTML の札の位置
      const out = { crew: [], goal: null, marker: null, meteors: [] }
      crew.forEach((c, i) => {
        if (!c.g.visible) return
        c.g.getWorldPosition(tmpV); tmpV.y += 0.45
        out.crew[i] = project(tmpV)
      })
      out.goal = project(tmpV.set(o.goal.x * S, 1.5, -o.goal.y * S))
      if (g.marker) out.marker = project(tmpV.set(g.marker.x * S, 0, -g.marker.y * S))
      for (const m of ms) out.meteors.push(project(tmpV.set(m[1] * S, 0, -m[2] * S)))
      out.ship = project(tmpV.set(sx, 0.5, sz))
      return out
    },
    // 描けているかの確認用: いまの画面の輝度の分散
    variance() {
      renderer.render(scene, camera)
      const gl = renderer.getContext()
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight
      const px = new Uint8Array(4)
      let s1 = 0, s2 = 0, nn = 0
      for (let yy = 4; yy < H; yy += Math.max(1, H / 24 | 0)) for (let xx = 4; xx < W; xx += Math.max(1, W / 24 | 0)) {
        gl.readPixels(xx, yy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
        const l = px[0] * 0.3 + px[1] * 0.59 + px[2] * 0.11; s1 += l; s2 += l * l; nn++
      }
      return s2 / nn - (s1 / nn) ** 2
    },
    fps() { return fpsLog.length ? fpsLog.length / fpsLog.reduce((a, b) => a + b, 0) : 0 },
    dispose() {
      scene.traverse(ob => { if (ob.geometry) ob.geometry.dispose(); const m = ob.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { if (x.map) x.map.dispose(); x.dispose() }) })
      renderer.dispose()
      try { renderer.forceContextLoss() } catch {} // 再戦のたびに WebGL の枠を返す（端末ごとの上限に当たらないように）
    }
  }
  return api
}

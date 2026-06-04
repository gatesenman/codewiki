// Pure-Node icon generator (no native deps). Renders the CodeWiki mark:
// rounded-square diagonal gradient + white "</>" glyph + graph nodes.
// Outputs build/icon.png (1024x1024 RGBA). electron-builder derives .ico/.icns.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const W = 1024, H = 1024
const buf = Buffer.alloc(W * H * 4)

function lerp(a, b, t) { return a + (b - a) * t }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

// distance from point P to segment AB
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = clamp(t, 0, 1)
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

const R = 190 // corner radius
const segs = [ // white glyph strokes
  [380, 330, 250, 512], [250, 512, 380, 694], // "<"
  [470, 720, 560, 304],                        // "/"
  [644, 330, 774, 512], [774, 512, 644, 694],  // ">"
]
const halfW = 30
const nodes = [[512, 150, 34], [330, 858, 28], [694, 858, 28]] // graph dots
const links = [[512, 150, 330, 858], [512, 150, 694, 858]]

// gradient endpoints (indigo -> violet)
const c0 = [79, 70, 229], c1 = [168, 85, 247]

function roundedAlpha(x, y) {
  // smooth coverage for a rounded square mask
  const corners = [[R, R], [W - R, R], [R, H - R], [W - R, H - R]]
  for (const [cx, cy] of corners) {
    if ((x < R && y < R) || (x > W - R && y < R) || (x < R && y > H - R) || (x > W - R && y > H - R)) {
      // only the actual corner quadrant for this center
      const inQuad = (x < R ? cx === R : cx === W - R) && (y < R ? cy === R : cy === H - R)
      if (!inQuad) continue
      const d = Math.hypot(x - cx, y - cy)
      return clamp(R - d + 0.5, 0, 1)
    }
  }
  return 1
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const t = (x + y) / (W + H)
    let r = lerp(c0[0], c1[0], t)
    let g = lerp(c0[1], c1[1], t)
    let b = lerp(c0[2], c1[2], t)

    // graph links (thin, semi-transparent white)
    let linkCov = 0
    for (const [ax, ay, bx, by] of links) {
      const d = distSeg(x, y, ax, ay, bx, by)
      linkCov = Math.max(linkCov, clamp(8 - d + 0.5, 0, 1) * 0.5)
    }
    if (linkCov > 0) { r = lerp(r, 255, linkCov); g = lerp(g, 255, linkCov); b = lerp(b, 255, linkCov) }

    // glyph strokes
    let cov = 0
    for (const [ax, ay, bx, by] of segs) {
      const d = distSeg(x, y, ax, ay, bx, by)
      cov = Math.max(cov, clamp(halfW - d + 0.5, 0, 1))
    }
    // graph nodes (filled circles)
    for (const [cx, cy, rad] of nodes) {
      const d = Math.hypot(x - cx, y - cy)
      cov = Math.max(cov, clamp(rad - d + 0.5, 0, 1))
    }
    if (cov > 0) { r = lerp(r, 255, cov); g = lerp(g, 255, cov); b = lerp(b, 255, cov) }

    const a = roundedAlpha(x, y) * 255
    buf[i] = Math.round(r); buf[i + 1] = Math.round(g); buf[i + 2] = Math.round(b); buf[i + 3] = Math.round(a)
  }
}

// ---- PNG encode ----
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
// scanlines with filter byte 0
const raw = Buffer.alloc((W * 4 + 1) * H)
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0
  buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
}
const idat = zlib.deflateSync(raw, { level: 9 })
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
const out = path.join(__dirname, 'icon.png')
fs.writeFileSync(out, png)
console.log('wrote', out, png.length, 'bytes')

/**
 * Generates NSIS installer assets:
 *   build/sidebar.bmp  164×314  – Welcome / Finish page left panel
 *   build/header.bmp   150×57   – all other pages top-right
 *   build/icon.ico              – PNG-embedded Windows icon
 *
 * Pure Node.js – uses only built-in modules (fs, path, zlib).
 */

'use strict'
const fs   = require('fs')
const path = require('path')
const zlib = require('zlib')

// ─────────────────────────────────────────────────────────────────────────────
//  PNG decoder  (handles colorType 2=RGB, 6=RGBA, 0=Gray, 4=GrayAlpha)
// ─────────────────────────────────────────────────────────────────────────────
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
}

function decodePNG(buf) {
  const SIG = [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('Not a PNG')

  let off = 8, W = 0, H = 0, bitDepth = 0, colorType = 0
  const idats = []

  while (off < buf.length) {
    const len  = buf.readUInt32BE(off); off += 4
    const type = buf.toString('ascii', off, off + 4); off += 4
    const data = buf.slice(off, off + len); off += len + 4  // skip CRC
    if      (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9] }
    else if (type === 'IDAT') idats.push(Buffer.from(data))
    else if (type === 'IEND') break
  }

  // channels: colorType → [0=Gray,2=RGB,4=GrayA,6=RGBA]
  const ch  = [1,0,3,1,2,0,4][colorType]
  const bpp = ch * (bitDepth >> 3)           // bytes per pixel
  const stride = W * bpp

  const raw  = zlib.inflateSync(Buffer.concat(idats))
  const rgba = new Uint8Array(W * H * 4)

  const rows = []
  for (let y = 0; y < H; y++) {
    const ft   = raw[y * (stride + 1)]
    const src  = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const prev = rows[y - 1] ?? new Uint8Array(stride)
    const row  = new Uint8Array(stride)

    for (let i = 0; i < stride; i++) {
      const s = src[i]
      const a = i >= bpp ? row[i - bpp] : 0
      const d = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      switch (ft) {
        case 0: row[i] = s;                                        break
        case 1: row[i] = (s + a)                          & 0xFF; break
        case 2: row[i] = (s + d)                          & 0xFF; break
        case 3: row[i] = (s + Math.floor((a + d) / 2))   & 0xFF; break
        case 4: row[i] = (s + paeth(a, d, c))             & 0xFF; break
      }
    }
    rows.push(row)

    // convert row → RGBA
    for (let x = 0; x < W; x++) {
      const si = x * bpp, di = (y * W + x) * 4
      if      (colorType === 6) { rgba[di]=row[si]; rgba[di+1]=row[si+1]; rgba[di+2]=row[si+2]; rgba[di+3]=row[si+3] }
      else if (colorType === 2) { rgba[di]=row[si]; rgba[di+1]=row[si+1]; rgba[di+2]=row[si+2]; rgba[di+3]=255 }
      else if (colorType === 0) { rgba[di]=rgba[di+1]=rgba[di+2]=row[si]; rgba[di+3]=255 }
      else if (colorType === 4) { rgba[di]=rgba[di+1]=rgba[di+2]=row[si]; rgba[di+3]=row[si+1] }
    }
  }
  return { width: W, height: H, rgba }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Nearest-neighbour image scaler
// ─────────────────────────────────────────────────────────────────────────────
function scaleRGBA(src, sW, sH, dW, dH) {
  const dst = new Uint8Array(dW * dH * 4)
  for (let y = 0; y < dH; y++) {
    const sy = Math.min(Math.round(y * sH / dH), sH - 1)
    for (let x = 0; x < dW; x++) {
      const sx = Math.min(Math.round(x * sW / dW), sW - 1)
      const si = (sy * sW + sx) * 4
      const di = (y  * dW + x ) * 4
      dst[di]=src[si]; dst[di+1]=src[si+1]; dst[di+2]=src[si+2]; dst[di+3]=src[si+3]
    }
  }
  return dst
}

// ─────────────────────────────────────────────────────────────────────────────
//  Canvas helpers  (flat Uint8Array, RGB, row-major top-down)
// ─────────────────────────────────────────────────────────────────────────────
function makeCanvas(w, h) { return new Uint8Array(w * h * 3) }

function setRGB(cv, w, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= w || y >= cv.length / 3 / w) return
  const i = (y * w + x) * 3; cv[i]=r; cv[i+1]=g; cv[i+2]=b
}

function blendRGB(cv, w, x, y, r, g, b, a /* 0-255 */) {
  const H = cv.length / 3 / w
  if (x < 0 || y < 0 || x >= w || y >= H) return
  const i = (y * w + x) * 3
  const t = a / 255
  cv[i]   = Math.round(cv[i]   * (1-t) + r * t)
  cv[i+1] = Math.round(cv[i+1] * (1-t) + g * t)
  cv[i+2] = Math.round(cv[i+2] * (1-t) + b * t)
}

function lerp(a, b, t) { return Math.round(a + (b - a) * Math.max(0, Math.min(1, t))) }

/** Fill rectangle with solid colour */
function fillRect(cv, w, x0, y0, rw, rh, r, g, b) {
  for (let dy = 0; dy < rh; dy++)
    for (let dx = 0; dx < rw; dx++)
      setRGB(cv, w, x0+dx, y0+dy, r, g, b)
}

/** Draw filled anti-aliased-ish circle */
function fillCircle(cv, w, cx, cy, radius, r, g, b) {
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx*dx + dy*dy
      if (d2 <= r2) {
        // soft edge
        const edge = Math.min(1, (r2 - d2) / (2 * radius))
        blendRGB(cv, w, cx+dx, cy+dy, r, g, b, Math.round(255 * Math.min(1, edge + 0.5)))
      }
    }
}

/** Blend an RGBA image onto the canvas */
function drawImage(cv, cw, rgba, iw, ih, dx, dy) {
  for (let y = 0; y < ih; y++)
    for (let x = 0; x < iw; x++) {
      const si = (y*iw+x)*4
      const alpha = rgba[si+3]
      if (alpha > 4)
        blendRGB(cv, cw, dx+x, dy+y, rgba[si], rgba[si+1], rgba[si+2], alpha)
    }
}

/** Horizontal gradient fill */
function hGradient(cv, w, x0, y0, rw, rh, r1,g1,b1, r2,g2,b2) {
  for (let dy = 0; dy < rh; dy++)
    for (let dx = 0; dx < rw; dx++) {
      const t = rw > 1 ? dx / (rw - 1) : 0
      setRGB(cv, w, x0+dx, y0+dy, lerp(r1,r2,t), lerp(g1,g2,t), lerp(b1,b2,t))
    }
}

/** Vertical gradient fill */
function vGradient(cv, w, x0, y0, rw, rh, r1,g1,b1, r2,g2,b2) {
  for (let dy = 0; dy < rh; dy++)
    for (let dx = 0; dx < rw; dx++) {
      const t = rh > 1 ? dy / (rh - 1) : 0
      setRGB(cv, w, x0+dx, y0+dy, lerp(r1,r2,t), lerp(g1,g2,t), lerp(b1,b2,t))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BMP writer from flat canvas (24-bit uncompressed)
// ─────────────────────────────────────────────────────────────────────────────
function writeBMP(filePath, cv, w, h) {
  const rowSize = Math.floor((24*w + 31) / 32) * 4
  const dataSize = rowSize * h
  const fileSize = 54 + dataSize
  const buf = Buffer.alloc(fileSize, 0)

  buf[0]=0x42; buf[1]=0x4D
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(w,   18)
  buf.writeInt32LE(-h,  22)          // negative = top-down
  buf.writeUInt16LE(1,  26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(dataSize, 34)
  buf.writeInt32LE(2835, 38)
  buf.writeInt32LE(2835, 42)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y*w+x)*3
      const di = 54 + y*rowSize + x*3
      buf[di]=cv[si+2]; buf[di+1]=cv[si+1]; buf[di+2]=cv[si]  // BMP = BGR
    }
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buf)
  console.log(`  ✓ ${filePath}  (${w}×${h})`)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Load logo PNG
// ─────────────────────────────────────────────────────────────────────────────
const pngPath = path.join(__dirname, '../logo_studchecker.png')
let logo = null
try {
  logo = decodePNG(fs.readFileSync(pngPath))
  console.log(`  ✓ Logo decoded: ${logo.width}×${logo.height}`)
} catch (e) {
  console.warn(`  ⚠ Could not decode logo PNG: ${e.message}`)
}

// Colour palette (matches installer_template.txt)
//  --primary-blue  #0078D7 → {r:0,   g:120, b:215}
//  --accent-cyan   #00B4D8 → {r:0,   g:180, b:216}
//  dark navy       #003066 → {r:0,   g:48,  b:102}
//  mid blue        #0055A3 → {r:0,   g:85,  b:163}

// ─────────────────────────────────────────────────────────────────────────────
//  SIDEBAR  164 × 314
//  Layout (mirrors installer_template.txt):
//    0–314   dark-navy → primary-blue vertical gradient
//    white circle + app logo centered near top
//    thin white separator line  ~55 % down
//    3 step-dot indicators  ~75 % down
// ─────────────────────────────────────────────────────────────────────────────
;(function buildSidebar() {
  const W = 164, H = 314
  const cv = makeCanvas(W, H)

  // background gradient  #003066 → #0078D7
  vGradient(cv, W, 0, 0, W, H, 0,48,102, 0,120,215)

  // subtle right-edge separator
  for (let y = 0; y < H; y++) setRGB(cv, W, W-1, y, 210, 225, 245)

  // ── logo circle ──────────────────────────────────────────────────────────
  const logoSize = 84          // rendered logo pixel size
  const cirR     = 50          // white circle radius
  const cirCX    = Math.round(W / 2)
  const cirCY    = 90

  // white filled circle
  fillCircle(cv, W, cirCX, cirCY, cirR, 255, 255, 255)

  // subtle blue ring
  for (let angle = 0; angle < 360; angle += 0.8) {
    const rad = angle * Math.PI / 180
    const px = Math.round(cirCX + Math.cos(rad) * (cirR + 1))
    const py = Math.round(cirCY + Math.sin(rad) * (cirR + 1))
    blendRGB(cv, W, px, py, 0, 120, 215, 100)
  }

  if (logo) {
    const scaled = scaleRGBA(logo.rgba, logo.width, logo.height, logoSize, logoSize)
    drawImage(cv, W, scaled, logoSize, logoSize,
      Math.round(cirCX - logoSize / 2),
      Math.round(cirCY - logoSize / 2))
  }

  // ── horizontal separator ─────────────────────────────────────────────────
  const sepY = 168
  for (let x = 14; x < W - 14; x++)
    blendRGB(cv, W, x, sepY, 255, 255, 255, 55)

  // ── three step dots (like the template's steps-indicator) ────────────────
  const dotY = 240
  const dotCX = Math.round(W / 2)
  const dotGap = 14
  for (let i = -1; i <= 1; i++) {
    const x = dotCX + i * dotGap
    if (i === -1) {
      // active dot — filled white, slightly larger
      fillCircle(cv, W, x, dotY, 5, 255, 255, 255)
    } else {
      // inactive dot — hollow, semi-transparent
      for (let angle = 0; angle < 360; angle += 5) {
        const rad = angle * Math.PI / 180
        blendRGB(cv, W,
          Math.round(x + Math.cos(rad) * 4),
          Math.round(dotY + Math.sin(rad) * 4),
          255, 255, 255, 140)
      }
    }
  }

  // ── bottom tinted band ────────────────────────────────────────────────────
  for (let y = 275; y < H - 1; y++)
    for (let x = 0; x < W - 1; x++)
      blendRGB(cv, W, x, y, 255, 255, 255, 18)

  writeBMP(path.join(__dirname, '../build/sidebar.bmp'), cv, W, H)
})()

// ─────────────────────────────────────────────────────────────────────────────
//  HEADER  150 × 57
//  Layout:
//    left portion – blue gradient
//    right portion – white circle with app logo
// ─────────────────────────────────────────────────────────────────────────────
;(function buildHeader() {
  const W = 150, H = 57
  const cv = makeCanvas(W, H)

  // background gradient  #003366 → #00B4D8  (horizontal)
  hGradient(cv, W, 0, 0, W, H, 0,51,102, 0,180,216)

  // subtle vertical darkening toward bottom
  for (let y = 0; y < H; y++) {
    const alpha = Math.round(y / (H - 1) * 35)
    for (let x = 0; x < W - 2; x++) blendRGB(cv, W, x, y, 0, 0, 0, alpha)
  }

  // white separator on right edge
  for (let y = 0; y < H; y++) setRGB(cv, W, W-1, y, 255, 255, 255)
  for (let y = 0; y < H; y++) blendRGB(cv, W, W-2, y, 255, 255, 255, 80)

  // ── logo circle (right side) ─────────────────────────────────────────────
  if (logo) {
    const logoSize = 36
    const cirR  = 20
    const cirCX = W - cirR - 8
    const cirCY = Math.round(H / 2)

    fillCircle(cv, W, cirCX, cirCY, cirR, 255, 255, 255)

    const scaled = scaleRGBA(logo.rgba, logo.width, logo.height, logoSize, logoSize)
    drawImage(cv, W, scaled, logoSize, logoSize,
      cirCX - Math.round(logoSize / 2),
      cirCY - Math.round(logoSize / 2))
  }

  writeBMP(path.join(__dirname, '../build/header.bmp'), cv, W, H)
})()

// ─────────────────────────────────────────────────────────────────────────────
//  ICO  (PNG-embedded, Vista+ compatible)
// ─────────────────────────────────────────────────────────────────────────────
;(function buildIco() {
  if (!fs.existsSync(pngPath)) {
    console.warn('  ⚠ logo_studchecker.png not found — skipping icon.ico')
    return
  }
  const pngData   = fs.readFileSync(pngPath)
  const dataOffset = 22   // 6 (ICONDIR) + 16 (ICONDIRENTRY)
  const buf = Buffer.alloc(dataOffset + pngData.length)

  buf.writeUInt16LE(0, 0)              // reserved
  buf.writeUInt16LE(1, 2)              // type=1 icon
  buf.writeUInt16LE(1, 4)              // count=1
  buf[6]=0; buf[7]=0                   // 0×0 → 256px
  buf[8]=0; buf[9]=0                   // colorCount, reserved
  buf.writeUInt16LE(1,  10)            // planes
  buf.writeUInt16LE(32, 12)            // bitCount
  buf.writeUInt32LE(pngData.length, 14)
  buf.writeUInt32LE(dataOffset,     18)
  pngData.copy(buf, dataOffset)

  const icoPath = path.join(__dirname, '../build/icon.ico')
  fs.writeFileSync(icoPath, buf)
  console.log(`  ✓ ${icoPath}  (${Math.round(buf.length/1024)} KB)`)
})()

console.log('Done.')

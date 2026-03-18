/**
 * Full packaging pipeline:
 *   1. Generate NSIS installer bitmaps (build/header.bmp, build/sidebar.bmp)
 *   2. Run electron-vite build (compiles renderer + main + preload)
 *   3. Run electron-builder --win  (creates NSIS installer in dist/)
 *
 * Usage:  node scripts/pack.js
 *         npm run pack:win
 */

'use strict'

const { spawnSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function run(cmd, args, opts = {}) {
  console.log(`\n▶  ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '0' },
    ...opts
  })
  if (result.status !== 0) {
    console.error(`\n✗  Command failed with exit code ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

// ── Step 1: generate installer bitmaps ───────────────────────────────────────
console.log('\n═══  Step 1 / 3 — Generating installer bitmaps  ═══')
run('node', ['scripts/generate-bitmaps.js'])

// ── Step 2: compile renderer + main + preload with electron-vite ─────────────
console.log('\n═══  Step 2 / 3 — Building with electron-vite  ═══')
run('npx', ['electron-vite', 'build'])

// ── Step 3: package into NSIS installer with electron-builder ────────────────
console.log('\n═══  Step 3 / 3 — Packaging with electron-builder  ═══')
run('npx', ['electron-builder', '--win'])

console.log('\n✓  Done!  Installer is in the dist/ folder.')

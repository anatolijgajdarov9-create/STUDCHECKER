const { spawn } = require('child_process')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn('npx', ['electron-vite', 'dev'], {
  env,
  stdio: 'inherit',
  shell: true
})

child.on('exit', (code) => process.exit(code ?? 0))

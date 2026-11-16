// Starts `next dev` on the LAN address of .env.local (LOCAL_DEVELOPMENT_LAN_HOST and AUTH_URL), for trying the app from
// another device on the same network. Usage: npm run dev:lan
const { loadEnvConfig } = require('@next/env')
const { spawn } = require('node:child_process')
const { isIPv4 } = require('node:net')

loadEnvConfig(process.cwd(), true)
const host = process.env.LOCAL_DEVELOPMENT_LAN_HOST
let url
try { url = new URL(process.env.AUTH_URL) } catch { /* Report invalid configuration below. */ }
const parts = (host ?? '').split('.').map(Number)
const privateAddress = isIPv4(host ?? '') && (parts[0] === 10 ||
  (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
  (parts[0] === 192 && parts[1] === 168))
if (!privateAddress || url?.protocol !== 'http:' || url.hostname !== host) {
  console.error('.env.local の LOCAL_DEVELOPMENT_LAN_HOST と AUTH_URL に同じLAN内IPv4を設定してください。')
  process.exit(1)
}
const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', host, '--port', url.port || '80'], { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => next.kill(signal))
next.on('exit', (code, signal) => process.exit(code ?? (signal === 'SIGINT' ? 130 : 143)))

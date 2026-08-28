import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const m = JSON.parse(readFileSync(join(__dirname, '..', 'assets', 'voices', 'manifest.json'), 'utf8'))
const target = m.lines.find((l) => l.text === '被摸头了~有点害羞')
console.log('target line:', JSON.stringify(target))
// 复制 host 的匹配逻辑
const t = '被摸头了~有点害羞'
const ins = '用非常小声的害羞语气轻声说'
const speed = 0.85
const gain = 0.75
for (const line of m.lines) {
  if (line.text !== t || line.instruct !== ins) continue
  const sOk = (typeof line.speed === 'number') === (typeof speed === 'number') && (typeof speed !== 'number' || line.speed === speed)
  const gOk = (typeof line.gain === 'number') === (typeof gain === 'number') && (typeof gain !== 'number' || line.gain === gain)
  console.log('candidate:', line.file, 'sOk=', sOk, 'gOk=', gOk)
}

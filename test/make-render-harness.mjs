// make-render-harness.mjs — 生成客户端渲染测试页(内联 client 源码 + 真实皮肤 + 假 fetch)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const mode = process.argv[2] === 'pat' ? 'pat' : (process.argv[2] === 'notice' ? 'notice' : 'balance')

const clientSrc = readFileSync(join(root, 'client', 'client.js'), 'utf8')
const skin3 = readFileSync(join(root, 'assets', 'skins', 'whale-skin-3.png')).toString('base64')
const skin4 = readFileSync(join(root, 'assets', 'skins', 'whale-skin-4.png')).toString('base64')

const stateFixture = {
  ok: true,
  balance: { ok: true, isAvailable: true, rows: [{ currency: 'CNY', total: 89.59, granted: 45.6, toppedUp: 1.23 }] },
  balanceError: null,
  taskDone: null,
  taskQueue: mode === 'notice' ? [{ id: 42, status: 'completed', kind: 'agent', title: '历史任务', costCny: 0 }] : [],
  usage: { calls: 1534, inputTokens: 3949943, outputTokens: 739342, cacheReadTokens: 692594688 },
  sessionCost: { costCny: 1.23 },
  monthlyUsage: { costCny: 45.6 },
  lowBalance: { active: false, version: 0, amount: 0 },
  voiceEngine: 'browser',
  busy: false,
}

const fixtures = {
  '/api/dsh-whale-pet/state': stateFixture,
  '/api/dsh-whale-pet/refresh-balance': stateFixture,
  '/api/dsh-whale-pet/speech': { ok: true },
  '/api/dsh-whale-pet/speech-audio': { ok: true, base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=' },
  '/api/dsh-whale-pet/asset': { ok: true, skin: 3, base64: skin3, mime: 'image/png', size: skin3.length, w: 480, h: 499 },
  '/api/dsh-whale-pet/notice-voices': { ok: true, voices: {} },
  '/api/dsh-whale-pet/desktop-toggle': { ok: true, alive: false },
}
const assetSkin4 = { ok: true, skin: 4, base64: skin4, mime: 'image/png', size: skin4.length, w: 300, h: 300 }

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>whale client render harness</title>
<style>
  body { margin: 0; height: 1100px; background: linear-gradient(#eef3fb, #dfe9f7); }
  .scene-label { font-family: sans-serif; font-size: 13px; color: #334; padding: 10px; }
</style>
</head>
<body>
<div class="scene-label">DSH Web GUI (模拟) — 右下角应为鲸鱼娘桌宠</div>
<script>
window.__petModule = null
window.__ModuleLoader__ = { load: function (x) { window.__petModule = x.factory(); } }
var FIXTURES = ${JSON.stringify(fixtures)}
var ASSET_SKIN4 = ${JSON.stringify(assetSkin4)}
window.fetch = function (path, init) {
  var body = FIXTURES[path] || { ok: true }
  if (path === '/api/dsh-whale-pet/asset') {
    var reqBody = {}
    try { if (init && init.body) reqBody = JSON.parse(init.body) } catch (e) {}
    body = reqBody.skin === 4 ? ASSET_SKIN4 : FIXTURES[path]
  }
  ${mode === 'notice' ? `
  if (path === '/api/dsh-whale-pet/state') {
    var item = { id: 43, status: 'completed', kind: 'agent', title: '完成WHALE交接三任务', costCny: 1.98 }
    var n = (window.__stateCalls = (window.__stateCalls || 0) + 1)
    var clone = JSON.parse(JSON.stringify(FIXTURES[path]))
    clone.taskQueue = n > 1 ? [{ id: 42, status: 'completed', kind: 'agent', title: '历史任务', costCny: 0 }, item] : [{ id: 42, status: 'completed', kind: 'agent', title: '历史任务', costCny: 0 }]
    body = clone
  }` : ''}
  return Promise.resolve({ json: function () { return Promise.resolve(body) } })
}
</script>
<script>
${clientSrc}
</script>
<script>
${mode === 'pat' ? `window.__WHALE_TEST__ = true` : ''}
${mode === 'notice' ? `window.__WHALE_TEST__ = true` : ''}
window.__petModule.apply({})
${mode === 'pat' ? `
setTimeout(function () { if (window.__whale) window.__whale.triggerPat() }, 200)` : ''}
${mode === 'notice' ? `
setTimeout(function () {
  if (window.__whale) window.__whale.showNotice({ id: 43, status: 'completed', kind: 'agent', title: '完成WHALE交接三任务', costCny: 1.98 })
}, 200)` : ''}
</script>
</body>
</html>
`

const out = mode === 'pat' ? 'render-harness-pat.html' : (mode === 'notice' ? 'render-harness-notice.html' : 'render-harness.html')
writeFileSync(join(root, 'test', out), html, 'utf8')
console.log('written test/' + out + ', skin3=' + skin3.length + ' skin4=' + skin4.length)

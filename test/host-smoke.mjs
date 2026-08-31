// host-smoke.mjs — 本地冒烟测试:用假 ctx 加载打包宿主,验证核心逻辑
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'

const dataDir = mkdtempSync(join(tmpdir(), 'whale-smoke-'))
const routes = []
let effectFn = null
let effectDispose = null

const fakeCtx = {
  webServer: {
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  },
  effect: (fn) => {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  on: () => () => {},
  get: (name) => undefined,
}

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
  if (!cond) failures++
}

apply(fakeCtx, { dataDir, usageDir: dataDir, autoLaunchDesktopPet: false, enabled: true })

check('routes registered', routes.length >= 8)
const paths = routes.map((r) => r.path)
check('state route', paths.includes('/api/dsh-whale-pet/state'))
check('speech-audio route', paths.includes('/api/dsh-whale-pet/speech-audio'))
check('asset route', paths.includes('/api/dsh-whale-pet/asset'))
check('notice-voices route', paths.includes('/api/dsh-whale-pet/notice-voices'))
check('topup-qr route', paths.includes('/api/dsh-whale-pet/topup-qr'))

// 模拟 HTTP handler 调用
function fakeReq(body) {
  const listeners = {}
  return {
    on: (ev, fn) => { listeners[ev] = fn },
    _emitData: () => { if (listeners.data) listeners.data(JSON.stringify(body || {})) },
    _emitEnd: () => { if (listeners.end) listeners.end() },
  }
}
function fakeRes() {
  const out = { statusCode: 0, body: '' }
  return Object.assign(out, {
    setHeader: () => {},
    end: (s) => { out.body = s },
  })
}
async function callRoute(path, body) {
  const r = routes.find((x) => x.path === path)
  const req = fakeReq(body)
  const res = fakeRes()
  const done = r.handler(req, res)
  req._emitData()
  req._emitEnd()
  await done
  return JSON.parse(res.body)
}

;(async () => {
  // 资产语音:摸头句(有 s/g)
  const audio = await callRoute('/api/dsh-whale-pet/speech-audio', { text: '被摸头了~有点害羞', instruct: '用非常小声的害羞语气轻声说', speed: 0.85, gain: 0.75 })
  check('asset speech-audio found', audio.ok === true && typeof audio.base64 === 'string' && audio.base64.length > 1000)
  // 无匹配台词 → 回退失败(无合成)
  const noAudio = await callRoute('/api/dsh-whale-pet/speech-audio', { text: '一句不存在的话', instruct: '' })
  check('unknown line falls back to no-synth', noAudio.ok !== true)
  // 皮肤资产
  const skin = await callRoute('/api/dsh-whale-pet/asset', { skin: 3 })
  check('skin 3 asset', skin.ok === true && skin.base64.length > 1000)
  const skin4 = await callRoute('/api/dsh-whale-pet/asset', { skin: 4 })
  check('skin 4 asset', skin4.ok === true && skin4.base64.length > 1000)
  // 通知语音
  const nv = await callRoute('/api/dsh-whale-pet/notice-voices', {})
  check('notice voices', nv.ok === true && nv.voices && nv.voices.completed && nv.voices.approval)
  // 台词事件 → 状态文件
  const sp = await callRoute('/api/dsh-whale-pet/speech', { text: '被摸头了~有点害羞', instruct: '用非常小声的害羞语气轻声说', speed: 0.85, gain: 0.75, ms: 5000 })
  check('speech event ok', sp.ok === true)
  const statePath = join(dataDir, 'whale-desktop-state.json')
  check('desktop state written', existsSync(statePath))
  if (existsSync(statePath)) {
    const st = JSON.parse(readFileSync(statePath, 'utf8'))
    check('state speech text', st.speech && st.speech.text === '被摸头了~有点害羞')
    check('state speech audioTick', st.speech && st.speech.audioTick >= 1)
  }
  const lastWav = join(dataDir, 'whale-speech-last.wav')
  check('last wav written', existsSync(lastWav) && readFileSync(lastWav).length > 1000)
  // 状态路由
  const st2 = await callRoute('/api/dsh-whale-pet/state', {})
  check('state route ok', st2.ok === true)
  // 木牌数据层:用法/月度/会话成本/差值字段必须在位
  check('state usage object', st2.usage && typeof st2.usage.calls === 'number' && typeof st2.usage.inputTokens === 'number')
  check('state monthlyUsage object', st2.monthlyUsage && typeof st2.monthlyUsage.costCny === 'number')
  check('state sessionCost null-when-no-session', 'sessionCost' in st2 && (st2.sessionCost === null || typeof st2.sessionCost.costCny === 'number'))
  check('state costDiff object', st2.costDiff && typeof st2.costDiff === 'object' && 'diff' in st2.costDiff)
  check('state busy boolean', typeof st2.busy === 'boolean')
  check('state settings object', st2.settings && typeof st2.settings.idleEnabled === 'boolean' && typeof st2.settings.petScale === 'number')
  // 设置路由:读写往返
  const set1 = await callRoute('/api/dsh-whale-pet/settings', { settings: { petScale: 0.9, idleFrequency: 'chatty' } })
  check('settings route save+read', set1.ok === true && set1.settings && set1.settings.petScale === 0.9 && set1.settings.idleFrequency === 'chatty')
  const st4 = await callRoute('/api/dsh-whale-pet/state', {})
  check('settings propagate to /state', st4.settings && st4.settings.petScale === 0.9 && st4.settings.voiceEnabled === true)
  check('state dnd boolean', typeof st4.dnd === 'boolean')
  // 免打扰设置往返 + 时间校验
  const set2 = await callRoute('/api/dsh-whale-pet/settings', { settings: { dndEnabled: true, dndStart: '22:30', dndEnd: '08:00' } })
  check('dnd settings save+read', set2.ok === true && set2.settings.dndEnabled === true && set2.settings.dndStart === '22:30' && set2.settings.dndEnd === '08:00')
  // 桌面宠状态文件包含成本行
  if (existsSync(statePath)) {
    const st3 = JSON.parse(readFileSync(statePath, 'utf8'))
    check('desktop costRows present', st3.costRows && typeof st3.costRows.session === 'string' && typeof st3.costRows.monthly === 'string' && typeof st3.costRows.diff === 'string')
    check('desktop cost labels present', st3.labels && typeof st3.labels.rowSession === 'string' && typeof st3.labels.rowMonthly === 'string' && typeof st3.labels.rowDiff === 'string')
  }

  console.log('---')
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES')
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.log('ERROR', e)
  process.exit(1)
})

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

apply(fakeCtx, { dataDir, autoLaunchDesktopPet: false, enabled: true })

check('routes registered', routes.length >= 7)
const paths = routes.map((r) => r.path)
check('state route', paths.includes('/api/dsh-whale-pet/state'))
check('speech-audio route', paths.includes('/api/dsh-whale-pet/speech-audio'))
check('asset route', paths.includes('/api/dsh-whale-pet/asset'))
check('notice-voices route', paths.includes('/api/dsh-whale-pet/notice-voices'))

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

  console.log('---')
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES')
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.log('ERROR', e)
  process.exit(1)
})

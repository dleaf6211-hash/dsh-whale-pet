// build-assets.mjs — 把已合成的语音/皮肤资产收集进仓库 assets/ 并生成清单
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = 'C:/Users/ABC/'
const OUT = join(__dirname, '..', 'assets')

function hash36(key) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = ((h * 31) + key.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// 与 client 源码保持一致的台词表
const IDLE_LINES = [
  { t: '今天也是元气满满的一天！', i: '用元气满满的欢快语气说' },
  { t: '余额我盯着呢，安心写代码~', i: '用温柔可靠的大姐姐语气说' },
  { t: '任务完成时记得夸夸我哦', i: '用俏皮撒娇、期待被表扬的语气说' },
  { t: '需要帮忙就戳戳我~', i: '用温柔贴心的语气说' },
  { t: '我在悄悄监督你…开玩笑啦！', i: '先用神秘的小声说，再俏皮地笑出来' },
  { t: '休息一下喝口水嘛', i: '用温柔关心的语气说' },
  { t: '敲累了就看看我充充电~', i: '用软萌安慰的语气说' },
  { t: '新任务交给我盯梢！', i: '用干劲十足、拍胸脯的语气说' },
  { t: '嘿嘿，我会一直陪着你', i: '用温柔坚定又带点害羞的语气说' },
  { t: '余额充足，请继续工作！', i: '用元气满满、精神抖擞的语气说' },
  { t: '要不要听我讲个冷笑话？还是算了…', i: '用俏皮的语气说，后半句小声放弃' },
  { t: '冲鸭！今天也要努力产出！', i: '用超级元气的呐喊语气说' },
  { t: '木牌归我，字归你，配合满分~', i: '用得意傲娇的语气说' },
  { t: '我刚刚数了数，你又变强了一点', i: '用小声欣慰的语气说' },
]
const PAT_LINES = [
  { t: '诶嘿嘿~摸头杀~', i: '用害羞又带点开心的语气说' },
  { t: '再摸一下也没关系啦', i: '用温柔撒娇的语气说' },
  { t: '被摸头了~有点害羞', i: '用非常小声的害羞语气轻声说', s: 0.85, g: 0.75 },
  { t: '才、才不是因为开心呢！', i: '用傲娇嘴硬的语气说' },
  { t: '嘿嘿~最喜欢被摸头~', i: '用开心幸福的语气说' },
]

function isLaugh(text) {
  const lm = text.match(/^[诶嘿哈嘻呵嗯啊哦哼~～，,]{2,}/)
  return lm !== null && lm[0].replace(/[~～，,]/g, '') !== '' && text.slice(lm[0].length).trim() !== ''
}
function speechKey(item) {
  let key = (isLaugh(item.t) ? 'laughv1|' : '') + item.t + '|' + item.i
  if (typeof item.s === 'number') key += '|s' + item.s
  if (typeof item.g === 'number') key += '|g' + item.g
  return key
}

mkdirSync(join(OUT, 'voices'), { recursive: true })
mkdirSync(join(OUT, 'skins'), { recursive: true })

const manifest = []
let ok = 0
let miss = 0
const all = [
  ...IDLE_LINES.map((x) => ({ ...x, kind: 'idle' })),
  ...PAT_LINES.map((x) => ({ ...x, kind: 'pat' })),
]
all.forEach((item, idx) => {
  const hash = hash36(speechKey(item))
  const src = SRC + '.whale-speech-' + hash + '.wav'
  const file = 'voices/line-' + String(idx).padStart(2, '0') + '.wav'
  if (existsSync(src)) {
    copyFileSync(src, join(OUT, file))
    ok++
  } else {
    miss++
    console.log('MISS ' + item.t)
  }
  manifest.push({ id: idx, kind: item.kind, text: item.t, instruct: item.i, speed: item.s, gain: item.g, file })
})

// 通知语音
const noticeStatuses = ['completed', 'failed', 'interrupted', 'needs_help', 'low_balance', 'approval']
for (const st of noticeStatuses) {
  for (let i = 0; i < 3; i++) {
    const src = SRC + `.whale-voice-${st}-${i}.wav`
    if (existsSync(src)) {
      copyFileSync(src, join(OUT, 'voices', `notice-${st}-${i}.wav`))
    }
  }
  const base = SRC + `.whale-voice-${st}.wav`
  if (existsSync(base)) {
    copyFileSync(base, join(OUT, 'voices', `notice-${st}.wav`))
  }
}

// 皮肤
for (const skin of [0, 3, 4]) {
  const src = SRC + `.whale-skin-${skin}.png`
  if (existsSync(src)) {
    copyFileSync(src, join(OUT, 'skins', `whale-skin-${skin}.png`))
    console.log('skin ' + skin + ' ok')
  } else {
    console.log('skin ' + skin + ' MISSING')
  }
}

writeFileSync(join(OUT, 'voices', 'manifest.json'), JSON.stringify({ lines: manifest, noticeStatuses }, null, 2), 'utf8')
console.log(`done: ${ok} lines copied, ${miss} missing`)

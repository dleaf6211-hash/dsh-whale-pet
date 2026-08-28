/**
 * dsh-whale-pet 宿主入口
 * 鲸鱼娘桌宠：浏览器悬浮桌宠 + Windows 桌面桌宠，余额/通知/台词朗读。
 * 打包形态：npm 包 + cordis.patch.yml；客户端通过 /api/dsh-whale-pet/* 路由通信。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import https from 'node:https'

export const name = 'dsh-whale-pet'
export const inject = ['webServer']

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = join(__dirname, '..', 'assets')
const VOICES_DIR = join(ASSETS_DIR, 'voices')
const SKINS_DIR = join(ASSETS_DIR, 'skins')

const DEFAULT_CONFIG = {
  enabled: true,
  dataDir: join(homedir(), '.whale-pet'),
  autoLaunchDesktopPet: true,
  announceToAgent: false,
}

function bytesToBase64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

let voiceManifest = null
function loadVoiceManifest() {
  if (voiceManifest !== null) return voiceManifest
  try {
    voiceManifest = JSON.parse(readFileSync(join(VOICES_DIR, 'manifest.json'), 'utf8'))
  } catch (e) {
    voiceManifest = { lines: [], noticeStatuses: [] }
  }
  return voiceManifest
}

function findLineVoice(text, instruct, speed, gain) {
  const m = loadVoiceManifest()
  const t = String(text || '').slice(0, 60)
  const ins = String(instruct || '')
  for (const line of m.lines) {
    if (line.text !== t || line.instruct !== ins) continue
    const sOk = (typeof line.speed === 'number') === (typeof speed === 'number') && (typeof speed !== 'number' || line.speed === speed)
    const gOk = (typeof line.gain === 'number') === (typeof gain === 'number') && (typeof gain !== 'number' || line.gain === gain)
    if (sOk && gOk) return line
  }
  return null
}

/**
 * 生成桌面宠 PowerShell 脚本(纯函数,便于测试)
 */
export function buildPetScript(statePath, cmdPath, skinPath, speechWav, noticeDir) {
  const st = String(statePath).replace(/\\/g, '\\\\')
  const cm = String(cmdPath).replace(/\\/g, '\\\\')
  const sk = String(skinPath).replace(/\\/g, '\\\\')
  const sw = String(speechWav).replace(/\\/g, '\\\\')
  const nd = String(noticeDir || '').replace(/\\/g, '\\\\')
  return `$ErrorActionPreference = 'SilentlyContinue'
$mutex = New-Object System.Threading.Mutex($false, "WhalePetMutex")
if (-not $mutex.WaitOne(0)) { exit }
Add-Type -AssemblyName PresentationFramework
$statePath = "${st}"
$cmdPath = "${cm}"
$speechWav = "${sw}"
$noticeDir = "${nd}"
$skin0 = "${sk}"
function Write-Cmd($action, $value) {
  try { $o = @{ action = $action }; if ($null -ne $value) { $o.value = $value }; $o | ConvertTo-Json -Compress | Out-File -FilePath $cmdPath -Encoding ascii } catch { }
}
$win = New-Object System.Windows.Window
$win.Width = 250
$win.Height = 340
$win.Topmost = $true
$win.AllowsTransparency = $true
$win.WindowStyle = 'None'
$win.Background = 'Transparent'
$win.ShowInTaskbar = $false
$card = New-Object System.Windows.Controls.Border
$card.Background = [System.Windows.Media.Brushes]::White
$card.BorderBrush = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#2E5CB8')))
$card.BorderThickness = New-Object System.Windows.Thickness(3)
$card.CornerRadius = New-Object System.Windows.CornerRadius(12)
$card.Margin = New-Object System.Windows.Thickness(10)
$card.Padding = New-Object System.Windows.Thickness(8)
$stack = New-Object System.Windows.Controls.StackPanel
$img = New-Object System.Windows.Controls.Image
$img.Height = 150
$img.Margin = New-Object System.Windows.Thickness(0, 10, 0, -6)
if (Test-Path $skin0) { $img.Source = New-Object System.Windows.Media.Imaging.BitmapImage([Uri]$skin0) }
$title = New-Object System.Windows.Controls.TextBlock
$title.FontSize = 13
$title.FontWeight = 'Bold'
$title.Foreground = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#2E5CB8')))
$title.HorizontalAlignment = 'Center'
$big = New-Object System.Windows.Controls.TextBlock
$big.FontSize = 20
$big.FontWeight = 'Bold'
$big.Foreground = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#17408F')))
$big.HorizontalAlignment = 'Center'
$rows = New-Object System.Windows.Controls.StackPanel
$btns = New-Object System.Windows.Controls.StackPanel
$btns.Orientation = 'Horizontal'
$btns.HorizontalAlignment = 'Center'
$btns.Margin = New-Object System.Windows.Thickness(0, 6, 0, 0)
function New-Btn($text, $handler) {
  $b = New-Object System.Windows.Controls.Button
  $b.Content = $text
  $b.FontSize = 11
  $b.Padding = New-Object System.Windows.Thickness(6, 3)
  $b.Margin = New-Object System.Windows.Thickness(3, 0, 3, 0)
  $b.Add_Click($handler)
  return $b
}
$view = 'balance'
$lastTick = 0
$lastNoticeId = -1
$script:voicePlayer = $null
function Set-View($v) { $script:view = $v }
function Update-UI {
  $s = $null
  if (Test-Path $statePath) {
    try { $s = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $s = $null }
  }
  if ($s -eq $null) { return }
  $title.Text = ''
  $big.Text = ''
  $big.FontSize = 20
  $big.TextWrapping = 'NoWrap'
  $rows.Children.Clear()
  $btns.Children.Clear()
  $noticeFresh = $false
  if ($s.notice -ne $null -and $s.notice.id -ne $null) {
    $nowMs2 = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    if ($s.notice.at -gt 0 -and ($nowMs2 - [long]$s.notice.at) -lt 12000) { $noticeFresh = $true }
  }
  $spk = $false
  if (-not $noticeFresh -and $s.speech -ne $null -and [string]$s.speech.text -ne '' -and $s.speech.expireAt -gt 0) {
    $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    if ($nowMs -lt [long]$s.speech.expireAt) { $spk = $true }
  }
  if ($noticeFresh) {
    $nt = 'Notice'
    if ($s.labels.noticeTitle -ne $null) {
      try { $nt = [string]$s.labels.noticeTitle.([string]$s.notice.status) } catch { }
    }
    $title.Text = $nt
    $big.FontSize = 14
    $big.TextWrapping = 'Wrap'
    $big.Width = 196
    $big.Text = [string]$s.notice.title
    if ([long]$s.notice.id -ne $lastNoticeId) {
      $lastNoticeId = [long]$s.notice.id
      if ($s.voiceEngine -eq 'pet' -and $noticeDir -ne '') {
        $vp = Join-Path $noticeDir ('notice-' + [string]$s.notice.status + '.wav')
        if (Test-Path $vp) {
          $sp2 = New-Object System.Media.SoundPlayer($vp)
          $sp2.Play()
          $script:voicePlayer = $sp2
        }
      }
    }
  } elseif ($spk) {
    $title.Text = [string]$s.labels.speechTitle
    $big.FontSize = 13
    $big.TextWrapping = 'Wrap'
    $big.Width = 196
    $big.Text = [string]$s.speech.text
    if ($s.speech.audioTick -gt 0 -and [long]$s.speech.audioTick -ne $lastTick) {
      if (Test-Path $speechWav) {
        $lastTick = [long]$s.speech.audioTick
        if ($s.voiceEngine -eq 'pet') {
          $sp2 = New-Object System.Media.SoundPlayer($speechWav)
          $sp2.Play()
          $script:voicePlayer = $sp2
        }
      }
    }
  } else {
    $title.Text = [string]$s.labels.titleBalance
    $big.Text = [string]$s.balanceText
    if ($s.balanceFetchedAt -ne $null -and [string]$s.balanceFetchedAt -ne '') {
      $rt = New-Object System.Windows.Controls.TextBlock
      $rt.Text = [string]$s.labels.refreshedAt + ' ' + [string]$s.balanceFetchedAt
      $rt.FontSize = 9
      $rt.Foreground = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#9AA7BD')))
      [void]$rows.Children.Add($rt)
    }
  }
  [void]$btns.Children.Add((New-Btn '刷新' { Write-Cmd 'refresh' }))
  [void]$btns.Children.Add((New-Btn 'X' { $win.Close() }))
}
Update-UI
$uiTimer = New-Object Windows.Threading.DispatcherTimer
$uiTimer.Interval = [TimeSpan]::FromSeconds(2)
$uiTimer.Add_Tick({ Update-UI })
$uiTimer.Start()
$win.Add_MouseLeftButtonDown({ $win.DragMove() })
$win.Add_Closed({
  $uiTimer.Stop()
  $mutex.ReleaseMutex()
})
$win.Content = $card
$card.Child = $stack
[void]$stack.Children.Add($img)
[void]$stack.Children.Add($title)
[void]$stack.Children.Add($big)
[void]$stack.Children.Add($rows)
[void]$stack.Children.Add($btns)
$win.ShowDialog() | Out-Null
`
}

export function apply(ctx, config) {
  const conf = Object.assign({}, DEFAULT_CONFIG, config || {})
  if (conf.enabled === false) return

  const DATA_DIR = conf.dataDir
  const STATE_PATH = join(DATA_DIR, 'whale-desktop-state.json')
  const CMD_PATH = join(DATA_DIR, 'whale-pet-cmd.json')
  const RUN_DIR = join(DATA_DIR, 'run')

  const state = {
    balance: null,
    balanceError: null,
    balanceFetchedAt: null,
    speechText: null,
    speechExpireAt: 0,
    speechAudioTick: 0,
    petAlive: false,
    desktopSkin: 0,
    desktopGhost: false,
    lowBalance: { active: false, version: 0, amount: 0, armed: true },
    taskDone: null,
    taskQueue: [],
    taskDoneId: 0,
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  }

  const log = (msg) => {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      let prev = ''
      try { prev = readFileSync(join(DATA_DIR, 'whale.log'), 'utf8') } catch (e) { /* ignore */ }
      writeFileSync(join(DATA_DIR, 'whale.log'), prev + String(msg) + '\n', 'utf8')
    } catch (e) { /* ignore */ }
  }

  function run(cmd, args, opts) {
    return new Promise((resolve) => {
      try {
        const child = spawn(cmd, args, Object.assign({ stdio: 'ignore', windowsHide: true }, opts || {}))
        const timer = setTimeout(() => { try { child.kill() } catch (e) { /* ignore */ } }, (opts && opts.timeoutMs) || 120000)
        child.on('exit', () => { clearTimeout(timer); resolve() })
        child.on('error', () => { clearTimeout(timer); resolve() })
      } catch (e) { resolve() }
    })
  }

  // ---------- 路由 ----------
  const writeJson = (res, status, body) => {
    try {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
    } catch (e) { /* ignore */ }
  }

  function readJsonBody(req) {
    return new Promise((resolve) => {
      let d = ''
      req.on('data', (c) => { d += c })
      req.on('end', () => {
        try { resolve(d ? JSON.parse(d) : {}) } catch (e) { resolve({}) }
      })
    })
  }

  function route(path, handler) {
    return {
      path,
      handler: async (req, res) => {
        try { await handler(req, res) } catch (e) { writeJson(res, 200, { ok: false, error: String(e && e.message ? e.message : e) }) }
      },
    }
  }

  async function writeDesktopState() {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      const b = state.balance
      const row0 = b && b.ok === true && Array.isArray(b.rows) && b.rows.length > 0 ? b.rows[0] : null
      const json = {
        balanceTotal: row0 !== null ? row0.total : null,
        balanceText: row0 !== null ? '¥' + Number(row0.total).toFixed(2) : '',
        balanceFetchedAt: state.balanceFetchedAt || '',
        noticeText: '',
        lowBalanceActive: state.lowBalance.active === true,
        skin: state.desktopSkin,
        ghost: state.desktopGhost,
        speech: { text: state.speechText || '', expireAt: state.speechExpireAt, audioTick: state.speechAudioTick },
        tokens: { input: String(state.usage.inputTokens), output: String(state.usage.outputTokens), cacheRead: String(state.usage.cacheReadTokens), calls: String(state.usage.calls) },
        voiceEngine: state.petAlive ? 'pet' : 'browser',
        notice: state.taskDone,
        labels: {
          titleBalance: '🐳 余额', titleUsage: '🐳 Tokens', speechTitle: '💬 鲸鱼娘说',
          btnUsage: '看用量', btnBalance: '看余额', btnRefresh: '刷新', btnGhost: '透明', btnClose: 'X', btnGotIt: '知道了',
          rowCalls: '模型调用', rowIn: '输入 tokens', rowOut: '输出 tokens', rowCache: '缓存读取',
          refreshedAt: '刷新于',
          noticeTitle: { completed: '✅ 任务完成', failed: '❌ 任务失败', interrupted: '⏸ 任务中断', needs_help: '🙋 需要协助', approval: '⏳ 等待审批' },
        },
      }
      writeFileSync(STATE_PATH, JSON.stringify(json, null, 2), 'utf8')
    } catch (e) { log('writeDesktopState FAIL ' + e.message) }
  }

  async function speechAudio(text, instruct, speed, gain) {
    const line = findLineVoice(text, instruct, speed, gain)
    if (line !== null) {
      const wavPath = join(ASSETS_DIR, line.file)
      if (existsSync(wavPath)) {
        const bytes = readFileSync(wavPath)
        return { ok: true, base64: bytesToBase64(bytes), source: 'asset' }
      }
    }
    return { ok: false, error: 'no-synth' }
  }

  let speechChain = Promise.resolve()
  async function doWhaleSpeech(args) {
    const a = (args && typeof args === 'object') ? args : {}
    if (typeof a.text === 'string' && a.text !== '') {
      state.speechText = String(a.text).slice(0, 60)
      const ms = typeof a.ms === 'number' && a.ms > 500 && a.ms <= 30000 ? a.ms : 5000
      state.speechExpireAt = Date.now() + ms
      const r = await speechAudio(a.text, a.instruct, a.speed, a.gain)
      if (r && r.ok === true && r.base64) {
        try {
          mkdirSync(DATA_DIR, { recursive: true })
          writeFileSync(join(DATA_DIR, 'whale-speech-last.wav'), Buffer.from(r.base64, 'base64'))
        } catch (e) { /* ignore */ }
      }
      state.speechAudioTick += 1
      await writeDesktopState()
    }
    return { ok: true }
  }

  async function fetchBalance() {
    try {
      const credPath = join(homedir(), '.dsh', '.credentials.yaml')
      if (!existsSync(credPath)) return { ok: false, error: 'no-credentials' }
      const raw = readFileSync(credPath, 'utf8')
      const m = raw.match(/sk-[A-Za-z0-9]{20,}/)
      if (m === null) return { ok: false, error: 'no-key' }
      const key = m[0]
      const body = await new Promise((resolve) => {
        const req = https.get({
          host: 'api.deepseek.com', path: '/user/balance',
          headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'whale-pet/1' },
          timeout: 15000,
        }, (res) => {
          let d = ''
          res.on('data', (c) => { d += c })
          res.on('end', () => resolve({ status: res.statusCode, body: d }))
        })
        req.on('error', () => resolve({ status: 0, body: '' }))
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }) })
      })
      if (body.status !== 200) return { ok: false, error: 'http ' + body.status }
      const j = JSON.parse(body.body)
      if (j && j.error) return { ok: false, error: 'api-error' }
      const infos = (j && j.balance_infos) || []
      const rows = infos.map((i) => ({ currency: i.currency || '', total: i.total_balance }))
      const result = { ok: true, rows, isAvailable: j.is_available }
      state.balance = result
      state.balanceFetchedAt = new Date().toTimeString().slice(0, 8)
      await writeDesktopState()
      return result
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) }
    }
  }

  const routes = [
    route('/api/dsh-whale-pet/state', async (req, res) => {
      writeJson(res, 200, {
        ok: true,
        balance: state.balance,
        balanceError: state.balanceError,
        taskDone: state.taskDone,
        taskQueue: state.taskQueue,
        usage: state.usage,
        lowBalance: { active: state.lowBalance.active, version: state.lowBalance.version, amount: state.lowBalance.amount },
        voiceEngine: state.petAlive ? 'pet' : 'browser',
        busy: false,
      })
    }),
    route('/api/dsh-whale-pet/refresh-balance', async (req, res) => {
      writeJson(res, 200, await fetchBalance())
    }),
    route('/api/dsh-whale-pet/speech', async (req, res) => {
      const args = await readJsonBody(req)
      const run2 = speechChain.then(() => doWhaleSpeech(args))
      speechChain = run2.catch(() => ({ ok: true }))
      writeJson(res, 200, await run2)
    }),
    route('/api/dsh-whale-pet/speech-audio', async (req, res) => {
      const a = await readJsonBody(req)
      if (typeof a.text !== 'string' || a.text === '') { writeJson(res, 200, { ok: false, error: 'empty' }); return }
      writeJson(res, 200, await speechAudio(a.text, a.instruct, a.speed, a.gain))
    }),
    route('/api/dsh-whale-pet/asset', async (req, res) => {
      const a = await readJsonBody(req)
      const idx = typeof a.skin === 'number' ? a.skin : 0
      const p = join(SKINS_DIR, 'whale-skin-' + idx + '.png')
      if (existsSync(p)) {
        const bytes = readFileSync(p)
        writeJson(res, 200, { ok: true, skin: idx, base64: bytesToBase64(bytes), mime: 'image/png', size: bytes.length })
      } else {
        writeJson(res, 200, { ok: false, skin: idx })
      }
    }),
    route('/api/dsh-whale-pet/notice-voices', async (req, res) => {
      const m = loadVoiceManifest()
      const out = {}
      for (const st of m.noticeStatuses) {
        const p = join(VOICES_DIR, 'notice-' + st + '.wav')
        if (existsSync(p)) {
          try { out[st] = { base64: bytesToBase64(readFileSync(p)) } } catch (e) { /* ignore */ }
        }
      }
      writeJson(res, 200, { ok: true, voices: out })
    }),
    route('/api/dsh-whale-pet/desktop-toggle', async (req, res) => {
      if (state.petAlive) {
        await killDesktopPet()
      } else {
        await launchDesktopPet()
      }
      writeJson(res, 200, { ok: true, alive: state.petAlive })
    }),
  ]

  ctx.effect(() => {
    const disposers = routes.map((r) => ctx.webServer.register(r))
    return () => { for (const d of disposers) d() }
  })

  async function launchDesktopPet() {
    try {
      mkdirSync(RUN_DIR, { recursive: true })
      const scriptPath = join(RUN_DIR, 'whale-pet.ps1')
      writeFileSync(scriptPath, buildPetScript(STATE_PATH, CMD_PATH, join(SKINS_DIR, 'whale-skin-0.png'), join(DATA_DIR, 'whale-speech-last.wav')), 'utf8')
      await writeDesktopState()
      spawn('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], { stdio: 'ignore', windowsHide: true })
      state.petAlive = true
      log('pet launched')
    } catch (e) {
      log('pet launch FAIL ' + e.message)
    }
  }

  async function killDesktopPet() {
    try {
      await run('C:\\WINDOWS\\system32\\cmd.exe', ['/c', 'taskkill /f /im powershell.exe /fi "WINDOWTITLE eq *whale*"'], { timeoutMs: 15000 })
      state.petAlive = false
    } catch (e) { /* ignore */ }
  }

  // ---------- 任务通知 ----------
  function pushNotice(item) {
    state.taskDone = item
    state.taskQueue.push(item)
    if (state.taskQueue.length > 6) state.taskQueue.shift()
    writeDesktopState().catch(() => {})
  }

  let lastAgentBusy = false
  ctx.on('agent/status', (payload) => {
    try {
      if (!payload || !payload.agent) return
      if (payload.status !== 'idle') { lastAgentBusy = true; return }
      if (!lastAgentBusy) return
      lastAgentBusy = false
      pushNotice({ id: ++state.taskDoneId, status: 'completed', kind: 'agent', title: '会话任务完成', costCny: 0, at: Date.now() })
    } catch (e) { /* ignore */ }
  })
  ctx.on('agent/error', (payload) => {
    try {
      if (!payload || !payload.agent) return
      const m = payload.error && payload.error.message ? String(payload.error.message).slice(0, 20) : '会话任务失败'
      pushNotice({ id: ++state.taskDoneId, status: 'failed', kind: 'agent', title: m, costCny: 0, at: Date.now() })
    } catch (e) { /* ignore */ }
  })
  ctx.on('approval/request', (req, next) => {
    try {
      pushNotice({ id: ++state.taskDoneId, status: 'approval', kind: 'task', title: '等待审批', costCny: 0, at: Date.now() })
    } catch (e) { /* ignore */ }
    return next()
  })

  // ---------- 生命周期 ----------
  const disposers = []
  ctx.effect(() => {
    const cmdTimer = setInterval(async () => {
      try {
        if (!existsSync(CMD_PATH)) return
        const text = readFileSync(CMD_PATH, 'utf8').trim()
        if (text === '' || text === '{}') return
        const cmd = JSON.parse(text)
        if (cmd && cmd.action === 'refresh') { fetchBalance().catch(() => {}) }
        writeFileSync(CMD_PATH, '{}', 'utf8')
      } catch (e) { /* ignore */ }
    }, 3000)
    disposers.push(() => clearInterval(cmdTimer))

    const balTimer = setInterval(() => { fetchBalance().catch(() => {}) }, 5 * 60 * 1000)
    disposers.push(() => clearInterval(balTimer))

    let petTimer = null
    if (conf.autoLaunchDesktopPet === true) {
      petTimer = setTimeout(() => { launchDesktopPet().catch(() => {}) }, 3000)
      disposers.push(() => clearTimeout(petTimer))
    }

    return () => {
      for (const d of disposers.splice(0)) { try { d() } catch (e) { /* ignore */ } }
      killDesktopPet().catch(() => {})
    }
  })

  fetchBalance().catch(() => {})
  log('dsh-whale-pet applied, dataDir=' + DATA_DIR)
}

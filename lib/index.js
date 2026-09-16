/**
 * dsh-whale-pet 宿主入口
 * 鲸鱼娘桌宠：浏览器悬浮桌宠 + Windows 桌面桌宠，余额/通知/台词朗读。
 * 打包形态：npm 包 + cordis.patch.yml；客户端通过 /api/dsh-whale-pet/* 路由通信。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import https from 'node:https'
import { petViewParts } from './pet-views.js'

export const name = 'dsh-whale-pet-plugin'
export const inject = ['webServer']

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = join(__dirname, '..', 'assets')
const VOICES_DIR = join(ASSETS_DIR, 'voices')
const SKINS_DIR = join(ASSETS_DIR, 'skins')

// 成本估算价格表(元/百万 tokens,区分峰谷)
const PRICE = {
  offpeak: { input: 4.5, output: 13.5, cacheHit: 0.15 },
  peak: { input: 9.0, output: 27.0, cacheHit: 0.3 },
}
// ⚠️ 09-14 待校准:以上单价为自定表,需与平台实际计费对照(窝 4b)。
// 口径参考:flash 系 = 未命中输入 1 / 输出 4 / 缓存命中 0.02,高峰 ×2;
// pro 计费不变(9/10 通知)。校准数据由主人控制台账单提供。

const DEFAULT_CONFIG = {
  enabled: true,
  dataDir: join(homedir(), '.whale-pet'),
  usageDir: homedir(),
  autoLaunchDesktopPet: true,
  announceToAgent: false,
}

// 运行时设置(设置面板可改,存 whale-settings.json)
const DEFAULT_SETTINGS = {
  idleEnabled: true,      // 随机台词开关
  idleFrequency: 'normal', // quiet | normal | chatty(间隔 ×2 / ×1 / ×0.5)
  voiceEnabled: true,     // 语音开关(浏览器+桌面宠)
  petScale: 0.75,         // 浏览器宠大小
  autoLaunchPet: false,   // 自动拉起桌面宠(默认关:需靠浏览器木牌「拉起桌宠」)
  lowBalanceAlert: true,  // 低余额提醒
  lowBalanceThreshold: 5, // 低余额阈值(元),验收时可通过 settings 接口临时调大
  dndEnabled: false,      // 免打扰时段开关
  dndStart: '22:00',      // 免打扰开始
  dndEnd: '09:00',        // 免打扰结束
}
// 免打扰时段内仍保留提醒的状态白名单
const DND_WHITELIST = ['approval', 'needs_help']

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
    if (line.text !== t) continue
    // 0.1.5 修复:announce 路径不带 instruct 时按文本通配——音频按行固定,语气不参与选音频
    if (ins !== '' && line.instruct !== ins) continue
    // speed/gain 只在调用方显式提供时才参与匹配(未提供 = 通配;资产音频按行固定)
    if (typeof speed === 'number' && line.speed !== speed) continue
    if (typeof gain === 'number' && line.gain !== gain) continue
    return line
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
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class W { [StructLayout(LayoutKind.Sequential)] public struct PT { public int X; public int Y; } [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i); [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v); [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p); }'
$statePath = "${st}"
$cmdPath = "${cm}"
$speechWav = "${sw}"
$noticeDir = "${nd}"
$skin0 = "${sk}"
$hbPath = Join-Path (Split-Path $cmdPath -Parent) 'whale-pet-heartbeat.txt'
function Write-Hb {
  try { [DateTimeOffset]::Now.ToUnixTimeMilliseconds() | Out-File -FilePath $hbPath -Encoding ascii } catch { }
}
function Write-Cmd($action, $value) {
  try { $o = @{ action = $action }; if ($null -ne $value) { $o.value = $value }; $o | ConvertTo-Json -Compress | Out-File -FilePath $cmdPath -Encoding ascii } catch { }
}
$win = New-Object System.Windows.Window
$win.Width = 250
$win.Height = 340
$win.Title = 'WhalePet'
$win.Topmost = $true
$win.AllowsTransparency = $true
$win.WindowStyle = 'None'
$win.Background = 'Transparent'
$win.ShowInTaskbar = $false
$win.WindowStartupLocation = 'Manual'
$wa = [System.Windows.SystemParameters]::WorkArea
$win.Left = $wa.Right - 280
$win.Top = $wa.Top + 40
$card = New-Object System.Windows.Controls.Border
$card.Background = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#F2FFFEF8')))
$card.BorderBrush = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#2E5CB8')))
$card.BorderThickness = New-Object System.Windows.Thickness(2)
$card.CornerRadius = New-Object System.Windows.CornerRadius(12)
$card.Margin = New-Object System.Windows.Thickness(2)
$stack = New-Object System.Windows.Controls.StackPanel
$stack.Margin = New-Object System.Windows.Thickness(9)
$img = New-Object System.Windows.Controls.Image
$img.Height = 150
$img.Stretch = 'Uniform'
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
$big.Margin = New-Object System.Windows.Thickness(0, 2, 0, 2)
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
  $b.MinWidth = 26
  $b.Margin = New-Object System.Windows.Thickness(3, 0, 3, 0)
  $b.Add_Click($handler)
  return $b
}
function New-Row($k, $v) {
  $p = New-Object System.Windows.Controls.StackPanel
  $p.Orientation = 'Horizontal'
  $p.Margin = New-Object System.Windows.Thickness(0, 1, 0, 1)
  $kt = New-Object System.Windows.Controls.TextBlock
  $kt.Text = [string]$k
  $kt.FontSize = 10.5
  $kt.Width = 66
  $kt.TextAlignment = 'Left'
  $kt.Foreground = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#5B7395')))
  $vt = New-Object System.Windows.Controls.TextBlock
  $vt.Text = [string]$v
  $vt.FontSize = 10.5
  $vt.FontWeight = 'Bold'
  $vt.Width = 122
  $vt.TextAlignment = 'Right'
  $vt.TextTrimming = 'CharacterEllipsis'
  $vt.Foreground = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#1F3A66')))
  [void]$p.Children.Add($kt)
  [void]$p.Children.Add($vt)
  return $p
}
$view = 'balance'
$script:lastTick = 0
$script:lastNoticeId = -1
$script:voicePlayer = $null
$script:noticeDismissed = -1
$script:speechSuppressTick = -1
$script:hwnd = $null
$script:ghost = $false
$script:clickThroughOff = $false
$script:dragging = $false
$script:dragPending = $false
$script:dragDx = 0
$script:dragDy = 0
${petViewParts().helpers}${petViewParts().stateInit}function Set-View($v) { $script:view = $v }
function Set-ClickThrough($on) {
  if ($script:hwnd -eq $null) { return }
  $ex = [W]::GetWindowLong($script:hwnd, -20)
  if ($on) { $ex = $ex -bor 0x20 } else { $ex = $ex -band (-bnot 0x20) }
  [void][W]::SetWindowLong($script:hwnd, -20, $ex)
}
function Update-GhostState {
  $win.Opacity = if ($script:ghost) { 0.45 } else { 1.0 }
  foreach ($b in $btns.Children) { if ($b -is [System.Windows.Controls.Button]) { $b.IsEnabled = -not $script:ghost } }
  Set-ClickThrough ($script:ghost -and -not $script:clickThroughOff)
}
function Toggle-Ghost {
  $script:ghost = -not $script:ghost
  if ($script:ghost) { $script:clickThroughOff = $false }
  Update-GhostState
}
function Update-EyeHover {
  if (-not $script:ghost) { return }
  $pt = New-Object W+PT
  [void][W]::GetCursorPos([ref]$pt)
  $origin = New-Object System.Windows.Point(0, 0)
  $r = $eye.PointToScreen($origin)
  $inside = ($pt.X -ge ($r.X - 6) -and $pt.X -le ($r.X + $eye.ActualWidth + 6) -and $pt.Y -ge ($r.Y - 6) -and $pt.Y -le ($r.Y + $eye.ActualHeight + 6))
  if ($inside -ne $script:clickThroughOff) { $script:clickThroughOff = $inside; Set-ClickThrough (-not $inside) }
}
function Start-Drag {
  if ($script:ghost) { return }
  # 手动拖拽代替 DragMove:透明分层窗口用 DragMove 拖动会留下残影(旧帧不重绘),
  # 这里自己用光标屏幕坐标 + DPI 换算更新 Left/Top,每次移动都强制重绘。
  # 按下只标记 pending,真正移动才捕获鼠标——保证按钮的普通点击不受影响。
  $script:dragPending = $true
  $pt = New-Object W+PT
  [void][W]::GetCursorPos([ref]$pt)
  try {
    $src = [System.Windows.PresentationSource]::FromVisual($win)
    if ($src -ne $null) {
      $m = $src.CompositionTarget.TransformFromDevice
      $cur = $m.Transform((New-Object System.Windows.Point([double]$pt.X, [double]$pt.Y)))
      $script:dragDx = $cur.X - $win.Left
      $script:dragDy = $cur.Y - $win.Top
    } else {
      $script:dragDx = [double]$pt.X - $win.Left
      $script:dragDy = [double]$pt.Y - $win.Top
    }
  } catch {
    $script:dragDx = [double]$pt.X - $win.Left
    $script:dragDy = [double]$pt.Y - $win.Top
  }
}
function Do-Drag {
  if (-not $script:dragPending -and -not $script:dragging) { return }
  if (-not $script:dragging) {
    $script:dragging = $true
    $script:dragPending = $false
    $win.CaptureMouse() | Out-Null
  }
  $pt = New-Object W+PT
  [void][W]::GetCursorPos([ref]$pt)
  try {
    $src = [System.Windows.PresentationSource]::FromVisual($win)
    if ($src -ne $null) {
      $m = $src.CompositionTarget.TransformFromDevice
      $cur = $m.Transform((New-Object System.Windows.Point([double]$pt.X, [double]$pt.Y)))
      $win.Left = $cur.X - $script:dragDx
      $win.Top = $cur.Y - $script:dragDy
    } else {
      $win.Left = [double]$pt.X - $script:dragDx
      $win.Top = [double]$pt.Y - $script:dragDy
    }
  } catch { }
}
function End-Drag {
  if (-not $script:dragging -and -not $script:dragPending) { return }
  $script:dragging = $false
  $script:dragPending = $false
  try { $win.ReleaseMouseCapture() } catch { }
  try { $win.InvalidateVisual() } catch { } // 清掉拖动残留帧
}
function Update-UI {
  Write-Hb
  $s = $null
  if (Test-Path $statePath) {
    try { $s = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $s = $null }
  }
  if ($s -eq $null) { return }
  $title.Text = ''
  $big.Text = ''
  $big.FontSize = 20
  $big.TextWrapping = 'NoWrap'
  $big.Width = [double]::NaN
  $big.TextAlignment = 'Center'
  $rows.Children.Clear()
  $btns.Children.Clear()
${petViewParts().resolve}${petViewParts().views}${petViewParts().buttons}  if ($script:ghost) {
    foreach ($b in $btns.Children) { if ($b -is [System.Windows.Controls.Button]) { $b.IsEnabled = $false } }
  }
}
Update-UI
$uiTimer = New-Object Windows.Threading.DispatcherTimer
$uiTimer.Interval = [TimeSpan]::FromSeconds(2)
$uiTimer.Add_Tick({ Update-UI })
$uiTimer.Start()
$hoverTimer = New-Object Windows.Threading.DispatcherTimer
$hoverTimer.Interval = [TimeSpan]::FromMilliseconds(150)
$hoverTimer.Add_Tick({ Update-EyeHover })
$hoverTimer.Start()
$win.Add_MouseLeftButtonDown({ Start-Drag })
$win.Add_MouseMove({ Do-Drag })
$win.Add_MouseLeftButtonUp({ End-Drag })
$win.Add_Loaded({ $script:hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle; Update-GhostState })
$win.Add_Closed({
  $uiTimer.Stop()
  $hoverTimer.Stop()
  Set-ClickThrough $false
  $mutex.ReleaseMutex()
})
$root = New-Object System.Windows.Controls.Grid
$win.Content = $root
$outer = New-Object System.Windows.Controls.StackPanel
$outer.VerticalAlignment = 'Top'
[void]$outer.Children.Add($img)
$card.Child = $stack
[void]$outer.Children.Add($card)
[void]$stack.Children.Add($title)
[void]$stack.Children.Add($big)
[void]$stack.Children.Add($rows)
[void]$stack.Children.Add($btns)
[void]$root.Children.Add($outer)
$eye = New-Object System.Windows.Controls.Button
$eye.Width = 20
$eye.Height = 20
$eye.Padding = New-Object System.Windows.Thickness(0)
$eye.HorizontalAlignment = 'Right'
$eye.VerticalAlignment = 'Top'
$eye.Margin = New-Object System.Windows.Thickness(0, 100, 8, 0)
$eye.Background = [System.Windows.Media.Brushes]::White
$eye.BorderBrush = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#9DB8E8')))
$eye.BorderThickness = New-Object System.Windows.Thickness(1)
$eye.Cursor = 'Hand'
$eye.ToolTip = 'Ghost mode'
$eyeGrid = New-Object System.Windows.Controls.Grid
$e1 = New-Object System.Windows.Shapes.Ellipse
$e1.Width = 11
$e1.Height = 11
$e1.Stroke = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#2E5CB8')))
$e1.StrokeThickness = 1.4
$e2 = New-Object System.Windows.Shapes.Ellipse
$e2.Width = 4
$e2.Height = 4
$e2.Fill = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#2E5CB8')))
[void]$eyeGrid.Children.Add($e1)
[void]$eyeGrid.Children.Add($e2)
$eye.Content = $eyeGrid
$eye.Add_Click({ Toggle-Ghost })
[void]$root.Children.Add($eye)
$win.ShowDialog() | Out-Null
`
}

export function apply(ctx, config) {
  const conf = Object.assign({}, DEFAULT_CONFIG, config || {})
  if (conf.enabled === false) return

  const DATA_DIR = conf.dataDir
  const USAGE_DIR = conf.usageDir
  const STATE_PATH = join(DATA_DIR, 'whale-desktop-state.json')
  const CMD_PATH = join(DATA_DIR, 'whale-pet-cmd.json')
  const RUN_DIR = join(DATA_DIR, 'run')
  const USAGE_FILE = join(USAGE_DIR, '.whale-usage.json')
  const MONTHLY_FILE = join(USAGE_DIR, '.whale-monthly.json')
  const SESSION_COST_FILE = join(USAGE_DIR, '.whale-session-cost.json')
  const BALANCE_START_FILE = join(USAGE_DIR, '.whale-balance-start.json')
  const REAL_MONTHLY_FILE = join(USAGE_DIR, '.whale-real-monthly.json')
  const SETTINGS_FILE = join(DATA_DIR, 'whale-settings.json')

  const state = {
    settings: Object.assign({}, DEFAULT_SETTINGS),    balance: null,
    balanceError: null,
    balanceFetchedAt: null,
    speechText: null,
    speechExpireAt: 0,
    speechAudioTick: 0,
    speechFile: '',
    petAlive: false,
    desktopSkin: 0,
    desktopGhost: false,
    lowBalance: { active: false, version: 0, amount: 0, armed: true },
    taskDone: null,
    taskQueue: [],
    taskDoneId: 0,
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastModel: '' },
    monthlyUsage: { month: '', calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costCny: 0 },
    sessionCosts: new Map(),
    mainSessionId: '',
    balanceStart: null,
    balanceStartSessionCost: 0,
    realMonthlyCost: null,
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

  // ---------- 用量/成本数据层 ----------
  function pickFirst(obj, names) {
    if (!obj || typeof obj !== 'object') return undefined
    for (const n of names) {
      const v = obj[n]
      if (v !== undefined && v !== null && v !== '') return v
    }
    return undefined
  }

  function sessionIdOf(obj) {
    if (!obj || typeof obj !== 'object') return null
    const direct = pickFirst(obj, ['id', 'sessionId', 'key', 'childSessionId', 'ownerSession', 'parentSession', 'agentId'])
    if (typeof direct === 'string' && direct) return direct
    const header = obj.header
    if (header && typeof header === 'object' && typeof header.id === 'string' && header.id) return header.id
    const agent = obj.agent
    if (agent && typeof agent === 'object') {
      const aid = pickFirst(agent, ['id', 'sessionId', 'key'])
      if (typeof aid === 'string' && aid) return aid
      const s2 = agent.session
      if (s2 && typeof s2 === 'object') {
        const sh = s2.header
        if (sh && typeof sh === 'object' && typeof sh.id === 'string') return sh.id
        const sid = pickFirst(s2, ['id', 'sessionId', 'key'])
        if (typeof sid === 'string' && sid) return sid
      }
    }
    return null
  }

  function currentPrice() {
    const h = new Date().getHours()
    if ((h >= 9 && h < 12) || (h >= 14 && h < 18)) return PRICE.peak
    return PRICE.offpeak
  }

  function costOf(input, output, cacheRead, cacheWrite) {
    const price = currentPrice()
    const cr = typeof cacheRead === 'number' && isFinite(cacheRead) ? cacheRead : 0
    const cw = typeof cacheWrite === 'number' && isFinite(cacheWrite) ? cacheWrite : 0
    // 计费输入 = 未命中输入 + 缓存写 + 缓存读(DSH 权威口径:三者不相交;cacheWrite 按普通输入价)
    return Math.round(((input / 1000000) * price.input + (cw / 1000000) * price.input + (output / 1000000) * price.output + (cr / 1000000) * price.cacheHit) * 100000) / 100000
  }

  function extractUsage(chunk) {
    if (!chunk || typeof chunk !== 'object') return null
    let cand = chunk
    const direct = pickFirst(chunk, ['usage', 'usageInfo', 'tokenUsage'])
    if (direct && typeof direct === 'object') cand = direct
    const input = pickFirst(cand, ['inputTokens', 'promptTokens', 'prompt_tokens', 'input_tokens', 'inputTokenCount'])
    const output = pickFirst(cand, ['outputTokens', 'completionTokens', 'completion_tokens', 'output_tokens', 'outputTokenCount'])
    const total = pickFirst(cand, ['totalTokens', 'total_tokens', 'totalTokenCount', 'total'])
    const ni = typeof input === 'number' && isFinite(input) ? input : null
    const no = typeof output === 'number' && isFinite(output) ? output : null
    const nt = typeof total === 'number' && isFinite(total) ? total : null
    const cacheRead = pickFirst(cand, ['cacheReadTokens', 'promptCacheHitTokens', 'prompt_cache_hit_tokens', 'cachedTokens', 'cacheHitTokens'])
    const ncr = typeof cacheRead === 'number' && isFinite(cacheRead) ? cacheRead : 0
    const cacheWrite = pickFirst(cand, ['cacheWriteTokens', 'promptCacheMissTokens', 'prompt_cache_miss_tokens'])
    const ncw = typeof cacheWrite === 'number' && isFinite(cacheWrite) ? cacheWrite : 0
    if (ni === null && no === null && nt === null) return null
    const inp = ni !== null ? ni : (nt !== null && no !== null ? nt - no : 0)
    const outp = no !== null ? no : (nt !== null && ni !== null ? nt - ni : 0)
    return { input: inp, output: outp, total: nt, cacheRead: ncr, cacheWrite: ncw }
  }

  function monthKeyOf() {
    const now = new Date()
    return now.getFullYear() + '-' + (now.getMonth() + 1)
  }

  function todayKey() {
    const now = new Date()
    const p = (n) => (n < 10 ? '0' : '') + n
    return now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate())
  }

  function ensureMonthRollover() {
    const mk = monthKeyOf()
    if (state.monthlyUsage.month !== mk) {
      state.monthlyUsage.month = mk
      state.monthlyUsage.calls = 0
      state.monthlyUsage.inputTokens = 0
      state.monthlyUsage.outputTokens = 0
      state.monthlyUsage.cacheReadTokens = 0
      state.monthlyUsage.cacheWriteTokens = 0
      state.monthlyUsage.costCny = 0
    }
  }

  function computeCostDiff() {
    const b = state.balance
    const raw = (b && b.ok === true && Array.isArray(b.rows) && b.rows.length > 0) ? parseFloat(b.rows[0].total) : null
    const now = (typeof raw === 'number' && isFinite(raw)) ? raw : null
    let baseNow = 0
    state.sessionCosts.forEach((e) => {
      if (e && typeof e.costCny === 'number') baseNow += e.costCny
    })
    const sessionCostSince = Math.max(0, Math.round((baseNow - state.balanceStartSessionCost) * 100000) / 100000)
    if (state.balanceStart === null || now === null) {
      return { balanceStart: state.balanceStart, balanceNow: now, sessionCost: sessionCostSince, diff: null }
    }
    let diff = state.balanceStart - now - sessionCostSince
    if (!isFinite(diff)) diff = null
    else {
      diff = Math.round(diff * 100000) / 100000
      if (Object.is(diff, -0)) diff = 0
    }
    return { balanceStart: state.balanceStart, balanceNow: now, sessionCost: sessionCostSince, diff: diff }
  }

  function readJsonIfExists(path) {
    try {
      if (!existsSync(path)) return null
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) { return null }
  }

  function restoreUsage() {
    const obj = readJsonIfExists(USAGE_FILE)
    if (obj && typeof obj.inputTokens === 'number') {
      state.usage.calls = typeof obj.calls === 'number' ? obj.calls : 0
      state.usage.inputTokens = obj.inputTokens
      state.usage.outputTokens = typeof obj.outputTokens === 'number' ? obj.outputTokens : 0
      state.usage.cacheReadTokens = typeof obj.cacheReadTokens === 'number' ? obj.cacheReadTokens : 0
    }
  }

  function restoreMonthlyUsage() {
    const obj = readJsonIfExists(MONTHLY_FILE)
    if (obj && typeof obj.month === 'string') {
      state.monthlyUsage.month = obj.month
      state.monthlyUsage.calls = typeof obj.calls === 'number' ? obj.calls : 0
      state.monthlyUsage.inputTokens = typeof obj.inputTokens === 'number' ? obj.inputTokens : 0
      state.monthlyUsage.outputTokens = typeof obj.outputTokens === 'number' ? obj.outputTokens : 0
      state.monthlyUsage.cacheReadTokens = typeof obj.cacheReadTokens === 'number' ? obj.cacheReadTokens : 0
      state.monthlyUsage.cacheWriteTokens = typeof obj.cacheWriteTokens === 'number' ? obj.cacheWriteTokens : 0
      state.monthlyUsage.costCny = typeof obj.costCny === 'number' ? obj.costCny : 0
    }
  }

  function restoreSessionCosts() {
    const obj = readJsonIfExists(SESSION_COST_FILE)
    if (obj && typeof obj.mainSessionId === 'string') state.mainSessionId = obj.mainSessionId
    if (obj && Array.isArray(obj.entries)) {
      for (const it of obj.entries) {
        if (it && typeof it.sessionId === 'string') {
          state.sessionCosts.set(it.sessionId, {
            inputTokens: typeof it.inputTokens === 'number' ? it.inputTokens : 0,
            outputTokens: typeof it.outputTokens === 'number' ? it.outputTokens : 0,
            cacheReadTokens: typeof it.cacheReadTokens === 'number' ? it.cacheReadTokens : 0,
            cacheWriteTokens: typeof it.cacheWriteTokens === 'number' ? it.cacheWriteTokens : 0,
            costCny: typeof it.costCny === 'number' ? it.costCny : 0,
          })
        }
      }
    }
  }

  function restoreBalanceStart() {
    const obj = readJsonIfExists(BALANCE_START_FILE)
    if (obj && typeof obj.balance === 'number' && obj.date === todayKey()) {
      state.balanceStart = obj.balance
      if (typeof obj.sessionCost === 'number') state.balanceStartSessionCost = obj.sessionCost
    }
  }

  function restoreRealMonthlyCost() {
    const obj = readJsonIfExists(REAL_MONTHLY_FILE)
    if (obj && typeof obj.month === 'string' && typeof obj.totalCny === 'number') state.realMonthlyCost = obj
  }

  function loadSettings() {
    const obj = readJsonIfExists(SETTINGS_FILE)
    if (obj && typeof obj === 'object') {
      const s = Object.assign({}, DEFAULT_SETTINGS)
      if (typeof obj.idleEnabled === 'boolean') s.idleEnabled = obj.idleEnabled
      if (obj.idleFrequency === 'quiet' || obj.idleFrequency === 'normal' || obj.idleFrequency === 'chatty') s.idleFrequency = obj.idleFrequency
      if (typeof obj.voiceEnabled === 'boolean') s.voiceEnabled = obj.voiceEnabled
      if (typeof obj.petScale === 'number' && isFinite(obj.petScale)) s.petScale = Math.min(1.2, Math.max(0.6, obj.petScale))
      if (typeof obj.autoLaunchPet === 'boolean') s.autoLaunchPet = obj.autoLaunchPet
      if (typeof obj.lowBalanceAlert === 'boolean') s.lowBalanceAlert = obj.lowBalanceAlert
      if (typeof obj.lowBalanceThreshold === 'number' && isFinite(obj.lowBalanceThreshold) && obj.lowBalanceThreshold > 0) s.lowBalanceThreshold = obj.lowBalanceThreshold
      if (typeof obj.dndEnabled === 'boolean') s.dndEnabled = obj.dndEnabled
      if (/^\d{2}:\d{2}$/.test(String(obj.dndStart || ''))) s.dndStart = obj.dndStart
      if (/^\d{2}:\d{2}$/.test(String(obj.dndEnd || ''))) s.dndEnd = obj.dndEnd
      state.settings = s
    }
  }

  function saveSettings(patch) {
    const s = state.settings
    if (patch && typeof patch === 'object') {
      if (typeof patch.idleEnabled === 'boolean') s.idleEnabled = patch.idleEnabled
      if (patch.idleFrequency === 'quiet' || patch.idleFrequency === 'normal' || patch.idleFrequency === 'chatty') s.idleFrequency = patch.idleFrequency
      if (typeof patch.voiceEnabled === 'boolean') s.voiceEnabled = patch.voiceEnabled
      if (typeof patch.petScale === 'number' && isFinite(patch.petScale)) s.petScale = Math.min(1.2, Math.max(0.6, patch.petScale))
      if (typeof patch.autoLaunchPet === 'boolean') s.autoLaunchPet = patch.autoLaunchPet
      if (typeof patch.lowBalanceAlert === 'boolean') s.lowBalanceAlert = patch.lowBalanceAlert
      if (typeof patch.lowBalanceThreshold === 'number' && isFinite(patch.lowBalanceThreshold) && patch.lowBalanceThreshold > 0) s.lowBalanceThreshold = patch.lowBalanceThreshold
      if (typeof patch.dndEnabled === 'boolean') s.dndEnabled = patch.dndEnabled
      if (/^\d{2}:\d{2}$/.test(String(patch.dndStart || ''))) s.dndStart = patch.dndStart
      if (/^\d{2}:\d{2}$/.test(String(patch.dndEnd || ''))) s.dndEnd = patch.dndEnd
    }
    try { writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)) } catch (e) { /* ignore */ }
    writeDesktopState().catch(() => {})
    return s
  }

  function isDndNow() {
    const s = state.settings
    if (s.dndEnabled !== true) return false
    const toMin = (t) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''))
      if (m === null) return null
      const hh = parseInt(m[1], 10)
      const mm = parseInt(m[2], 10)
      if (hh > 23 || mm > 59) return null
      return hh * 60 + mm
    }
    const start = toMin(s.dndStart)
    const end = toMin(s.dndEnd)
    if (start === null || end === null || start === end) return false
    const now = new Date()
    const cur = now.getHours() * 60 + now.getMinutes()
    if (start < end) return cur >= start && cur < end
    return cur >= start || cur < end // 跨午夜(如 22:00–09:00)
  }

  let persistTimer = null
  function schedulePersistCosts() {
    if (persistTimer !== null) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      try { writeFileSync(USAGE_FILE, JSON.stringify(state.usage)) } catch (e) { /* ignore */ }
      try { writeFileSync(MONTHLY_FILE, JSON.stringify(state.monthlyUsage)) } catch (e) { /* ignore */ }
      try {
        const entries = []
        state.sessionCosts.forEach((e, sid) => {
          entries.push({ sessionId: sid, inputTokens: e.inputTokens, outputTokens: e.outputTokens, cacheReadTokens: e.cacheReadTokens, costCny: e.costCny })
        })
        writeFileSync(SESSION_COST_FILE, JSON.stringify({ mainSessionId: state.mainSessionId, entries }))
      } catch (e) { /* ignore */ }
    }, 3000)
  }

  // 桌面状态写防抖:会话期间 llm/stream 每个 chunk 都触发的话会形成
  // writeFileSync 风暴,阻塞事件循环导致 /speech 等请求排队、语音延迟。
  let stateWriteTimer = null
  function scheduleDesktopStateWrite(immediate) {
    if (immediate === true) {
      if (stateWriteTimer !== null) { clearTimeout(stateWriteTimer); stateWriteTimer = null }
      writeDesktopState().catch(() => {})
      return
    }
    if (stateWriteTimer !== null) return
    stateWriteTimer = setTimeout(() => {
      stateWriteTimer = null
      writeDesktopState().catch(() => {})
    }, 1500)
  }

  function persistBalanceStart() {
    try {
      writeFileSync(BALANCE_START_FILE, JSON.stringify({ date: todayKey(), balance: state.balanceStart, sessionCost: state.balanceStartSessionCost }))
    } catch (e) { /* ignore */ }
  }

  // 真实月度成本(平台 usage 接口)。仅当 ~/.whale-platform-auth.json 存在时拉取;
  // 没有则静默跳过,木牌回退到 tokens 估算值。
  async function fetchRealMonthlyCost() {
    try {
      const authObj = readJsonIfExists(join(USAGE_DIR, '.whale-platform-auth.json'))
      if (!authObj || typeof authObj.token !== 'string' || authObj.token.length < 20 || typeof authObj.cookies !== 'string') return
      const now = new Date()
      const start = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), 1) / 1000) - 28800
      const end = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1) / 1000) - 28800
      const url = 'https://platform.deepseek.com/api/v0/usage/by_api_key/cost?start=' + start + '&end=' + end + '&tz=28800'
      const body = await new Promise((resolve) => {
        const req = https.get(url, {
          headers: {
            'accept': '*/*',
            'authorization': 'Bearer ' + authObj.token,
            'cookie': authObj.cookies,
            'referer': 'https://platform.deepseek.com/usage',
            'user-agent': 'mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/151.0.0.0 safari/537.36 edg/151.0.0.0',
            'x-client-bundle-id': 'com.deepseek.chat',
            'x-client-locale': 'zh_CN',
            'x-client-platform': 'web',
            'x-client-timezone-offset': '28800',
            'x-client-version': '1.0.0',
          },
          timeout: 20000,
        }, (res) => {
          let d = ''
          res.on('data', (c) => { d += c })
          res.on('end', () => resolve(d))
        })
        req.on('error', () => resolve(''))
        req.on('timeout', () => { req.destroy(); resolve('') })
      })
      const trimmed = String(body).trim()
      if (trimmed.charAt(0) !== '{') return
      const json = JSON.parse(trimmed)
      if (!json || json.code !== 0 || !json.data || !json.data.biz_data) return
      let total = 0
      const perModel = {}
      const groups = json.data.biz_data.data
      if (Array.isArray(groups)) {
        for (const g of groups) {
          const series = g && Array.isArray(g.series) ? g.series : []
          for (const s of series) {
            const model = String((s && s.model) || '')
            const buckets = s && Array.isArray(s.buckets) ? s.buckets : []
            let mCost = 0
            for (const b of buckets) {
              const t = typeof b.time === 'number' ? b.time : 0
              if (t < start || t >= end) continue
              const c = parseFloat(b.cost)
              if (isFinite(c) && c > 0) { mCost += c; total += c }
            }
            if (model) perModel[model] = Math.round(((typeof perModel[model] === 'number' ? perModel[model] : 0) + mCost) * 10000) / 10000
          }
        }
      }
      state.realMonthlyCost = {
        month: monthKeyOf(),
        totalCny: Math.round(total * 10000) / 10000,
        perModel,
        fetchedAt: Date.now(),
      }
      try { writeFileSync(REAL_MONTHLY_FILE, JSON.stringify(state.realMonthlyCost)) } catch (e) { /* ignore */ }
      writeDesktopState().catch(() => {})
    } catch (e) { /* ignore */ }
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
      const cd = computeCostDiff()
      const se = (state.mainSessionId !== '' && state.sessionCosts.has(state.mainSessionId)) ? state.sessionCosts.get(state.mainSessionId) : null
      const monthlyNum = state.realMonthlyCost !== null && typeof state.realMonthlyCost.totalCny === 'number' ? state.realMonthlyCost.totalCny : state.monthlyUsage.costCny
      const fmtCostRow = (v) => (typeof v === 'number' && isFinite(v)) ? '≈¥' + v.toFixed(2) : ''
      const n = state.taskDone
      const noticeJson = n === null ? null : {
        id: n.id,
        status: n.status,
        kind: n.kind,
        title: n.title,
        costCny: n.costCny,
        at: n.at,
        cost: (n.status !== 'needs_help' && n.status !== 'approval' && typeof n.costCny === 'number') ? '≈¥' + n.costCny.toFixed(2) : '',
        in: typeof n.inputTokens === 'number' ? String(n.inputTokens) : '0',
        out: typeof n.outputTokens === 'number' ? String(n.outputTokens) : '0',
        cache: typeof n.cacheReadTokens === 'number' ? String(n.cacheReadTokens) : '0',
      }
      const row0Cur = row0 !== null && typeof row0.currency === 'string' && row0.currency !== '' && row0.currency !== 'CNY' ? (row0.currency + ' ') : '¥'
      const json = {
        balanceTotal: row0 !== null ? row0.total : null,
        balanceText: row0 !== null ? row0Cur + Number(row0.total).toFixed(2) : '',
        balanceFetchedAt: state.balanceFetchedAt || '',
        noticeText: '',
        lowBalanceActive: state.lowBalance.active === true,
        skin: state.desktopSkin,
        ghost: state.desktopGhost,
        speech: { text: state.speechText || '', expireAt: state.speechExpireAt, audioTick: state.speechAudioTick, file: state.speechFile || '' },
        tokens: { input: String(state.monthlyUsage.inputTokens), output: String(state.monthlyUsage.outputTokens), cacheRead: String(state.monthlyUsage.cacheReadTokens), calls: String(state.monthlyUsage.calls || 0) },
        costRows: {
          session: fmtCostRow(se !== null ? se.costCny : 0),
          monthly: fmtCostRow(monthlyNum),
          diff: cd && typeof cd.diff === 'number' && isFinite(cd.diff) ? fmtCostRow(Math.max(0, cd.diff)) : '',
        },
        voiceEngine: state.petAlive ? 'pet' : 'browser',
        voiceEnabled: state.settings.voiceEnabled !== false,
        dnd: isDndNow(),
        notice: noticeJson,
        display: buildDisplay(),
        efficiency: buildEfficiency(),
        topupOptions: topupOptions,
        topupQrPath: topupQrPath,
        topupSite: 'platform.deepseek.com/top_up',
        labels: {
          titleBalance: '🐳 余额', titleUsage: '🐳 Tokens', speechTitle: '💬 鲸鱼娘说',
          btnUsage: '看用量', btnBalance: '看余额', btnRefresh: '刷新', btnGhost: '透明', btnClose: 'X', btnGotIt: '知道了',
          rowCalls: '模型调用', rowIn: '输入 tokens', rowOut: '输出 tokens', rowCache: '缓存读取',
          refreshedAt: '刷新于',
          rowSession: '当前会话消耗', rowMonthly: '本月消耗', rowDiff: '消耗差值', rowCost: '消耗金额',
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
        log('speech asset hit: ' + String(text).slice(0, 30) + ' -> ' + line.file)
        return { ok: true, base64: bytesToBase64(bytes), source: 'asset' }
      }
    }
    log('speech no-synth: ' + String(text).slice(0, 40) + ' (instruct="' + String(instruct || '').slice(0, 20) + '")')
    return { ok: false, error: 'no-synth' }
  }

  let speechChain = Promise.resolve()
  let lastSpeechAt = 0
  async function doWhaleSpeech(args) {
    const a = (args && typeof args === 'object') ? args : {}
    if (typeof a.text === 'string' && a.text !== '') {
      const text = String(a.text).slice(0, 60)
      const now = Date.now()
      // 全局限流:同一句台词 2.5 秒内的重复事件(多标签页空闲台词/连点摸头)只读一遍
      if (state.speechText === text && now - lastSpeechAt < 2500) return { ok: true }
      lastSpeechAt = now
      state.speechText = text
      const ms = typeof a.ms === 'number' && a.ms > 500 && a.ms <= 30000 ? a.ms : 5000
      state.speechExpireAt = now + ms
      const r = await speechAudio(a.text, a.instruct, a.speed, a.gain)
      if (state.settings.voiceEnabled !== false && r && r.ok === true && r.base64) {
        try {
          mkdirSync(DATA_DIR, { recursive: true })
          // D6 根治:按文本内容 hash 命名 wav——display 项与音频按内容绑定,不再张冠李戴
          const spDir = join(DATA_DIR, 'speech')
          mkdirSync(spDir, { recursive: true })
          const hash = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
          writeFileSync(join(spDir, hash + '.wav'), Buffer.from(r.base64, 'base64'))
          // 兼容旧渲染:继续写 last.wav(新版 pet-views 落地后可退役)
          writeFileSync(join(DATA_DIR, 'whale-speech-last.wav'), Buffer.from(r.base64, 'base64'))
          state.speechFile = 'speech/' + hash + '.wav'
          // 清理:只保留最新 30 个
          try {
            const entries = readdirSync(spDir).filter((n) => n.endsWith('.wav')).map((n) => ({ n, m: 0 }))
            for (const e of entries) { try { e.m = statSync(join(spDir, e.n)).mtimeMs } catch { e.m = 0 } }
            entries.sort((x, y) => y.m - x.m)
            for (const e of entries.slice(30)) { try { unlinkSync(join(spDir, e.n)) } catch { /* ignore */ } }
          } catch { /* ignore */ }
        } catch (e) { /* ignore */ }
      }
      state.speechAudioTick += 1
      await writeDesktopState()
    }
    return { ok: true }
  }

  async function fetchBalance() {
    const fail = (msg) => {
      state.balanceError = msg
      writeDesktopState().catch(() => {})
      return { ok: false, error: msg }
    }
    try {
      const credPath = join(homedir(), '.dsh', '.credentials.yaml')
      if (!existsSync(credPath)) return fail('no-credentials')
      const raw = readFileSync(credPath, 'utf8')
      const m = raw.match(/sk-[A-Za-z0-9]{20,}/)
      if (m === null) return fail('no-key')
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
      if (body.status !== 200) return fail('http ' + body.status)
      const j = JSON.parse(body.body)
      if (j && j.error) return fail('api-error')
      const infos = (j && (j.balance_infos || j.balanceInfos)) || []
      const rows = infos.map((i) => ({
        currency: i.currency || '',
        total: (i.total_balance !== undefined ? i.total_balance : (i.totalBalance !== undefined ? i.totalBalance : i.total)),
        granted: i.granted_balance !== undefined ? i.granted_balance : i.grantedBalance,
        toppedUp: i.topped_up_balance !== undefined ? i.topped_up_balance : i.toppedUpBalance,
      }))
      if (rows.length === 0 && (typeof j.total_balance === 'number' || typeof j.totalBalance === 'number')) {
        rows.push({ currency: '', total: (j.total_balance !== undefined ? j.total_balance : j.totalBalance) })
      }
      const result = { ok: true, rows, isAvailable: j.is_available !== undefined ? j.is_available : j.isAvailable }
      state.balance = result
      state.balanceError = null
      state.balanceFetchedAt = new Date().toTimeString().slice(0, 8)
      // 低余额检测:低于阈值触发一次提醒(version 递增驱动客户端弹窗);阈值可配置,验收时可临时调大
      const total = rows.length > 0 ? parseFloat(rows[0].total) : NaN
      const thr = typeof state.settings.lowBalanceThreshold === 'number' && isFinite(state.settings.lowBalanceThreshold) && state.settings.lowBalanceThreshold > 0 ? state.settings.lowBalanceThreshold : 5
      if (state.settings.lowBalanceAlert !== false && isFinite(total) && total < thr) {
        state.lowBalance.amount = total
        if (!state.lowBalance.active) {
          state.lowBalance.active = true
          state.lowBalance.version += 1
          // 窝 2 补漏(2026-09-14 妹妹对账发现):低余额也走统一调度器,金额写进 text,桌面宠按 text 渲染;
          // 只在「转入低余额」那一刻弹一次,不随 30s 轮询刷屏
          announce({ kind: 'lowbalance', text: '⚠️ 余额 ¥' + Number(total).toFixed(2) + ' 偏低,请及时充值', displayMs: 12000 })
        }
      } else if (state.lowBalance.active) {
        state.lowBalance.active = false
      }
      // 今日余额起点快照(每天一次,供"消耗差值 = 余额下降 - 会话消耗"计算)
      if (state.balanceStart === null && rows.length > 0) {
        const t0 = parseFloat(rows[0].total)
        if (isFinite(t0)) {
          state.balanceStart = t0
          let total0 = 0
          state.sessionCosts.forEach((e) => { if (e && typeof e.costCny === 'number') total0 += e.costCny })
          state.balanceStartSessionCost = Math.round(total0 * 100000) / 100000
          persistBalanceStart()
        }
      }
      await writeDesktopState()
      return result
    } catch (e) {
      return fail(String(e && e.message ? e.message : e))
    }
  }

  let qrCache = null
  let qrCacheAt = 0
  let topupQrPath = ''
  const topupOptions = [10, 50, 100]
  async function fetchTopupQr() {
    // 充值二维码(带 1h 缓存);金额只作记录,二维码统一指向平台充值页(与浏览器流程一致)
    if (qrCache !== null && Date.now() - qrCacheAt < 3600000) return { base64: qrCache }
    const url = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent('https://platform.deepseek.com/top_up')
    const body = await new Promise((resolve) => {
      const r2 = https.get(url, { timeout: 20000, headers: { 'User-Agent': 'whale-pet/1' } }, (rr) => {
        const chunks = []
        rr.on('data', (c) => chunks.push(c))
        rr.on('end', () => resolve(Buffer.concat(chunks)))
      })
      r2.on('error', () => resolve(null))
      r2.on('timeout', () => { r2.destroy(); resolve(null) })
    })
    if (body === null || body.length < 100 || body[0] !== 0x89 || body[1] !== 0x50 || body[2] !== 0x4e || body[3] !== 0x47) return null
    qrCache = body.toString('base64')
    qrCacheAt = Date.now()
    return { base64: qrCache }
  }
  async function ensureTopupQrPng() {
    // cmd 通道用:二维码 PNG 落数据目录,桌面宠按 topupQrPath 读取
    try {
      const r = await fetchTopupQr()
      if (r === null) return
      const p = join(DATA_DIR, 'whale-topup-qr.png')
      writeFileSync(p, Buffer.from(r.base64, 'base64'))
      topupQrPath = p
      writeDesktopState().catch(() => {})
    } catch (e) { /* ignore */ }
  }
  const routes = [
    route('/api/dsh-whale-pet/state', async (req, res) => {
      const se = (state.mainSessionId !== '' && state.sessionCosts.has(state.mainSessionId)) ? state.sessionCosts.get(state.mainSessionId) : null
      writeJson(res, 200, {
        ok: true,
        balance: state.balance,
        balanceError: state.balanceError,
        taskDone: state.taskDone,
        taskQueue: state.taskQueue,
        usage: {
          calls: state.monthlyUsage.calls || 0,
          inputTokens: state.monthlyUsage.inputTokens,
          outputTokens: state.monthlyUsage.outputTokens,
          cacheReadTokens: state.monthlyUsage.cacheReadTokens,
          lastModel: state.usage.lastModel,
          month: state.monthlyUsage.month,
        },
        monthlyUsage: {
          month: state.monthlyUsage.month,
          costCny: state.monthlyUsage.costCny,
          inputTokens: state.monthlyUsage.inputTokens,
          outputTokens: state.monthlyUsage.outputTokens,
          cacheReadTokens: state.monthlyUsage.cacheReadTokens,
        },
        realMonthlyCost: state.realMonthlyCost === null ? null : {
          month: state.realMonthlyCost.month,
          totalCny: state.realMonthlyCost.totalCny,
          perModel: state.realMonthlyCost.perModel,
          fetchedAt: state.realMonthlyCost.fetchedAt,
        },
        sessionCost: {
          sessionId: state.mainSessionId,
          inputTokens: se !== null ? se.inputTokens : 0,
          outputTokens: se !== null ? se.outputTokens : 0,
          cacheReadTokens: se !== null ? se.cacheReadTokens : 0,
          costCny: se !== null ? se.costCny : 0,
        },
        costDiff: computeCostDiff(),
        lowBalance: { active: state.lowBalance.active, version: state.lowBalance.version, amount: state.lowBalance.amount },
        voiceEngine: state.petAlive ? 'pet' : 'browser',
        busy: lastAgentBusy,
        settings: Object.assign({}, state.settings),
        dnd: isDndNow(),
        display: buildDisplay(),
        efficiency: buildEfficiency(),
      })
    }),
    route('/api/dsh-whale-pet/refresh-balance', async (req, res) => {
      const r = await fetchBalance()
      fetchRealMonthlyCost().catch(() => {})
      writeJson(res, 200, r)
    }),
    route('/api/dsh-whale-pet/speech', async (req, res) => {
      const args = await readJsonBody(req)
      const run2 = speechChain.then(() => doWhaleSpeech(args))
      speechChain = run2.catch(() => ({ ok: true }))
      writeJson(res, 200, await run2)
    }),
    route('/api/dsh-whale-pet/pet-closing', async (req, res) => {
      // D10:桌宠关窗主动告知(推模型)——不再靠宿主数心跳去猜,发声权立即交还
      state.petAlive = false
      lastPetKillAt = Date.now()
      writeDesktopState().catch(() => {})
      log('pet closing (self-reported)')
      writeJson(res, 200, { ok: true })
    }),
    route('/api/dsh-whale-pet/display/ack', async (req, res) => {
      const a = await readJsonBody(req)
      const seq = a && typeof a.seq === 'number' ? a.seq : -1
      const kind = a && typeof a.kind === 'string' ? a.kind : 'seen'
      writeJson(res, 200, { ok: ackDisplay(seq, kind) })
    }),
    route('/api/dsh-whale-pet/announce', async (req, res) => {
      // 窝 2:摸头/台词从浏览器上报宿主,调度器成为唯一权威(过渡期 client 有降级兜底)
      const a = await readJsonBody(req)
      const kind = a && typeof a.kind === 'string' && (a.kind === 'headpat' || a.kind === 'line') ? a.kind : 'line'
      const text = a && typeof a.text === 'string' ? a.text : ''
      if (text === '') { writeJson(res, 200, { ok: false, error: 'empty' }); return }
      const r = announce({ kind, text, speech: text })
      // D7 第二层:回传仲裁结果,浏览器可据此决定是否撤回本地乐观渲染
      writeJson(res, 200, { ok: true, accepted: r.accepted, queued: r.queued, seq: r.seq, reason: r.reason })
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
        const variants = []
        for (let i = 0; i < 3; i++) {
          const p = join(VOICES_DIR, 'notice-' + st + '-' + i + '.wav')
          if (existsSync(p)) {
            try { variants.push({ base64: bytesToBase64(readFileSync(p)) }) } catch (e) { /* ignore */ }
          }
        }
        const p0 = join(VOICES_DIR, 'notice-' + st + '.wav')
        if (existsSync(p0)) {
          try { variants.push({ base64: bytesToBase64(readFileSync(p0)) }) } catch (e) { /* ignore */ }
        }
        if (variants.length > 0) out[st] = { base64: variants[0].base64, variants }
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
    route('/api/dsh-whale-pet/settings', async (req, res) => {
      const a = await readJsonBody(req)
      if (a && typeof a.settings === 'object') {
        saveSettings(a.settings)
      }
      writeJson(res, 200, { ok: true, settings: state.settings })
    }),
    route('/api/dsh-whale-pet/topup-qr', async (req, res) => {
      try {
        const r = await fetchTopupQr()
        if (r === null) { writeJson(res, 200, { ok: false, error: 'qr-fetch-failed' }); return }
        writeJson(res, 200, { ok: true, base64: r.base64, mime: 'image/png' })
      } catch (e) {
        writeJson(res, 200, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }),
  ]

  ctx.effect(() => {
    const disposers = routes.map((r) => ctx.webServer.register(r))
    return () => { for (const d of disposers) d() }
  })

  // ---------- 0.1.5 设置面板兼容:向 settingsScope 认领 namespace(桥接,不迁持久化) ----------
  // 新宿主(>=0.1.5)的 settings.plugin.item 改为 keyed+namespace 派发:卡片只有在其 namespace
  // 被宿主 settings 服务注册过(describe() 里有)才会渲染。桌宠的设置仍走自己的
  // whale-settings.json + /api/dsh-whale-pet/settings 路由,这里只做「派发认领」:
  // schema 为空对象,注册零持久化副作用。老宿主没有 settings/register(或没有 schemastery)
  // 则整段静默跳过,面板仍按旧 list 契约(id/order/label)渲染。全部兜底,绝不因此崩插件。
  try {
    var claim = function (scopeCtx) {
      try {
        var svc = scopeCtx && scopeCtx.settings
        if (!svc || typeof svc.register !== 'function') return
        import('@deepseek-ai/schemastery').then((zmod) => {
          try {
            let z = (zmod && (zmod.default || zmod)) || null
            if (z && typeof z.object !== 'function' && z.default) z = z.default
            if (!z || typeof z.object !== 'function') return
            svc.register('dsh-whale-pet', z.object({ petScale: z.number().default(0.75) }))
            // 探针 v2(妹妹实测修正):describe() 返回数组 [{ns,...}](dsh-settings:351),不是 {view:{namespaces}};
            // 两种形状都查,并把宿主实际 serve 的 ns 清单落进日志——一眼看穿认领成没成。
            let seen = false
            let listDesc = ''
            try {
              const desc = typeof svc.describe === 'function' ? svc.describe() : null
              const arr = Array.isArray(desc) ? desc : (desc && desc.view && desc.view.namespaces)
              if (Array.isArray(arr)) {
                listDesc = arr.map(function (v) { return v && v.ns }).filter(Boolean).join(',')
                seen = arr.some(function (v) { return v && v.ns === 'dsh-whale-pet' })
              }
            } catch (e) { /* ignore */ }
            log('settings-bridge: claimed namespace dsh-whale-pet; describe sees it = ' + seen + '; served namespaces = [' + listDesc + ']')
          } catch (e) { /* 契约差异:静默跳过,面板不显示但功能不受影响 */ }
        }).catch(() => { /* 无 schemastery:静默跳过 */ })
      } catch (e) { /* ignore */ }
    }
    if (ctx && typeof ctx.inject === 'function') ctx.inject(['settings'], claim)
    // 根 scope 兜底:若 0.1.5 客户端镜像只认根 context 的 registrations(隔离域假说),双路认领一次
    var rootCtx = ctx && ctx.root
    if (rootCtx && rootCtx !== ctx && typeof rootCtx.inject === 'function') {
      try { rootCtx.inject(['settings'], claim) } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }

  let lastPetLaunchAt = 0
  let lastPetKillAt = 0
  async function launchDesktopPet() {
    try {
      // D14:拉起前先收掉旧实例(升级后旧窗口残留 = 两个桌宠;与浏览器侧同源的模式根治)
      await killDesktopPet()
      mkdirSync(RUN_DIR, { recursive: true })
      const scriptPath = join(RUN_DIR, 'whale-pet.ps1')
      // UTF-8 BOM:PowerShell 5.1 读无 BOM 的 .ps1 会按系统 ANSI(GBK)解析,中文按钮会乱码
      writeFileSync(scriptPath, '\ufeff' + buildPetScript(STATE_PATH, CMD_PATH, join(SKINS_DIR, 'whale-skin-0.png'), join(DATA_DIR, 'whale-speech-last.wav'), VOICES_DIR), 'utf8')
      await writeDesktopState()
      spawn('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], { stdio: 'ignore', windowsHide: true })
      state.petAlive = true
      lastPetLaunchAt = Date.now()
      lastPetKillAt = 0 // D11:新起的桌宠不该受「上次关闭」宽限连坐
      log('pet launched')
    } catch (e) {
      log('pet launch FAIL ' + e.message)
    }
  }

  async function killDesktopPet() {
    try {
      // ① 按窗口标题杀(宠物脚本设了 Title='WhalePet')
      await run('C:\\WINDOWS\\system32\\cmd.exe', ['/c', 'taskkill /f /im powershell.exe /fi "WINDOWTITLE eq WhalePet*"'], { timeoutMs: 15000 })
      // ② 命令行兜底:标题匹配不到时,按脚本路径定位进程强杀
      await run('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*whale-pet.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { timeoutMs: 15000 })
    } catch (e) { /* ignore */ }
    // D8-c:状态置位与落盘必须无条件执行(两条 kill 路径都可能抛错;原实现吞异常导致静音窗口)
    state.petAlive = false
    lastPetKillAt = Date.now()
    writeDesktopState().catch(() => {})
  }

  // ---------- 任务通知 ----------
  state.turnSeq = 0
  const QUEUE_FILE = join(DATA_DIR, 'whale-queue.json')
  function persistTaskQueue() {
    try {
      writeFileSync(QUEUE_FILE, JSON.stringify({ items: state.taskQueue, doneId: state.taskDoneId }))
    } catch (e) { /* ignore */ }
  }
  function restoreTaskQueue() {
    try {
      const obj = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'))
      if (obj && Array.isArray(obj.items)) {
        state.taskQueue = obj.items.slice(-6)
        if (typeof obj.doneId === 'number') state.taskDoneId = obj.doneId
        if (state.taskQueue.length > 0) state.taskDone = state.taskQueue[state.taskQueue.length - 1]
      }
    } catch (e) { /* ignore */ }
  }
  function pushNotice(item) {
    // 窝 1 根治:差异化去重表(2026-09-14)
    // - approval / failed:不按「同 turn 同 status 同 kind」抑制——每条都是真人要处理的事;
    // - subagent / workflow completed:只抑制「同会话 + 同 turn」,跨会话放行;
    // - needs_help:同 turn 同标题才抑制(标题不同放行,1.0.3 例外保留);
    // - agent completed:保留 90s 同会话规则;
    // - 其余(如 job):维持原同 turn 规则,窝 5 另行处理。
    const lastItem = state.taskQueue.length > 0 ? state.taskQueue[state.taskQueue.length - 1] : null
    const alwaysShow = item.status === 'approval' || item.status === 'failed'
    const childKind = item.status === 'completed' && (item.kind === 'subagent' || item.kind === 'workflow')
    const crossSessionChild = childKind &&
        typeof item.sessionId === 'string' && item.sessionId !== '' &&
        lastItem !== null && lastItem.sessionId !== item.sessionId
    const sameTurnRule = !alwaysShow && !crossSessionChild &&
        lastItem !== null && lastItem.status === item.status && lastItem.kind === item.kind &&
        typeof lastItem.announceTurn === 'number' && lastItem.announceTurn === item.announceTurn &&
        !(item.status === 'needs_help' && lastItem.title !== item.title)
    if (sameTurnRule) return
    if (item.status === 'completed' && item.kind === 'agent' && lastItem !== null && lastItem.status === 'completed' &&
        lastItem.kind === 'agent' && typeof lastItem.announcedAt === 'number' && item.announcedAt - lastItem.announcedAt < 90000 &&
        lastItem.sessionId === item.sessionId) return
    state.taskDone = item
    state.taskQueue.push(item)
    if (state.taskQueue.length > 6) state.taskQueue.shift()
    persistTaskQueue()
    // 窝 2:通知也进统一调度器(display 字段;通知语音仍走旧 notice-wav 路径,不重复 TTS)
    announce({ kind: 'notice', status: item.status, text: item.title, displayMs: 8000 })
    writeDesktopState().catch(() => {})
  }

  // ---------- 窝 2:统一展示/发声调度器(2026-09-14) ----------
  let displaySeq = 0
  let displayCurrent = null
  let displayQueue = []
  const DISPLAY_PRIORITY = { notice: 3, lowbalance: 3, headpat: 2, line: 1 }
  function announce(req) {
    try {
      if (!req || typeof req !== 'object') return { accepted: false, queued: false, seq: 0, reason: 'bad-request' }
      let result = { accepted: false, queued: false, seq: 0, reason: 'suppressed' }
      const kind = typeof req.kind === 'string' && req.kind !== '' ? req.kind : 'line'
      const priority = typeof req.priority === 'number' ? req.priority : (DISPLAY_PRIORITY[kind] || 1)
      const text = typeof req.text === 'string' ? req.text : ''
      const displayMs = typeof req.displayMs === 'number' && req.displayMs > 0 ? req.displayMs : (kind === 'line' ? 6000 : 8000)
      const item = {
        seq: 0,
        kind,
        priority,
        text,
        speech: typeof req.speech === 'string' ? req.speech : '',
        status: typeof req.status === 'string' ? req.status : '',
        displayMs,
        untilAt: Date.now() + displayMs,
      }
      const cur = displayCurrent
      if (cur === null || cur.untilAt < Date.now()) {
        item.seq = ++displaySeq
        displayCurrent = item
        result = { accepted: true, queued: false, seq: item.seq }
      } else if (item.priority > cur.priority) {
        // 高优先级打断低优先级(通知打断台词/摸头);被打断的低优先级不再回补
        item.seq = ++displaySeq
        displayCurrent = item
        displayQueue = displayQueue.filter((q) => q.priority >= item.priority).slice(0, 3)
        result = { accepted: true, queued: false, seq: item.seq }
      } else if (item.priority === cur.priority) {
        // 同优先级排队,上限 3,溢出丢最旧的;连续摸头 = 替换语义(不排队积压,与浏览器打断一致)
        if (kind === 'headpat') {
          if (cur.kind === 'headpat') {
            item.seq = ++displaySeq
            displayCurrent = item
            result = { accepted: true, queued: false, seq: item.seq }
          } else {
            displayQueue = displayQueue.filter((q) => q.kind !== 'headpat')
            item.seq = ++displaySeq
            displayQueue.push(item)
            while (displayQueue.length > 3) displayQueue.shift()
            result = { accepted: true, queued: true, seq: item.seq }
          }
        } else {
          item.seq = ++displaySeq
          displayQueue.push(item)
          while (displayQueue.length > 3) displayQueue.shift()
          result = { accepted: true, queued: true, seq: item.seq }
        }
      } else {
        // D7(2026-09-14 主人拍板):摸头撞上通知 ⇒ 排队,通知结束后补显示;
        // 其余低优先级(随机台词)维持丢弃,保持窝 5 的降噪方向
        if (kind === 'headpat') {
          displayQueue = displayQueue.filter((q) => q.kind !== 'headpat') // 连点摸头仍只留最新一条
          item.seq = ++displaySeq
          displayQueue.push(item)
          while (displayQueue.length > 3) displayQueue.shift()
          result = { accepted: true, queued: true, seq: item.seq }
        } else {
          return { accepted: false, queued: false, seq: 0, reason: 'suppressed' }
        }
      }
      // D3:非通知上屏时清掉 notice 槽,避免桌面宠降级路径读到上一条通知的残留字段
      if (kind !== 'notice') state.taskDone = null
      // 发声:台词/摸头都走资产 TTS(0.1.5 修复:摸头原被排除在 TTS 外,桌宠持发声权时摸头无声);
      // 通知不在此 TTS(旧路径各有自己的声音)
      if ((kind === 'line' || kind === 'headpat') && item.speech !== '') {
        doWhaleSpeech({ text: item.speech, instruct: typeof req.instruct === 'string' ? req.instruct : '' }).catch(() => {})
      }
      writeDesktopState().catch(() => {})
      return result
    } catch (e) { return { accepted: false, queued: false, seq: 0, reason: 'error' } }
  }
  function promote(next) {
    // D5-②:队列项上屏时重算 untilAt(入队即定死会越排越短)
    if (next !== null) next.untilAt = Date.now() + next.displayMs
    displayCurrent = next
  }
  function tickDisplay() {
    try {
      const cur = displayCurrent
      if (cur !== null && cur.untilAt < Date.now()) {
        if (cur.kind === 'notice') state.taskDone = null // D3:通知展示结束即清槽
        promote(displayQueue.length > 0 ? displayQueue.shift() : null)
        writeDesktopState().catch(() => {})
      }
    } catch (e) { /* ignore */ }
  }
  function ackDisplay(seq, kind) {
    try {
      const cur = displayCurrent
      if (cur !== null && cur.seq === seq) {
        if (kind === 'dismiss') promote(displayQueue.length > 0 ? displayQueue.shift() : null)
        writeDesktopState().catch(() => {})
        return true
      }
      const idx = displayQueue.findIndex((q) => q.seq === seq)
      if (idx >= 0 && kind === 'dismiss') displayQueue.splice(idx, 1)
      return true
    } catch (e) { return false }
  }
  function buildDisplay() {
    return { seq: displaySeq, current: displayCurrent, queueLen: displayQueue.length }
  }
  function buildEfficiency() {
    const se = (state.mainSessionId !== '' && state.sessionCosts.has(state.mainSessionId)) ? state.sessionCosts.get(state.mainSessionId) : null
    const m = state.monthlyUsage
    const cacheTotal = (m.inputTokens || 0) + (m.cacheReadTokens || 0)
    const cacheHitPct = cacheTotal > 0 ? Math.round(((m.cacheReadTokens || 0) / cacheTotal) * 100) : null
    let remark = ''
    if (cacheHitPct !== null) remark = cacheHitPct >= 95 ? ('缓存 ' + cacheHitPct + '%,今天很省') : cacheHitPct >= 70 ? ('缓存 ' + cacheHitPct + '%,正常') : ('缓存 ' + cacheHitPct + '%,上下文常被打断')
    return {
      ttftMs: null, tokensPerSec: null, rounds: null, steps: null, llmMs: null, toolMs: null,
      cacheHitPct,
      sessionTokens: se !== null ? { input: se.inputTokens, output: se.outputTokens, cacheRead: se.cacheReadTokens, cacheWrite: se.cacheWriteTokens || 0 } : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      remark,
    }
  }

  // 完成通知延迟:agent idle 时暂存 pending,若紧跟总结流则等流结束再宣布(不打断总结);
  // 3 秒无总结流则兜底宣布;新任务启动会丢弃 pending。
  // 多会话感知:并行任务各自记忙/pending/用量快照,谁完成弹谁(标题带会话名)。
  const busySessions = new Set()
  const pendingBySession = new Map()
  const pendingTimers = new Map()
  const taskStartBySession = new Map()
  let lastAgentBusy = false
  function isSubagentAgent(obj) {
    try {
      const agent = obj && typeof obj === 'object' ? obj.agent : null
      if (!agent || typeof agent !== 'object') return false
      const session = agent.session
      if (session && typeof session === 'object') {
        const h = session.header
        if (h && typeof h === 'object') {
          if (h.origin === 'subagent') return true
          if (typeof h.delegationDepth === 'number' && h.delegationDepth > 0) return true
        }
      }
      const options = agent.options
      if (options && typeof options === 'object' && typeof options.subagentDepth === 'number' && options.subagentDepth > 0) return true
      return false
    } catch (e) { return false }
  }
  // 窝 3:酒馆会话过滤(权威判据 2026-09-14 采样定稿:酒馆自用状态文件 tavern-state.json
  // 的 allowCwds/allowSessions 白名单——与酒馆注入角色卡的判据天然一致)
  let tavernStateCache = null
  let tavernStateCacheAt = 0
  function readTavernState() {
    try {
      if (tavernStateCache !== null && Date.now() - tavernStateCacheAt < 1000) return tavernStateCache
      const p = join(homedir(), '.dsh', '.agent-presets', 'tavern-state.json')
      if (!existsSync(p)) return null
      const obj = JSON.parse(readFileSync(p, 'utf8'))
      tavernStateCache = obj && typeof obj === 'object' ? obj : null
      tavernStateCacheAt = Date.now()
      return tavernStateCache
    } catch (e) { return null }
  }
  function normPathCmp(p) {
    if (typeof p !== 'string' || p === '') return ''
    return p.replace(/[\\/]+$/, '').toLowerCase()
  }
  function looksLikeTavernAgent(obj) {
    try {
      const agent = obj && typeof obj === 'object' ? obj.agent : null
      if (!agent || typeof agent !== 'object') return false
      const session = agent.session
      const h = session && typeof session === 'object' && session.header && typeof session.header === 'object' ? session.header : {}
      if (h.origin === 'subagent') return false // 子代理另算
      const st = readTavernState()
      if (!st || typeof st !== 'object') return false // 读不到 = 不是酒馆(保守)
      if (st.mode === 'bypass') return false // 面板全注入模式:宁漏报、不误伤
      const sid = typeof agent.id === 'string' ? agent.id : (typeof h.id === 'string' ? h.id : '')
      if (Array.isArray(st.allowSessions) && sid !== '' && st.allowSessions.indexOf(sid) >= 0) return true
      const cwd = normPathCmp(typeof h.cwd === 'string' ? h.cwd : '')
      if (cwd !== '' && Array.isArray(st.allowCwds)) {
        for (const p of st.allowCwds) {
          const np = normPathCmp(p)
          if (np !== '' && (cwd === np || cwd.indexOf(np + '\\') === 0)) return true
        }
      }
      return false
    } catch (e) { return false }
  }
  async function resolveTitle(agentObj, fallback) {
    try {
      const st = ctx.get('sessionTitle')
      if (st && typeof st.get === 'function' && agentObj && typeof agentObj === 'object') {
        const candidates = [agentObj, agentObj.session, agentObj.agent]
        for (const c of candidates) {
          if (!c || typeof c !== 'object') continue
          try {
            const snap = st.get(c)
            const t = pickFirst(snap, ['title', 'name', 'text'])
            if (typeof t === 'string' && t) return t
          } catch (e) { /* try next */ }
        }
      }
      const sq = ctx.get('sessionQuery')
      const sid = sessionIdOf(agentObj)
      if (sq && typeof sq.readTitle === 'function' && typeof sid === 'string' && sid !== '') {
        try {
          const snap = await Promise.race([
            sq.readTitle(sid),
            new Promise((resolve) => { setTimeout(() => resolve(null), 3000) }),
          ])
          const t = pickFirst(snap, ['title', 'name', 'text'])
          if (typeof t === 'string' && t) return t
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    return fallback
  }
  async function flushPendingCompletion(sid) {
    const p = pendingBySession.get(sid)
    if (p === undefined) return
    pendingBySession.delete(sid)
    const timer = pendingTimers.get(sid)
    if (timer !== undefined) { clearTimeout(timer); pendingTimers.delete(sid) }
    const title = await resolveTitle(p.agent, '会话任务完成')
    const delta = takeDeltaFrom(taskStartBySession.get(sid))
    taskStartBySession.delete(sid)
    const cost = costOf(delta.input, delta.output, delta.cacheRead)
    pushNotice({
      id: ++state.taskDoneId, status: 'completed', kind: 'agent', title,
      inputTokens: delta.input, outputTokens: delta.output, cacheReadTokens: delta.cacheRead,
      costCny: Math.round(cost * 100000) / 100000,
      at: Date.now(), announceTurn: state.turnSeq, announcedAt: Date.now(), sessionId: sid,
    })
  }
  ctx.on('agent/status', (payload) => {
    try {
      if (!payload || !payload.agent) return
      // 窝 3:先酒馆(顶层会话,cwd/会话白名单判据),再子代理,最后主会话
      if (looksLikeTavernAgent(payload)) return
      // subagent 代理的忙/闲不弹通用完成通知(交给 subagent/end 的「子任务完成」)
      if (isSubagentAgent(payload)) return
      const sid = sessionIdOf(payload.agent)
      if (typeof sid !== 'string' || sid === '') return
      // 窝 4 根治:会话账本跟随「当前活跃会话」——切会话即切换,不再锁定首个会话
      // (账本本身按 sid 持久化,跨重启连续;主会话只用于「当前」显示)
      state.mainSessionId = sid
      log('agent/status ' + payload.status + ' ' + sid) // D1 诊断:确认 idle 是否送达
      if (payload.status !== 'idle') {
        if (!busySessions.has(sid)) {
          busySessions.add(sid)
          state.turnSeq += 1
          taskStartBySession.set(sid, usageSnapshot())
        }
        lastAgentBusy = true
        // 该会话新任务启动:丢弃它未宣布的完成通知
        if (pendingBySession.has(sid)) {
          pendingBySession.delete(sid)
          const t = pendingTimers.get(sid)
          if (t !== undefined) { clearTimeout(t); pendingTimers.delete(sid) }
        }
        return
      }
      if (!busySessions.has(sid)) return
      busySessions.delete(sid)
      if (busySessions.size === 0) lastAgentBusy = false
      pendingBySession.set(sid, { at: Date.now(), agent: payload.agent })
      const prev = pendingTimers.get(sid)
      if (prev !== undefined) clearTimeout(prev)
      pendingTimers.set(sid, setTimeout(() => { flushPendingCompletion(sid).catch(() => {}) }, 3000))
    } catch (e) { /* ignore */ }
  }, { global: true })
  ctx.on('agent/error', (payload) => {
    try {
      if (!payload || !payload.agent) return
      if (looksLikeTavernAgent(payload)) return // 窝 3:酒馆错误同样不弹
      if (isSubagentAgent(payload)) return
      const sid = sessionIdOf(payload.agent)
      const m = payload.error && payload.error.message ? String(payload.error.message).slice(0, 40) : '会话任务失败'
      resolveTitle(payload.agent, m).then((title) => {
        const delta = takeDeltaFrom(taskStartBySession.get(sid))
        const cost = costOf(delta.input, delta.output, delta.cacheRead)
        pushNotice({
          id: ++state.taskDoneId, status: 'failed', kind: 'agent', title,
          inputTokens: delta.input, outputTokens: delta.output, cacheReadTokens: delta.cacheRead,
          costCny: Math.round(cost * 100000) / 100000,
          at: Date.now(), announceTurn: state.turnSeq, announcedAt: Date.now(), sessionId: typeof sid === 'string' ? sid : '',
        })
      }).catch(() => {})
    } catch (e) { /* ignore */ }
  }, { global: true })
  ctx.on('approval/request', (req, next) => {
    try {
      // 0.1.5:approval/request 按 agent 作用域派发(scopeTarget(req.agent)),普通监听被 scope 过滤器滤掉 ⇒ 加 global
      // 修复(2026-09-16 公司机实测:审批无文字无语音,根因即此)
      log('approval/request seen (payload keys: ' + Object.keys(req || {}).join(',') + ')')
      // D1 止血(2026-09-14 真机验收):同 turn 判定从全局 turnSeq 计数改为 30 秒时间窗——
      // turnSeq 曾因 agent/status 的 idle 未送达而卡死,导致审批被恒抑制
      const lastItem = state.taskQueue.length > 0 ? state.taskQueue[state.taskQueue.length - 1] : null
      const sameTurnNeedsHelp = lastItem !== null && lastItem.status === 'needs_help' &&
        typeof lastItem.announcedAt === 'number' && (Date.now() - lastItem.announcedAt) < 30000
      if (!sameTurnNeedsHelp) {
        const tool = pickFirst(req, ['toolName', 'tool', 'name', 'operation'])
        const title = typeof tool === 'string' && tool !== '' ? '等待审批：' + String(tool).slice(0, 30) : '等待审批'
        pushNotice({ id: ++state.taskDoneId, status: 'approval', kind: 'task', title, costCny: 0, at: Date.now(), announceTurn: state.turnSeq, announcedAt: Date.now() })
      }
    } catch (e) { /* ignore */ }
    return next()
  }, { global: true, prepend: true })
  // ---------- 需要协助(提问)通知 ----------
  // 注意:tools/pre-execute 是 waterfall,必须调用 next() 放行,否则工具执行会被挂起
  function extractQuestionText(exec) {
    if (!exec || typeof exec !== 'object') return null
    const args = pickFirst(exec, ['arguments', 'args', 'input', 'params'])
    if (args && typeof args === 'object') {
      const q = pickFirst(args, ['question', 'text', 'message', 'query', 'prompt', 'title'])
      if (typeof q === 'string' && q !== '') return q
      const list = pickFirst(args, ['questions', 'items', 'list'])
      if (Array.isArray(list) && list.length > 0 && list[0] && typeof list[0] === 'object') {
        const q2 = pickFirst(list[0], ['question', 'text', 'message', 'query', 'prompt', 'title'])
        if (typeof q2 === 'string' && q2 !== '') return q2
      }
    }
    return pickFirst(exec, ['question', 'text', 'prompt', 'query'])
  }
  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      const name = pickFirst(exec, ['name', 'toolName', 'tool'])
      const tname = typeof name === 'string' ? name.toLowerCase() : ''
      if (tname.indexOf('question') >= 0 || tname.indexOf('ask_user') >= 0 || tname.indexOf('askuser') >= 0) {
        const q = extractQuestionText(exec)
        const title = typeof q === 'string' && q !== '' ? '提问：' + q.slice(0, 24) : '需要协助' // D2:正文截断,防气泡爆宽
        pushNotice({ id: ++state.taskDoneId, status: 'needs_help', kind: 'task', title, costCny: 0, at: Date.now(), announceTurn: state.turnSeq, announcedAt: Date.now() })
      }
    } catch (e) { /* ignore */ }
    return next()
  }, { global: true, prepend: true })

  // ---------- subagent / workflow 完成通知 ----------
  function classifyStatus(v) {
    const s = String(v || '').toLowerCase()
    if (s.indexOf('fail') >= 0 || s.indexOf('error') >= 0) return 'failed'
    if (s.indexOf('cancel') >= 0 || s.indexOf('kill') >= 0 || s.indexOf('abort') >= 0) return null
    if (s.indexOf('interrupt') >= 0 || s.indexOf('stop') >= 0) return 'interrupted'
    return 'completed'
  }
  function classifyJob(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null
    const raw = String(pickFirst(snapshot, ['status', 'state', 'result']) || '').toLowerCase()
    if (raw === '' || raw.indexOf('run') >= 0 || raw.indexOf('start') >= 0 || raw.indexOf('pend') >= 0 || raw.indexOf('active') >= 0 || raw.indexOf('queue') >= 0) return null
    const st = classifyStatus(raw)
    if (st === null) return null
    if (st === 'failed' || st === 'interrupted') return st
    const finishedAt = pickFirst(snapshot, ['finishedAt', 'endedAt', 'endTime', 'completedAt'])
    const detail = String(pickFirst(snapshot, ['detail', 'error']) || '')
    const looksFinished = (typeof finishedAt === 'number' && finishedAt > 0) || detail.indexOf('exit code') >= 0 || raw === 'done' || raw === 'success'
    if (!looksFinished) return null
    const m = detail.match(/exit code:\s*(-?\d+)/)
    if (m !== null && parseInt(m[1], 10) !== 0) return 'failed'
    return 'completed'
  }
  const usageCheckpoints = new Map()
  function runKeyOf(payload) {
    // checkpoint 键优先取 runId/workflowId 等稳定 id(sessionIdOf 不读这些字段,会导致 delta 恒 0)
    const k = pickFirst(payload, ['runId', 'workflowId', 'jobId', 'subagentId', 'taskId'])
    if (typeof k === 'string' && k !== '') return k
    const sid = sessionIdOf(payload)
    if (typeof sid === 'string' && sid !== '') return sid
    return null
  }
  function usageSnapshot() {
    return { input: state.usage.inputTokens, output: state.usage.outputTokens, cacheRead: state.usage.cacheReadTokens }
  }
  function takeDeltaFrom(cp) {
    const now = usageSnapshot()
    if (cp && typeof cp.input === 'number' && typeof cp.output === 'number') {
      return {
        input: Math.max(0, now.input - cp.input),
        output: Math.max(0, now.output - cp.output),
        cacheRead: Math.max(0, now.cacheRead - (typeof cp.cacheRead === 'number' ? cp.cacheRead : 0)),
      }
    }
    return { input: 0, output: 0, cacheRead: 0 }
  }
  function announceChildDone(kind, payload) {
    try {
      const id = runKeyOf(payload) || (kind + '-' + Date.now())
      const cp = usageCheckpoints.get(id)
      const delta = takeDeltaFrom(cp)
      const cost = costOf(delta.input, delta.output, delta.cacheRead)
      const raw = String(pickFirst(payload, ['status', 'state', 'result', 'outcome']) || 'completed')
      const st = classifyStatus(raw)
      usageCheckpoints.delete(id)
      if (st === null) return // cancel/kill/abort:静默跳过,与旧版一致
      const label = kind === 'subagent' ? '子任务' : kind === 'workflow' ? '工作流' : kind
      const title = label + (st === 'completed' ? '完成' : st === 'failed' ? '失败' : '中断')
      const sid = sessionIdOf(payload) || sessionIdOf(payload && typeof payload === 'object' ? payload.agent : null)
      pushNotice({
        id: ++state.taskDoneId, status: st, kind, title,
        inputTokens: delta.input, outputTokens: delta.output, cacheReadTokens: delta.cacheRead,
        costCny: Math.round(cost * 100000) / 100000,
        at: Date.now(), announceTurn: state.turnSeq, announcedAt: Date.now(),
        sessionId: typeof sid === 'string' ? sid : '',
      })
    } catch (e) { /* ignore */ }
  }
  ctx.on('subagent/start', (payload) => {
    try {
      const id = runKeyOf(payload) || ('sub-' + Date.now())
      usageCheckpoints.set(id, usageSnapshot())
    } catch (e) { /* ignore */ }
  }, { global: true })
  ctx.on('subagent/end', (payload) => { announceChildDone('subagent', payload) }, { global: true })
  ctx.on('workflow/start', (payload) => {
    try {
      const id = runKeyOf(payload) || ('wf-' + Date.now())
      usageCheckpoints.set(id, usageSnapshot())
    } catch (e) { /* ignore */ }
  })
  // workflow/end 签名:(info, result)——状态在 result 里
  ctx.on('workflow/end', (info, result) => {
    announceChildDone('workflow', result && typeof result === 'object' ? Object.assign({}, info || {}, result) : info)
  })

  // ---------- 后台任务(jobs)完成通知 ----------
  const jobDoneIds = new Set()
  const jobListenerDisposers = []
  try {
    const jobsSvc = ctx.get('jobs')
    if (jobsSvc && typeof jobsSvc.onJobDone === 'function') {
      const jd = jobsSvc.onJobDone((snapshot) => {
        try {
          const cmd = String(pickFirst(snapshot, ['commandLine', 'command', 'cmd', 'argv']) || '')
          if (/whale-pet\.ps1|\.whale-pet|WhalePet|Launch pet/i.test(cmd)) return // 过滤桌宠自身进程
          if (snapshot.reported === true) return // 窝 5:宿主判重位,已上报的抑制冗余通知
          const id = pickFirst(snapshot, ['id', 'jobId', 'key'])
          if (typeof id === 'string' && id !== '') {
            if (jobDoneIds.has(id)) return
            jobDoneIds.add(id)
          }
          const st = classifyJob(snapshot)
          if (st === null) return
          // 窝 5 根治:后台任务「完成」不再提示——此刻 AI 已被唤醒开始干活,提示纯属噪音
          // (联动监听任务、体检脚本等全部适用);失败/中断保留提示作安全网(失败的监听
          // 意味着没人被唤醒,反而需要叫一声)。
          if (st === 'completed') return
          const label = String(pickFirst(snapshot, ['label', 'title', 'name']) || '')
          const title = label !== '' ? label.slice(0, 24) : (st === 'failed' ? '后台任务失败' : '后台任务中断')
          pushNotice({
            id: ++state.taskDoneId, status: st, kind: 'job', title,
            inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
            costCny: 0, at: Date.now(), announceTurn: state.turnSeq, announcedAt: Date.now(),
          })
        } catch (e) { /* ignore */ }
      })
      jobListenerDisposers.push(() => { try { jd() } catch (e) { /* ignore */ } })
    }
  } catch (e) { /* ignore */ }

  // ---------- 生命周期 ----------
  const disposers = []
  ctx.effect(() => {
    const cmdTimer = setInterval(async () => {
      try {
        tickDisplay()
        if (!existsSync(CMD_PATH)) return
        const text = readFileSync(CMD_PATH, 'utf8').trim()
        if (text === '' || text === '{}') return
        const cmd = JSON.parse(text)
        if (cmd && cmd.action === 'pet-closing') {
          // D10 cmd 兜底(HTTP 被挡时 3s 内生效)
          state.petAlive = false
          lastPetKillAt = Date.now()
          writeDesktopState().catch(() => {})
        }
        if (cmd && cmd.action === 'refresh') { fetchBalance().catch(() => {}); checkPetHeartbeat() } // D8-b:刷新同时纠正桌宠存活状态
        if (cmd && cmd.action === 'dismissLowBalance') {
          state.lowBalance.active = false
          state.lowBalance.version += 1
          writeDesktopState().catch(() => {})
        }
        if (cmd && cmd.action === 'topup-qr') { ensureTopupQrPng().catch(() => {}) }
        if (cmd && cmd.action === 'display-ack') {
          const v = cmd.value && typeof cmd.value === 'object' ? cmd.value : {}
          ackDisplay(typeof v.seq === 'number' ? v.seq : -1, typeof v.kind === 'string' ? v.kind : 'seen')
        }
        writeFileSync(CMD_PATH, '{}', 'utf8')
      } catch (e) { /* ignore */ }
    }, 3000)
    disposers.push(() => clearInterval(cmdTimer))
    // 展示过期 tick 收到 1s(妹妹实测 3s tick 会让通知多留 1.1~3s)
    const displayTimer = setInterval(() => { tickDisplay() }, 1000)
    disposers.push(() => clearInterval(displayTimer))

    const balTimer = setInterval(() => {
      fetchBalance().catch(() => {})
      fetchRealMonthlyCost().catch(() => {})
    }, 5 * 60 * 1000)
    disposers.push(() => clearInterval(balTimer))

    // 桌宠心跳:桌面宠每 2 秒写心跳文件;10 秒没有心跳说明已被用户关闭,
    // 立即把发声权还给浏览器(否则浏览器会因为 voiceEngine='pet' 而静音)
    function checkPetHeartbeat() {
      try {
        const hbPath = join(DATA_DIR, 'whale-pet-heartbeat.txt')
        let alive = false
        if (existsSync(hbPath)) {
          const t = parseInt(readFileSync(hbPath, 'utf8').trim(), 10)
          alive = isFinite(t) && Date.now() - t < 6000 // D8-a:心跳窗口 10s→6s,关宠后更快交还发声权
        }
        // 启动宽限:拉起后 15 秒内不因心跳缺失判定死亡(宠物启动+首次心跳需要时间)
        if (!alive && Date.now() - lastPetLaunchAt < 15000) alive = true
        // 关闭宽限:显式 kill 后 6 秒内不因旧心跳残留判定存活(防止关掉又"复活");
        // D11:15s→6s,与心跳窗口对齐(过长会连坐新拉起的桌宠;D10 主动告知已兜底主路径)
        if (alive && Date.now() - lastPetKillAt < 6000) alive = false
        if (alive !== state.petAlive) {
          state.petAlive = alive
          log('pet alive -> ' + alive)
          writeDesktopState().catch(() => {})
        }
      } catch (e) { /* ignore */ }
    }
    const hbTimer = setInterval(checkPetHeartbeat, 5000)
    disposers.push(() => clearInterval(hbTimer))

    let petTimer = null
    if (conf.autoLaunchDesktopPet === true && state.settings.autoLaunchPet !== false) {
      petTimer = setTimeout(() => { launchDesktopPet().catch(() => {}) }, 3000)
      disposers.push(() => clearTimeout(petTimer))
    }

    return () => {
      for (const d of disposers.splice(0)) { try { d() } catch (e) { /* ignore */ } }
      for (const d of jobListenerDisposers.splice(0)) { try { d() } catch (e) { /* ignore */ } }
      killDesktopPet().catch(() => {})
    }
  })

  // ---------- 用量统计(llm/stream 水线) ----------
  ctx.on('llm/stream', (options, next) => {
    // 流一开始就取消所有 3s 兜底定时器:总结流长于 3s 时不能让定时器提前弹「完成」,
    // 统一等 finally 冲刷(feedback-plan 第 2 项修过的 bug,按会话 Map 重构时不能丢)
    for (const t of pendingTimers.values()) clearTimeout(t)
    pendingTimers.clear()
    const upstream = next()
    return (async function* () {
      try {
        for await (const chunk of upstream) {
          try {
            const u = extractUsage(chunk)
            if (u !== null) {
              state.usage.calls += 1
              state.usage.inputTokens += u.input
              state.usage.outputTokens += u.output
              state.usage.cacheReadTokens += u.cacheRead
              state.usage.cacheWriteTokens += u.cacheWrite
              ensureMonthRollover()
              state.monthlyUsage.calls += 1
              state.monthlyUsage.inputTokens += u.input
              state.monthlyUsage.outputTokens += u.output
              state.monthlyUsage.cacheReadTokens += u.cacheRead
              state.monthlyUsage.cacheWriteTokens += u.cacheWrite
              state.monthlyUsage.costCny = Math.round((state.monthlyUsage.costCny + costOf(u.input, u.output, u.cacheRead, u.cacheWrite)) * 100000) / 100000
              // D13-②:用量归属到真正的发起者(currentInitiator),mainSessionId 只作兜底
              let asid = state.mainSessionId
              try {
                const ag2 = ctx.get('agents')
                const init = ag2 && typeof ag2.currentInitiator === 'function' ? ag2.currentInitiator() : null
                const sid2 = init ? sessionIdOf(init) : null
                if (typeof sid2 === 'string' && sid2 !== '') asid = sid2
              } catch (e) { /* ignore */ }
              if (asid !== '') {
                let se = state.sessionCosts.get(asid)
                if (se === undefined) {
                  se = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costCny: 0 }
                  state.sessionCosts.set(asid, se)
                }
                se.inputTokens += u.input
                se.outputTokens += u.output
                se.cacheReadTokens += u.cacheRead
                se.cacheWriteTokens = (se.cacheWriteTokens || 0) + u.cacheWrite
                se.costCny = Math.round((se.costCny + costOf(u.input, u.output, u.cacheRead, u.cacheWrite)) * 100000) / 100000
              }
              schedulePersistCosts()
              scheduleDesktopStateWrite(false)
            }
            const m = pickFirst(options, ['model', 'modelId'])
            if (typeof m === 'string') state.usage.lastModel = m
          } catch (e) { /* never break the model stream */ }
          yield chunk
        }
      } finally {
        // 总结流结束:若有待宣布的完成通知,此刻宣布(不打断总结)
        for (const sid of Array.from(pendingBySession.keys())) flushPendingCompletion(sid).catch(() => {})
      }
    })()
  }, { prepend: true })

  // ---------- 启动:恢复持久化数据 ----------
  loadSettings()
  restoreUsage()
  restoreMonthlyUsage()
  ensureMonthRollover()
  restoreSessionCosts()
  restoreBalanceStart()
  restoreRealMonthlyCost()
  restoreTaskQueue()
  try {
    const agentsSvc = ctx.get('agents')
    const init = agentsSvc && typeof agentsSvc.currentInitiator === 'function' ? agentsSvc.currentInitiator() : null
    const sid = init ? sessionIdOf(init) : null
    // 仅在账本为空时取当前会话;恢复出的历史账本保持连续累加
    if (state.mainSessionId === '' && typeof sid === 'string' && sid !== '') state.mainSessionId = sid
  } catch (e) { /* ignore */ }

  fetchBalance().catch(() => {})
  log('dsh-whale-pet applied, dataDir=' + DATA_DIR)
}

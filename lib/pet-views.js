/**
 * pet-views.js —— 桌面宠渲染层(家机/妹妹 所有,2026-09-14)
 *
 * 职责(全部是「桌面宠侧」,不碰宿主逻辑):
 *   ① 统一展示调度器**渲染端**:把宿主 `display` 归一成 `$cur`(当前展示),老 `notice`/`speech` 走降级兼容;
 *   ② 四类展示的版式:notice / line / headpat / lowbalance;
 *   ③ 木牌第三页「效率页」(`efficiency` 字段);
 *   ④ 三态翻页按钮 + 「知道了」回传 ack。
 *
 * 设计约定
 *   - 零依赖、纯函数、只返回 PowerShell 文本(便于 `lib/index.js` 的模板串接线与单测字符串断言);
 *   - 全部为 **PowerShell 5.1 兼容**(不用 `??`/三元/`-notin` 之外的语法糖);
 *   - 跨帧共享状态**必须** `$script:` 前缀(历史踩过:裸变量写在函数里 = 每帧重来,语音重复播);
 *   - `display` 缺失时**自动降级**到老字段 ⇒ apply 前后都不会白屏(公司机五窝未收工时也能独立冒烟)。
 *
 * 期待宿主的字段(接口约定 v1 + v1.1 增补):
 *   display = { seq, current: { seq, kind, priority, text, speech?, displayMs?, untilAt } | null, queueLen }
 *   efficiency = { ttftMs, tokensPerSec, cacheHitPct, rounds, steps, llmMs, toolMs,
 *                  sessionTokens:{input,output,cacheRead,cacheWrite}, remark } | null
 */

export const PET_VIEWS_VERSION = 'v1.0.4-petviews.3'

/** 视图循环顺序(balance → usage → efficiency → balance) */
export const VIEW_CYCLE = ['balance', 'usage', 'efficiency']

/** 效率页中文兜底文案(宿主 `labels` 缺字段时用)
 *  ⚠️ 长度约束:标签要塞进 New-Row 的 66px 标签列(无 TextTrimming ⇒ 超长硬切),
 *     中文标签**别超过 5 个汉字**、中英混排别超过约 57px。2026-09-15 被「会话 tokens 入/出」坑过一次。 */
export const EFFICIENCY_LABELS = {
  title: '效率',
  rowTokens: '会话 tokens',
  rowCacheHit: '缓存命中',
  rowCacheMiss: '缓存未命中',
  empty: '本会话暂无数据',
}

/**
 * ① 新增的 `$script:` 状态 —— **必须**接在模板 L181–192 那一区(现有 `$script:*` 状态区)之后。
 *    不要写进 `Update-UI` 里面,否则每帧重来 → 语音每 2 秒重播一次(历史 bug)。
 */
export function psStateInit() {
  return `$script:curKey = ''
$script:seenKey = ''
$script:dismissedKey = ''
$script:ackedKey = ''
$script:lastSpokenFp = ''
$script:curSeq = 0
$script:winH = 340
$script:imgMode = 'skin'
$script:skinSrc = $null
`
}

/** PowerShell 小工具:时间/数值格式化(空值一律「—」,不显示 NaN) */
export function psHelpers() {
  return `function Fmt-Ms($v) {
  if ($v -eq $null) { return '—' }
  $n = 0.0
  try { $n = [double]$v } catch { return '—' }
  if ($n -le 0) { return '—' }
  if ($n -ge 1000) { return ([string][math]::Round($n / 1000.0, 2) + ' s') }
  return ([string][math]::Round($n, 0) + ' ms')
}
function Fmt-Num($v, $unit) {
  if ($v -eq $null) { return '—' }
  $n = 0.0
  try { $n = [double]$v } catch { return '—' }
  if ($n -eq 0 -and $unit -eq '') { return '—' }
  $t = [string][math]::Round($n, ($(if ([math]::Abs($n) -ge 100) { 0 } else { 1 })))
  if ($unit -ne '') { return ($t + ' ' + $unit) }
  return $t
}
function Fmt-Pct($v) {
  if ($v -eq $null) { return '—' }
  $n = 0.0
  try { $n = [double]$v } catch { return '—' }
  return ([string][math]::Round($n, 1) + '%')
}
function Fmt-Big($v) {
  if ($v -eq $null) { return '—' }
  $n = 0.0
  try { $n = [double]$v } catch { return '—' }
  if ($n -ge 1000000) { return ([string][math]::Round($n / 1000000.0, 2) + 'M') }
  if ($n -ge 1000) { return ([string][math]::Round($n / 1000.0, 1) + 'k') }
  return [string][math]::Round($n, 0)
}
function Lbl-Or($v, $fallback) {
  if ($v -eq $null) { return $fallback }
  if ([string]$v -eq '') { return $fallback }
  return [string]$v
}
function Close-Pet {
  # D10(2026-09-14 家机真机实测):关窗时**主动告知宿主**,别让宿主数心跳去猜。
  # 原实现只一句 $win.Close():宿主只能等心跳超时发现(6s 窗口 + 5s 轮询 ⇒ 实测约 9 秒),
  # 这期间 voiceEngine 仍是 'pet' ⇒ 浏览器不发声、桌面宠又已关 ⇒ 两边同时哑(静音窗口)。
  # 双保险:①HTTP 直告(宿主 /pet-closing 路由 ⇒ 立即);②写 cmd 兜底(3s 轮询,兼容旧宿主)。
  try { Write-Cmd 'pet-closing' } catch { }
  try {
    Invoke-RestMethod -Uri 'http://127.0.0.1:3080/api/dsh-whale-pet/pet-closing' -Method Post -Body '{}' -ContentType 'application/json' -TimeoutSec 2 | Out-Null
  } catch { }
  $win.Close()
}
function Send-Ack($seq, $kind) {
  try {
    if ($seq -eq $null) { return }
    $n = [long]$seq
    if ($n -le 0) { return }
    if ($script:ackedKey -eq ([string]$kind + ':' + [string]$n)) { return }
    $script:ackedKey = [string]$kind + ':' + [string]$n
    Write-Cmd 'display-ack' @{ seq = $n; kind = [string]$kind }
  } catch { }
}
function Set-WinHeight($h) {
  try { if ($null -ne $win -and [double]$win.Height -ne [double]$h) { $win.Height = [double]$h } } catch { }
}
function Set-ImgQr($path) {
  # 充值二维码复用「皮肤那张图」的位置(不新增控件 ⇒ 不动 lib/index.js 的视觉树)
  try {
    if ($script:skinSrc -eq $null) { $script:skinSrc = $img.Source }
    if ($path -ne $null -and $path -ne '' -and (Test-Path $path)) {
      if ($script:imgMode -ne 'qr') {
        $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
        $bmp.BeginInit()
        $bmp.CacheOption = 'OnLoad'
        $bmp.UriSource = [Uri]$path
        $bmp.EndInit()
        $img.Source = $bmp
        $script:imgMode = 'qr'
      }
    } elseif ($script:imgMode -eq 'qr') {
      $img.Source = $script:skinSrc
      $script:imgMode = 'skin'
    }
  } catch { }
}
`
}

/**
 * ② 展示仲裁:把 `display` / 老字段归一成
 *      $cur(当前展示对象或 $null)、$curKind、$curSeq、$curUntil、$curKey
 *    规则:
 *      - display 可用 → 只用 display(宿主是唯一调度器,DND/优先级/排队都在宿主);
 *      - display 缺失/为空 → 降级:老 notice(6000ms 窗口 + DND 白名单)与 speech(expireAt)各自成一条;
 *      - 过期(untilAt)自动收;用户点过「知道了」的 key 不再显示。
 */
export function psResolveDisplay() {
  return `  $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $cur = $null
  $curKind = ''
  $curSeq = 0
  $curUntil = 0
  $curKey = ''
  $disp = $s.display
  if ($disp -ne $null -and $disp.current -ne $null -and [string]$disp.current.kind -ne '') {
    $cur = $disp.current
    $curKind = [string]$cur.kind
    if ($cur.seq -ne $null) { try { $curSeq = [long]$cur.seq } catch { $curSeq = 0 } }
    if ($cur.untilAt -ne $null) { try { $curUntil = [long]$cur.untilAt } catch { $curUntil = 0 } }
    if ($curUntil -le 0 -and $cur.displayMs -ne $null) {
      try { $ms = [long]$cur.displayMs; if ($ms -gt 0) { $curUntil = $nowMs + $ms } } catch { $curUntil = 0 }
    }
    # 身份键:优先 seq;没有 seq 就退化成 kind:文本哈希式的稳定串(弱,但不会每 2 秒重播)
    if ($curSeq -gt 0) { $curKey = $curKind + ':' + [string]$curSeq }
    else { $curKey = $curKind + ':' + [string]$curUntil + ':' + ([string]$cur.text).GetHashCode() }
    if ($curUntil -gt 0 -and $nowMs -gt $curUntil) { $cur = $null; $curKind = ''; $curKey = '' }
    if ($cur -ne $null -and $script:dismissedKey -ne '' -and $curKey -eq $script:dismissedKey) { $cur = $null; $curKind = ''; $curKey = '' }
  }
  # ---- 降级兼容:宿主还没落 display 字段时,用老 notice / speech 复原同样的语义 ----
  if ($cur -eq $null -and $disp -eq $null) {
    $noticeFresh = $false
    if ($s.notice -ne $null -and $s.notice.id -ne $null) {
      $nAt = 0
      try { $nAt = [long]$s.notice.at } catch { $nAt = 0 }
      if ($nAt -gt 0 -and ($nowMs - $nAt) -lt 6000) { $noticeFresh = $true }
    }
    if ($noticeFresh -and $s.dnd -eq $true) {
      $st2 = ''
      if ($s.notice -ne $null -and $s.notice.status -ne $null) { $st2 = [string]$s.notice.status }
      if ($st2 -notin @('approval', 'needs_help')) { $noticeFresh = $false }
    }
    if ($noticeFresh) {
      $cur = $s.notice
      $curKind = 'notice'
      try { $curSeq = [long]$s.notice.id } catch { $curSeq = 0 }
      try { $curUntil = [long]$s.notice.at + 6000 } catch { $curUntil = 0 }
      $curKey = 'notice:' + [string]$curSeq
      if ($script:dismissedKey -ne '' -and $curKey -eq $script:dismissedKey) { $cur = $null; $curKind = ''; $curKey = '' }
    }
  }
  if ($cur -eq $null -and $disp -eq $null) {
    if ($s.speech -ne $null -and [string]$s.speech.text -ne '') {
      $exp = 0
      try { $exp = [long]$s.speech.expireAt } catch { $exp = 0 }
      if ($exp -gt 0 -and $nowMs -lt $exp) {
        $tick = 0
        try { $tick = [long]$s.speech.audioTick } catch { $tick = 0 }
        $cur = $s.speech
        $curKind = 'line'
        $curSeq = $tick
        $curUntil = $exp
        $curKey = 'line:' + [string]$curSeq
        if ($script:dismissedKey -ne '' -and $curKey -eq $script:dismissedKey) { $cur = $null; $curKind = ''; $curKey = '' }
      }
    }
  }
  # D9(2026-09-14 家机真机复现):用户在**非余额页**(lb/lbopt/qr/usage/efficiency)时,
  # 低优先级展示(line/headpat)不得覆盖页面 —— 它们是"临时气泡",页面却是用户正在操作的东西。
  # (实测:点「去充值」进金额档位页后,一条随机台词盖了上去,直到台词过期才露出充值页。)
  # 通知类(notice/lowbalance)**仍可覆盖** —— 审批/提问/低余额是用户必须知道的。
  if ($cur -ne $null -and $script:view -ne 'balance' -and ($curKind -eq 'line' -or $curKind -eq 'headpat')) {
    $cur = $null; $curKind = ''; $curKey = ''
  }
  $script:curKey = $curKey
  $script:curSeq = $curSeq
`
}

/** ③ 展示版式 + 页面渲染(替换原 L304–386 的 if/elseif 链) */
export function psRenderViews() {
  return `  if ($cur -ne $null) {
    $curText = [string]$cur.text
    switch ($curKind) {
      'line' {
        $title.Text = Lbl-Or $s.labels.speechTitle '台词'
        $big.FontSize = 13
        $big.TextWrapping = 'Wrap'
        $big.Width = 196
        $big.Text = $curText
      }
      'headpat' {
        $title.Text = Lbl-Or $s.labels.patTitle '摸摸头'
        $big.FontSize = 13
        $big.TextWrapping = 'Wrap'
        $big.Width = 196
        $big.Text = $curText
      }
      'lowbalance' {
        $title.Text = Lbl-Or $s.labels.lowBalanceTitle '余额提醒'
        $big.FontSize = 14
        $big.TextWrapping = 'Wrap'
        $big.Width = 196
        $big.Text = $curText
        if ([string]$s.lowBalance.amountText -ne '' -and $curText -eq '') { $big.Text = [string]$s.lowBalance.amountText }
      }
      default {
        # notice:标题走 labels.noticeTitle[status],没有 status 就用展示自带标题
        $st = ''
        if ($cur.status -ne $null) { $st = [string]$cur.status }
        elseif ($s.notice -ne $null -and $s.notice.status -ne $null) { $st = [string]$s.notice.status }
        $nt = '通知'
        if ($st -ne '') {
          if ($s.labels.noticeTitle -ne $null) {
            try { $nt = [string]$s.labels.noticeTitle.($st) } catch { $nt = '通知' }
          }
        }
        $title.Text = $nt
        $big.FontSize = 14
        $big.TextWrapping = 'Wrap'
        $big.Width = 196
        $big.Text = $curText
        if ($s.notice -ne $null) {
          if ([string]$s.notice.cost -ne '') { [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowCost '消耗') ([string]$s.notice.cost))) }
          if ([string]$s.notice.in -ne '' -and [string]$s.notice.in -ne '0') { [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowIn '输入') ([string]$s.notice.in))) }
          if ([string]$s.notice.out -ne '' -and [string]$s.notice.out -ne '0') { [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowOut '输出') ([string]$s.notice.out))) }
          if ([string]$s.notice.cache -ne '' -and [string]$s.notice.cache -ne '0') { [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowCache '缓存') ([string]$s.notice.cache))) }
        }
      }
    }
    $isNoticeLike = ($curKind -eq 'notice' -or $curKind -eq 'lowbalance')
    if ($curKind -eq 'lowbalance') {
      [void]$btns.Children.Add((New-Btn (Lbl-Or $s.labels.btnCharge '去充值') { Set-View 'lbopt'; Update-UI }))
    }
    # D5-①(2026-09-14 家机真机验收):「知道了」只归通知类。
    # 台词/摸头是自动过期的气泡,挂按钮会让人以为必须点(实测:桌面宠摸头后停在那里等人点);
    # 浏览器宠同场景是纯气泡、4.5s 自动收 ⇒ 两条链路必须一致。
    if ($isNoticeLike) {
      [void]$btns.Children.Add((New-Btn '知道了' { $script:dismissedKey = $script:curKey; Send-Ack $script:curSeq 'dismiss'; $script:view = 'balance'; Update-UI }))
    }
    # ---- 发声闸门:同一身份键只播一次(替代老的 lastNoticeId / audioTick 判断)----
    if ($curKey -ne '' -and $curKey -ne $script:seenKey) {
      try { Add-Content -Path (Join-Path (Split-Path $statePath) 'pet-voice-debug.log') -Value ("GATE curKey=[" + $curKey + "] kind=" + $curKind + " engine=[" + [string]$s.voiceEngine + "] voiceEnabled=[" + [string]$s.voiceEnabled + "] dnd=[" + [string]$s.dnd + "] speech=[" + [string]$cur.speech + "]") -Encoding UTF8 } catch { }
      $script:seenKey = $curKey
      if ($s.voiceEngine -eq 'pet' -and $s.voiceEnabled -ne $false -and $s.dnd -ne $true) {
        $play = $null
        if ($isNoticeLike) {
          $stV = ''
          if ($cur.status -ne $null) { $stV = [string]$cur.status }
          elseif ($s.notice -ne $null -and $s.notice.status -ne $null) { $stV = [string]$s.notice.status }
          if ($stV -ne '' -and $noticeDir -ne '') {
            $cands = @()
            for ($i = 0; $i -lt 3; $i++) {
              $vp = Join-Path $noticeDir ('notice-' + $stV + '-' + $i + '.wav')
              if (Test-Path $vp) { $cands += $vp }
            }
            $vp0 = Join-Path $noticeDir ('notice-' + $stV + '.wav')
            if (Test-Path $vp0) { $cands += $vp0 }
            if ($cands.Count -gt 0) { $play = $cands[(Get-Random -Maximum $cands.Count)] }
          }
        } else {
          # D5-③(2026-09-14 家机真机验收):连播两句时会把**同一个固定文件**播两遍。
          # $speechWav 是「最近一次 TTS」的落地文件(宿主 index.js 写 whale-speech-last.wav),
          # 两次上屏的 curKey 不同 ⇒ 两道闸门都放行 ⇒ 听到的是同一句播两遍。
          # 修法(三级定位):
          #   ① 宿主直接给的路径($cur.speechWav)
          #   ② **自查 hash** —— 第四轮宿主已把 TTS 按内容落成
          #      <DATA_DIR>\speech\<sha256(text)[0:16]>.wav,渲染侧用同一约定自己算,
          #      就能定位到"这一句"的音频;天然不会张冠李戴,也不依赖时序
          #      (TTS 还没到位就是找不到 ⇒ 宁可不播,也不播错人的话)。
          #   ③ 老宿主兜底:全局 last.wav + 文本一致性校验 + 指纹去重
          $sw = ''
          if ($cur.speechWav -ne $null -and [string]$cur.speechWav -ne '') { $sw = [string]$cur.speechWav }
          if (($sw -eq '' -or -not (Test-Path $sw)) -and $cur.speech -ne $null) {
            $txtSp = [string]$cur.speech
            if ($txtSp -ne '') {
              try {
                $spDir = Join-Path (Split-Path $statePath) 'speech'
                if (Test-Path $spDir) {
                  $shaSp = [System.Security.Cryptography.SHA256]::Create()
                  $hexSp = (($shaSp.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($txtSp)) | ForEach-Object { $_.ToString('x2') }) -join '')
                  $candSp = Join-Path $spDir ($hexSp.Substring(0,16) + '.wav')
                  if (Test-Path $candSp) { $sw = $candSp }
                }
              } catch { }
            }
          }
          if ($sw -ne '' -and (Test-Path $sw)) {
            $play = $sw
            $script:lastSpokenFp = ''
          } elseif (Test-Path $speechWav) {
            # D6 止血(2026-09-14 家机真机复现):whale-speech-last.wav 是**全局单文件**,
            # 被**任何一次** TTS 覆盖 ⇒ 与当前展示项没有绑定关系,必然张冠李戴
            # (实测:气泡显示「诶嘿嘿~摸头杀~」,播出来的却是「再摸一下也没关系啦」)。
            # display 项自带 speech(这一条的文本),state.speech.text 是那个文件里那句的文本;
            # **两者一致才播**,不一致宁可不出声,也不播错人的话。
            # (根治已由第四轮「按内容 hash 落 wav」落地,即上面第 ② 级;本段只对**老宿主**生效)
            $curSpeech = ''
            if ($cur.speech -ne $null) { $curSpeech = [string]$cur.speech }
            $globSpeech = ''
            if ($s.speech -ne $null -and $s.speech.text -ne $null) { $globSpeech = [string]$s.speech.text }
            if ($curSpeech -ne '' -and $curSpeech -eq $globSpeech) { $play = $speechWav }
          }
        }
        if ($play -ne $null) {
          try { Add-Content -Path (Join-Path (Split-Path $statePath) 'pet-voice-debug.log') -Value ("PLAY file=[" + $play + "]") -Encoding UTF8 } catch { }
          if ($script:voicePlayer -ne $null) { try { $script:voicePlayer.Stop() } catch { } }
          $sp2 = New-Object System.Media.SoundPlayer($play)
          $sp2.Play()
          $script:voicePlayer = $sp2
        } else {
          try { Add-Content -Path (Join-Path (Split-Path $statePath) 'pet-voice-debug.log') -Value ("PLAY null (no candidate)") -Encoding UTF8 } catch { }
        }
      }
      Send-Ack $curSeq 'seen'
    }
  } elseif ($script:view -eq 'usage') {
    Set-WinHeight 340
    $title.Text = Lbl-Or $s.labels.titleUsage '用量'
    $big.Text = ''
    if ($s.tokens -ne $null) {
      [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowCalls '模型调用') ([string]$s.tokens.calls)))
      [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowIn '输入') ([string]$s.tokens.input)))
      [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowOut '输出') ([string]$s.tokens.output)))
      [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowCache '缓存') ([string]$s.tokens.cacheRead)))
    }
  } elseif ($script:view -eq 'efficiency') {
    Set-WinHeight 340
    $title.Text = Lbl-Or $s.labels.titleEfficiency '效率'
    $big.Text = ''
    $ef = $s.efficiency
    if ($ef -eq $null) {
      $big.FontSize = 13
      $big.TextWrapping = 'Wrap'
      $big.Width = 196
      $big.Text = Lbl-Or $s.labels.efficiencyEmpty '本会话暂无数据'
    } else {
      # 2026-09-14 主人口径:效率页**只留 tokens 与缓存两项**。
      # 原七项(首字延迟/出字速度/缓存命中/轮次/步数/模型耗时/工具耗时)宿主并未采集,恒为「—」,
      # 而且这些指标在会话里本就清晰可见 ⇒ 从桌宠上撤掉。
      # 缓存那行改为「命中/未命中」:DSH 的 TokenUsage 里 inputTokens=未缓存输入、cacheReadTokens=命中,
      # 二者互不重叠;而 cacheWriteTokens 在 DeepSeek 计价模型下恒为 0(未命中按普通输入计费),故不展示。
      if ($ef.sessionTokens -ne $null) {
        # ⚠️ 标签必须塞进 New-Row 的 **66px 标签列**,而该列**没有 TextTrimming** ⇒ 超长是硬切。
        #    实测(2026-09-15):「会话 tokens 入/出」≈91px、「缓存 命中/未命中」≈82px 都会被切掉一截。
        #    ⇒ 限定词从标签挪到数值,拆成三行短标签(最长「缓存未命中」≈52px),全部塞得进。
        $si = 0
        try { $si = [long]$ef.sessionTokens.input } catch { $si = 0 }
        $sr = 0
        try { $sr = [long]$ef.sessionTokens.cacheRead } catch { $sr = 0 }
        $tkIn = (Fmt-Big ($si + $sr)) + ' / ' + (Fmt-Big $ef.sessionTokens.output)
        [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowTokens '会话 tokens') $tkIn))
        [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowCacheHit '缓存命中') (Fmt-Big $sr)))
        [void]$rows.Children.Add((New-Row (Lbl-Or $s.labels.rowCacheMiss '缓存未命中') (Fmt-Big $si)))
      }
      if ([string]$ef.remark -ne '') {
        $rm = New-Object System.Windows.Controls.TextBlock
        $rm.Text = [string]$ef.remark
        $rm.FontSize = 9
        $rm.TextWrapping = 'Wrap'
        $rm.Width = 196
        $rm.TextAlignment = 'Center'
        $rm.Margin = New-Object System.Windows.Thickness(0, 4, 0, 0)
        $rm.Foreground = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#5B7395')))
        [void]$rows.Children.Add($rm)
      }
    }
  } elseif ($script:view -eq 'lb') {
    Set-WinHeight 340
    Set-ImgQr ''
    $title.Text = Lbl-Or $s.labels.titleLow '余额不足'
    $big.FontSize = 20
    if ([string]$s.lowBalance.amountText -ne '') { $big.Text = [string]$s.lowBalance.amountText } else { $big.Text = [string]$s.balanceText }
    $warn = New-Object System.Windows.Controls.TextBlock
    $warn.Text = Lbl-Or $s.labels.lbWarn '余额偏低,建议及时充值,以免任务中断。'
    $warn.FontSize = 10.5
    $warn.TextWrapping = 'Wrap'
    $warn.Width = 196
    $warn.TextAlignment = 'Center'
    $warn.Margin = New-Object System.Windows.Thickness(0, 4, 0, 0)
    $warn.Foreground = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#C0392B')))
    [void]$rows.Children.Add($warn)
    [void]$btns.Children.Add((New-Btn (Lbl-Or $s.labels.btnCharge '去充值') { Set-View 'lbopt'; Update-UI }))
    [void]$btns.Children.Add((New-Btn (Lbl-Or $s.labels.btnLater '稍后') { Write-Cmd 'dismissLowBalance'; Set-View 'balance'; Update-UI }))
  } elseif ($script:view -eq 'lbopt') {
    Set-WinHeight 340
    Set-ImgQr ''
    $title.Text = Lbl-Or $s.labels.titleOptions '选择充值金额'
    $big.FontSize = 13
    $big.TextWrapping = 'Wrap'
    $big.Width = 196
    $big.Text = Lbl-Or $s.labels.optHint '充值后余额立即到账'
    $opts = @(10, 50, 100)
    if ($s.topupOptions -ne $null) {
      $tmp = @()
      foreach ($o in $s.topupOptions) { try { $tmp += [int]$o } catch { } }
      if ($tmp.Count -gt 0) { $opts = $tmp }
    }
    foreach ($amt in $opts) {
      $optSb = [scriptblock]::Create('Write-Cmd ''topup-qr'' @{ amount = ' + [string]([int]$amt) + ' }; Set-View ''qr''; Update-UI')
      [void]$btns.Children.Add((New-Btn ('¥' + [string]([int]$amt)) $optSb))
    }
    [void]$btns.Children.Add((New-Btn (Lbl-Or $s.labels.btnBack '返回') { Set-View 'lb'; Update-UI }))
  } elseif ($script:view -eq 'qr') {
    Set-WinHeight 400
    $title.Text = Lbl-Or $s.labels.titleQr '充值二维码'
    $qrPath = ''
    if ($s.topupQrPath -ne $null) { $qrPath = [string]$s.topupQrPath }
    elseif ($s.lowBalance -ne $null -and $s.lowBalance.qrPath -ne $null) { $qrPath = [string]$s.lowBalance.qrPath }
    Set-ImgQr $qrPath
    $big.FontSize = 12
    $big.TextWrapping = 'Wrap'
    $big.Width = 196
    if ($qrPath -ne '' -and (Test-Path $qrPath)) { $big.Text = Lbl-Or $s.labels.qrHint '扫码即可充值' }
    else { $big.Text = Lbl-Or $s.labels.qrLoading '二维码生成中…(也可在浏览器木牌完成充值)' }
    $siteText = ''
    if ($s.topupSite -ne $null) { $siteText = [string]$s.topupSite } else { $siteText = Lbl-Or $s.labels.qrSite '' }
    if ([string]$siteText -ne '') {
      $st2 = New-Object System.Windows.Controls.TextBlock
      $st2.Text = [string]$siteText
      $st2.FontSize = 9
      $st2.TextAlignment = 'Center'
      $st2.Foreground = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#5B7395')))
      [void]$rows.Children.Add($st2)
    }
    [void]$btns.Children.Add((New-Btn (Lbl-Or $s.labels.btnQrRefresh '刷新二维码') { Write-Cmd 'topup-qr' @{ amount = 0 }; Update-UI }))
    [void]$btns.Children.Add((New-Btn (Lbl-Or $s.labels.btnBack '返回') { Set-View 'lb'; Update-UI }))
  } else {
    Set-WinHeight 340
    $title.Text = Lbl-Or $s.labels.titleBalance '余额'
    $big.Text = [string]$s.balanceText
    if ($s.balanceFetchedAt -ne $null -and [string]$s.balanceFetchedAt -ne '') {
      $rt = New-Object System.Windows.Controls.TextBlock
      $rt.Text = (Lbl-Or $s.labels.refreshedAt '更新于') + ' ' + [string]$s.balanceFetchedAt
      $rt.FontSize = 9
      $rt.Foreground = New-Object System.Windows.Media.SolidColorBrush(([System.Windows.Media.ColorConverter]::ConvertFromString('#9AA7BD')))
      [void]$rows.Children.Add($rt)
    }
    if ($s.costRows -ne $null) {
      $costArr = @(
        @{ l = (Lbl-Or $s.labels.rowSession '本会话'); v = [string]$s.costRows.session },
        @{ l = (Lbl-Or $s.labels.rowMonthly '本月'); v = [string]$s.costRows.monthly },
        @{ l = (Lbl-Or $s.labels.rowDiff '差值'); v = [string]$s.costRows.diff }
      )
      foreach ($cr in $costArr) {
        if ([string]$cr.v -ne '') { [void]$rows.Children.Add((New-Row $cr.l $cr.v)) }
      }
    }
    # 兜底入口:低余额时余额页直接给「去充值」(不依赖宿主是否 emit kind='lowbalance' 的展示)
    $lbOn = $false
    if ($s.lowBalanceActive -eq $true) { $lbOn = $true }
    if ($s.lowBalance -ne $null -and $s.lowBalance.active -eq $true) { $lbOn = $true }
    if ($lbOn) {
      [void]$btns.Children.Add((New-Btn (Lbl-Or $s.labels.btnCharge '去充值') { Set-View 'lb'; Update-UI }))
    }
  }
`
}

/** ④ 三态翻页 + 操作按钮(替换原 L387–393) */
export function psToggleButtons() {
  return `  if ($cur -eq $null) {
    if ($script:view -eq 'balance' -or $script:view -eq 'usage' -or $script:view -eq 'efficiency') {
      $toggleText = '看用量'
      if ($script:view -eq 'usage') { $toggleText = '看效率' }
      elseif ($script:view -eq 'efficiency') { $toggleText = '看余额' }
      [void]$btns.Children.Add((New-Btn $toggleText { if ($script:view -eq 'balance') { Set-View 'usage' } elseif ($script:view -eq 'usage') { Set-View 'efficiency' } else { Set-View 'balance' }; Update-UI }))
    }
    [void]$btns.Children.Add((New-Btn (Lbl-Or $s.labels.btnRefresh '刷新') { Write-Cmd 'refresh' }))
    [void]$btns.Children.Add((New-Btn (Lbl-Or $s.labels.btnClose 'X') { Close-Pet }))
  }
`
}

/**
 * 一次性拿到「接线所需的全部片段」(按顺序拼接即可替换模板 L287–396)。
 * 返回 { helpers, stateInit, resolve, views, buttons } —— 主机侧接线时按各自位置插入。
 */
export function petViewParts() {
  return {
    version: PET_VIEWS_VERSION,
    helpers: psHelpers(),
    stateInit: psStateInit(),
    resolve: psResolveDisplay(),
    views: psRenderViews(),
    buttons: psToggleButtons(),
  }
}

/**
 * 接线工具(纯函数版,便于测试):把 pet-views 接进 `lib/index.js` 的源码文本。
 * 返回 { ok, code?, problems[], alreadyWired? } —— 不改任何文件。
 */
export function wireIndexSource(src) {
  const s = String(src || '')
  const problems = []
  if (s.includes('petViewParts(')) return { ok: true, alreadyWired: true, code: s, problems }
  if (!s.includes('$script:dragDy = 0')) problems.push('找不到模板锚点 `$script:dragDy = 0`')
  if (!s.includes('  $noticeFresh = $false')) problems.push('找不到 Update-UI 仲裁起点 `$noticeFresh = $false`')
  const ghost = '  if ($script:ghost) {\n    foreach ($b in $btns.Children) { if ($b -is [System.Windows.Controls.Button]) { $b.IsEnabled = $false } }\n  }\n'
  if (!s.includes(ghost)) problems.push('找不到幽灵态兜底块(基线不同?)')
  const importLines = [...s.matchAll(/^import .*$/gm)]
  if (importLines.length === 0) problems.push('找不到任何 import 行')
  if (problems.length) return { ok: false, code: null, problems }

  const IMPORT_LINE = "import { petViewParts } from './pet-views.js'"
  const A_STATE = '$script:dragDy = 0\n'
  const A_RES = '  $noticeFresh = $false\n'

  let out = s
  const lastImport = importLines[importLines.length - 1]
  const importEnd = lastImport.index + lastImport[0].length
  out = out.slice(0, importEnd) + '\n' + IMPORT_LINE + out.slice(importEnd)

  const iState = out.indexOf(A_STATE)
  const stateEnd = iState + A_STATE.length
  out = out.slice(0, stateEnd) + '${petViewParts().helpers}${petViewParts().stateInit}' + out.slice(stateEnd)

  const iRes = out.indexOf(A_RES)
  const iGhost = out.indexOf(ghost)
  if (iRes < 0 || iGhost < 0 || iRes > iGhost) return { ok: false, code: null, problems: ['锚点顺序异常'] }
  out = out.slice(0, iRes) + '${petViewParts().resolve}${petViewParts().views}${petViewParts().buttons}' + out.slice(iGhost)

  return { ok: true, code: out, problems: [] }
}

/** 供单测/冒烟用的自检:生成的 PS 脚本里必须含有这些标记 */
export const PET_VIEWS_MARKERS = [
  'switch ($curKind)',
  "$script:view -eq 'efficiency'",
  "$script:view -eq 'lbopt'",
  "$script:view -eq 'qr'",
  'Send-Ack',
  '$s.display',
  '$s.efficiency',
  'Fmt-Ms',
  '本会话暂无数据',
  "Write-Cmd 'topup-qr'",
  'Set-ImgQr',
  'lowBalanceActive',
]

/** 对已生成的 PS 脚本文本做标记自检,返回 { ok, missing[] } */
export function assertPetViewsScript(script) {
  const text = String(script || '')
  const missing = PET_VIEWS_MARKERS.filter((m) => !text.includes(m))
  return { ok: missing.length === 0, missing }
}

export default { PET_VIEWS_VERSION, VIEW_CYCLE, EFFICIENCY_LABELS, psHelpers, psStateInit, psResolveDisplay, psRenderViews, psToggleButtons, petViewParts, assertPetViewsScript }

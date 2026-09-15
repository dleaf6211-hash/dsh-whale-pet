/**
 * dsh-whale-pet 浏览器客户端（vanilla DOM,无 React,无构建步骤）
 * 自包含于 __ModuleLoader__ 工厂格式;宿主通信走 /api/dsh-whale-pet/* 路由。
 */
window.__ModuleLoader__.load({ id: "dsh-whale-pet-plugin", factory: function (require) {
  var module = { exports: {} }
  var exports = module.exports
  // v3:设置卡改为零 React 依赖(不再 require('react'))。
  // 原因(双机实锤):0.1.1/0.1.5 的模块表都不保证提供裸 'react'(boot 图无 react 行、window.React 无人设置),
  // 旧版「拿不到 React 就静默跳过注册」= 设置面板卡片无声消失。

  // ---------- 常量与台词表 ----------
  var API = {
    state: '/api/dsh-whale-pet/state',
    refreshBalance: '/api/dsh-whale-pet/refresh-balance',
    speech: '/api/dsh-whale-pet/speech',
    speechAudio: '/api/dsh-whale-pet/speech-audio',
    asset: '/api/dsh-whale-pet/asset',
    noticeVoices: '/api/dsh-whale-pet/notice-voices',
    desktopToggle: '/api/dsh-whale-pet/desktop-toggle',
    topupQr: '/api/dsh-whale-pet/topup-qr',
    announce: '/api/dsh-whale-pet/announce',
    displayAck: '/api/dsh-whale-pet/display/ack',
  }
  var IDLE_LINES = [
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
  var PAT_LINES = [
    { t: '诶嘿嘿~摸头杀~', i: '用害羞又带点开心的语气说' },
    { t: '再摸一下也没关系啦', i: '用温柔撒娇的语气说' },
    { t: '被摸头了~有点害羞', i: '用非常小声的害羞语气轻声说', s: 0.85, g: 0.75 },
    { t: '才、才不是因为开心呢！', i: '用傲娇嘴硬的语气说' },
    { t: '嘿嘿~最喜欢被摸头~', i: '用开心幸福的语气说' },
  ]
  var NOTICE_TITLES = { needs_help: '🙋 需要协助', interrupted: '⏸ 任务中断', failed: '❌ 任务失败', completed: '✅ 任务完成', approval: '⏳ 等待审批' }
  var KIND_LABEL = { subagent: '子任务', workflow: '工作流', job: '后台任务', agent: '会话任务', task: '任务' }
  var STATUS_LABEL = { needs_help: '需要协助', interrupted: '中断了', failed: '失败了', completed: '完成了', approval: '等待审批' }

  // ---------- 状态 ----------
  var S = {
    mode: 'balance',
    data: null,
    settings: { idleEnabled: true, idleFrequency: 'normal', voiceEnabled: true, petScale: 0.75, autoLaunchPet: false, lowBalanceAlert: true },
    busy: false,
    notice: null,
    noticeTimer: null,
    queueInitialized: false,
    lastDoneId: 0,
    lbMode: null,
    lbQr: null,
    lbAmount: null,
    lbHandledVersion: 0,
    speech: null,
    speechTimer: null,
    speechLastAt: 0,
    petNote: null,
    patHearts: [],
    patStickerOn: false,
    pos: { x: 0, y: 0 },
    skins: { main: null, sticker: null },
    voices: {},
    stats: { counts: {}, lastIdle: [], lastPat: [] },
    tick: { lastCheckAt: 0, misses: 0 },
    presence: { lastSeenAt: 0 },
    speechAudio: null,
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined && text !== null) n.textContent = text
    return n
  }

  // ---------- CSS ----------
  function injectStyles() {
    var style = document.createElement('style')
    style.textContent = [
      '.whale-mascot-root { position: fixed; right: 18px; bottom: 18px; z-index: 9500; pointer-events: none; user-select: none; transform-origin: right bottom; }',
      '.whale-mascot-scene { position: relative; width: 320px; height: 560px; pointer-events: none; }',
      '.whale-board { position: absolute; z-index: 3; background: transparent; border: none; padding: 0; display: flex; flex-direction: column; gap: 1px; pointer-events: auto; font-family: system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1F3A66; }',
      '.whale-board-title { color: #0f0a04; font-size: 11px; font-weight: 800; text-align: center; text-shadow: 0 0 3px rgba(255,255,255,0.95), 0 1px 1px rgba(255,255,255,0.9); }',
      '.whale-big { color: #0f0a04; text-shadow: 0 0 3px rgba(255,255,255,0.95), 0 1px 1px rgba(255,255,255,0.9); font-size: 15px; line-height: 1.2; font-weight: 900; text-align: center; }',
      '.whale-row { font-size: 9px; line-height: 1.15; font-weight: 700; display: flex; justify-content: space-between; gap: 6px; }',
      '.whale-row .k { color: #2b1c0e; text-shadow: 0 0 2px rgba(255,255,255,0.9); }',
      '.whale-row .v { color: #0f0a04; text-shadow: 0 0 2px rgba(255,255,255,0.9); max-width: 112px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }',
      '.whale-empty { color: #2b1c0e; font-size: 9px; line-height: 1.15; text-align: center; }',
      '.whale-remark { color: #5c3d10; font-size: 10px; font-weight: 700; line-height: 1.2; text-align: center; margin-top: 3px; }',
      '.whale-board-actions { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }',
      '.whale-btn { flex: 1; min-width: 26px; min-height: 15px; font-size: 9.5px; line-height: 1.15; font-weight: 700; padding: 1px 2px; border-radius: 6px; border: 1.5px solid rgba(90,60,25,0.75); background: rgba(255,252,240,0.92); color: #2b1c0e; cursor: pointer; font-family: inherit; }',
      '.whale-btn:hover { background: #fff6e0; }',
      '.whale-btn:disabled { opacity: 0.6; cursor: default; }',
      '.whale-btn-primary { background: #4D8DFF; border-color: #4D8DFF; color: #fff; }',
      '.whale-mascot-img { position: absolute; z-index: 2; pointer-events: auto; cursor: grab; user-select: none; touch-action: none; filter: drop-shadow(0 6px 10px rgba(20,40,90,0.25)); }',
      '.whale-mascot-img:active { cursor: grabbing; }',
      '.whale-qr-img { width: 84px; height: 84px; margin: 2px auto; display: block; border: 2px solid #2E5CB8; border-radius: 6px; background: #fff; }',
      '@keyframes whale-heart { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(-30px) scale(1.2); } }',
      '.whale-heart { position: absolute; z-index: 9; font-size: 14px; pointer-events: none; animation: whale-heart 1.2s ease-out forwards; }',
      '@keyframes whale-sticker-pop { 0% { opacity: 0; transform: scale(0.4) rotate(-8deg); } 60% { opacity: 1; transform: scale(1.12) rotate(3deg); } 100% { opacity: 1; transform: scale(1) rotate(0deg); } }',
      '.whale-pat-sticker { position: absolute; z-index: 10; pointer-events: none; animation: whale-sticker-pop 0.35s ease-out; filter: drop-shadow(0 4px 8px rgba(20,40,90,0.35)); }',
      '.whale-petnote { position: absolute; left: 92px; top: 2px; z-index: 8; font-size: 10px; font-weight: 600; color: #2E5CB8; background: rgba(255,255,255,0.95); border: 1px solid #9DB8E8; border-radius: 8px; padding: 2px 8px; pointer-events: none; }',
    ].join('\n')
    document.head.appendChild(style)
  }

  // ---------- 宿主 RPC ----------
  function callApi(path, args) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    }).then(function (r) { return r.json() }).catch(function () { return { ok: false, error: 'net' } })
  }

  // ---------- 音频 ----------
  function playB64Audio(b64) {
    try {
      stopSpeechAudio()
      var a = new Audio('data:audio/wav;base64,' + b64)
      a.volume = 1
      S.speechAudio = a
      a.play().catch(function () {})
    } catch (e) { /* ignore */ }
  }
  function stopSpeechAudio() {
    if (S.speechAudio !== null) {
      try { S.speechAudio.pause() } catch (e) { /* ignore */ }
      S.speechAudio = null
    }
  }

  // ---------- 台词 ----------
  function pickLine(arr, kind) {
    var recent = kind === 'pat' ? S.stats.lastPat : S.stats.lastIdle
    var weights = arr.map(function (item) {
      var c = S.stats.counts[item.t] || 0
      var w = 1 / (c + 1)
      if (recent.length >= 1 && recent[recent.length - 1] === item.t) w *= 0.15
      if (recent.length >= 2 && recent[recent.length - 2] === item.t) w *= 0.4
      if (recent.length >= 2 && recent[recent.length - 1] === item.t && recent[recent.length - 2] === item.t) w = 0
      return w
    })
    var total = 0
    for (var i = 0; i < weights.length; i++) total += weights[i]
    var idx = 0
    if (total > 0) {
      var r = Math.random() * total
      for (i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) { idx = i; break } }
    } else {
      idx = Math.floor(Math.random() * arr.length)
    }
    var item = arr[idx]
    S.stats.counts[item.t] = (S.stats.counts[item.t] || 0) + 1
    recent.push(item.t)
    if (recent.length > 3) recent.shift()
    return item
  }

  function speechArgs(item, ms) {
    var args = { text: item.t, instruct: item.i }
    if (typeof ms === 'number') args.ms = ms
    if (typeof item.s === 'number') args.speed = item.s
    if (typeof item.g === 'number') args.gain = item.g
    return args
  }

  function dndActive() {
    return !!(S.data && S.data.dnd === true)
  }
  function proceedSayLine(item, ms) {
    if (S.speechTimer !== null) { clearTimeout(S.speechTimer); S.speechTimer = null }
    S.speech = item.t
    callApi(API.speech, speechArgs(item, ms))
    // 浏览器只在桌面宠未接管语音时播;免打扰时段静音(文字照常)
    if (!(S.data && S.data.voiceEngine === 'pet') && S.settings.voiceEnabled !== false && !dndActive()) {
      callApi(API.speechAudio, speechArgs(item)).then(function (r) {
        if (r && r.ok === true && r.base64 && !(S.data && S.data.voiceEngine === 'pet') && S.settings.voiceEnabled !== false && !dndActive() && S.notice === null) {
          playB64Audio(r.base64)
        }
      })
    }
    S.speechTimer = setTimeout(function () { S.speechTimer = null; S.speech = null; render() }, ms)
  }

  function sayLine(item, ms, reportKind) {
    var kb = reportKind === 'headpat' ? 'headpat' : 'line'
    // D12(2026-09-14):先问宿主仲裁,再决定本地渲染与 TTS——
    // 被丢弃(suppressed)的台词不再显示、不再白跑一次 TTS;已有气泡不受影响;
    // 路由不可达时维持旧的本地降级行为。
    callApi(API.announce, { kind: kb, text: item.t })
      .then(function (r) {
        if (!r || r.accepted !== true) return
        proceedSayLine(item, ms)
      })
      .catch(function () { proceedSayLine(item, ms) })
  }

  function idleTick() {
    if (S.settings.idleEnabled === false) return
    if (S.data && S.data.dnd === true) return // 免打扰时段不出声
    if (S.speechTimer !== null) return
    if (S.notice !== null || S.lbMode !== null || S.busy) return
    var busy = !!(S.data && S.data.busy === true)
    var intervalMs = 120000
    if (busy) intervalMs = 30000
    else {
      var present = S.presence.lastSeenAt > 0 && (Date.now() - S.presence.lastSeenAt) < 180000
      intervalMs = present ? 50000 : 120000
    }
    if (S.settings.idleFrequency === 'quiet') intervalMs *= 2
    else if (S.settings.idleFrequency === 'chatty') intervalMs *= 0.5
    var now = Date.now()
    if (S.tick.lastCheckAt === 0) { S.tick.lastCheckAt = now; return }
    if (now - S.tick.lastCheckAt < intervalMs) return
    S.tick.lastCheckAt = now
    var p = 0.2 + S.tick.misses * 0.2
    if (p > 1) p = 1
    if (Math.random() >= p) { S.tick.misses += 1; return }
    S.tick.misses = 0
    sayLine(pickLine(IDLE_LINES, 'idle'), 5000)
  }

  function triggerPat() {
    var item = pickLine(PAT_LINES, 'pat')
    sayLine(item, 4500, 'headpat')
    S.patStickerOn = true
    setTimeout(function () { S.patStickerOn = false; render() }, 2400)
    var hearts = []
    for (var i = 0; i < 3; i++) {
      hearts.push({ id: Date.now() + '-' + i, left: 110 + Math.floor(Math.random() * 105), top: 80 + Math.floor(Math.random() * 70), emoji: i === 1 ? '💙' : '💕' })
    }
    S.patHearts = hearts
    setTimeout(function () { S.patHearts = []; render() }, 1400)
    render()
  }

  // ---------- 通知 ----------
  function processQueue(queue) {
    if (!Array.isArray(queue)) return
    if (!S.queueInitialized) {
      if (queue.length > 0) {
        S.queueInitialized = true
        var maxId = 0
        for (var i = 0; i < queue.length; i++) {
          var it = queue[i]
          if (it && typeof it.id === 'number' && it.id > maxId) maxId = it.id
        }
        S.lastDoneId = Math.max(S.lastDoneId, maxId)
      }
      return
    }
    if (queue.length === 0 || S.notice !== null) return
    for (var j = 0; j < queue.length; j++) {
      var item = queue[j]
      if (item && typeof item.id === 'number' && item.id > S.lastDoneId) {
        S.lastDoneId = item.id
        // 免打扰时段:非白名单(审批/需要协助)的通知整条静默跳过
        if (dndActive() && item.status !== 'approval' && item.status !== 'needs_help') return
        // 通知优先:取消当前台词
        if (S.speechTimer !== null) { clearTimeout(S.speechTimer); S.speechTimer = null }
        S.speech = null
        stopSpeechAudio()
        S.notice = item
        playNoticeVoice(item.status)
        S.noticeTimer = setTimeout(function () { S.notice = null; S.noticeTimer = null; render() }, 6000)
        render()
        return
      }
    }
  }

  function playNoticeVoice(status) {
    // 浏览器仅在桌面宠未接管语音时播
    if (S.data && S.data.voiceEngine === 'pet') return
    if (S.settings.voiceEnabled === false) return
    if (dndActive() && status !== 'approval' && status !== 'needs_help') return
    var v = S.voices[status]
    if (!v) return
    var list = (v.variants && v.variants.length > 0) ? v.variants : (v.base64 ? [{ base64: v.base64 }] : [])
    if (list.length === 0) return
    var pick = list[Math.floor(Math.random() * list.length)]
    if (pick && pick.base64) playB64Audio(pick.base64)
  }

  // ---------- 低余额 ----------
  function dismissLowBalance() {
    S.lbMode = null
    S.lbQr = null
    S.lbAmount = null
    render()
  }
  function pickAmount(amount) {
    S.lbAmount = amount
    S.lbQr = { ok: false }
    S.lbMode = 'qr'
    render()
    callApi(API.topupQr, {}).then(function (r) {
      if (r && r.ok === true && r.base64) { S.lbQr = { ok: true, base64: r.base64 }; render() }
    })
  }

  // ---------- 渲染 ----------
  var rootEl, sceneEl, boardEl, titleEl, bodyEl, actionsEl, imgEl, noteEl
  var stickerEl, heartEls

  function fmtMoney(v) {
    if (typeof v === 'number') return v.toFixed(2)
    if (typeof v === 'string') { var n = parseFloat(v); if (!isNaN(n)) return n.toFixed(2); return v }
    return '–'
  }
  function fmtCost(v) {
    if (typeof v !== 'number') return '–'
    if (v > 0 && v < 0.01) return v.toFixed(5)
    return v.toFixed(2)
  }

  function row(k, v) {
    var r = el('div', 'whale-row')
    r.appendChild(el('span', 'k', k))
    var vs = el('span', 'v', v)
    r.appendChild(vs)
    return r
  }
  function btn(text, cls, fn) {
    var b = el('button', 'whale-btn' + (cls ? ' ' + cls : ''), text)
    b.type = 'button'
    b.addEventListener('click', fn)
    return b
  }

  function renderBoard() {
    titleEl.textContent = ''
    titleEl.style.color = ''
    bodyEl.innerHTML = ''
    actionsEl.innerHTML = ''
    var d = S.data || {}

    if (S.notice !== null) {
      var n = S.notice
      titleEl.textContent = NOTICE_TITLES[n.status] || '📢 任务通知'
      var NC = { failed: '#C0392B', interrupted: '#B9770E', needs_help: '#B9770E' }
      titleEl.style.color = NC[n.status] || ''
      var t = String(n.title || '')
      if (t.length > 11) t = t.slice(0, 11) + '…'
      var big = el('div', 'whale-big')
      big.style.fontSize = '14px'
      big.textContent = t
      bodyEl.appendChild(big)
      bodyEl.appendChild(row('状态', (KIND_LABEL[n.kind] || '任务') + ' ' + (STATUS_LABEL[n.status] || '完成了')))
      if (n.status !== 'needs_help' && n.status !== 'approval' && typeof n.costCny === 'number') {
        bodyEl.appendChild(row('消耗金额', '≈¥' + fmtCost(n.costCny)))
      }
      actionsEl.appendChild(btn('知道了', null, function () {
        if (S.noticeTimer) clearTimeout(S.noticeTimer)
        S.notice = null
        S.noticeTimer = null
        // 窝 2:宿主调度器 ack(「知道了」= dismiss,队列可推进)
        if (d.display && d.display.current && typeof d.display.current.seq === 'number') {
          callApi(API.displayAck, { seq: d.display.current.seq, kind: 'dismiss' }).catch(function () {})
        }
        render()
      }))
      return
    }
    if (S.lbMode === 'prompt') {
      titleEl.textContent = '⚠️ 余额不足'
      var lb = d.lowBalance || {}
      var big2 = el('div', 'whale-big')
      big2.style.fontSize = '14px'
      big2.style.color = '#C0392B'
      big2.textContent = '¥' + fmtMoney(lb.amount || 0)
      bodyEl.appendChild(big2)
      bodyEl.appendChild(el('div', 'whale-empty', '余额低于 5 元，建议充值'))
      actionsEl.appendChild(btn('充值', 'whale-btn-primary', function () { S.lbMode = 'options'; render() }))
      actionsEl.appendChild(btn('不充值', null, dismissLowBalance))
      return
    }
    if (S.lbMode === 'options') {
      titleEl.textContent = '💰 选择充值金额'
      bodyEl.appendChild(el('div', 'whale-empty', '请选择充值金额'))
      actionsEl.appendChild(btn('¥10', null, function () { pickAmount(10) }))
      actionsEl.appendChild(btn('¥50', null, function () { pickAmount(50) }))
      actionsEl.appendChild(btn('¥100', null, function () { pickAmount(100) }))
      actionsEl.appendChild(btn('返回', null, function () { S.lbMode = 'prompt'; render() }))
      return
    }
    if (S.lbMode === 'qr') {
      titleEl.textContent = '📱 扫码充值 DeepSeek'
      var img = el('img', 'whale-qr-img')
      img.alt = '充值二维码'
      if (S.lbQr && S.lbQr.base64) img.src = 'data:image/png;base64,' + S.lbQr.base64
      bodyEl.appendChild(img)
      bodyEl.appendChild(el('div', 'whale-empty', (S.lbAmount ? '金额 ¥' + S.lbAmount + ' · ' : '') + '支付宝/微信扫码'))
      if (!(S.lbQr && S.lbQr.base64)) bodyEl.appendChild(el('div', 'whale-empty', '二维码加载失败,请直接访问平台充值页'))
      bodyEl.appendChild(el('div', 'whale-empty', 'platform.deepseek.com/top_up'))
      actionsEl.appendChild(btn('返回', null, dismissLowBalance))
      return
    }
    if (S.speech !== null) {
      titleEl.textContent = '💬 鲸鱼娘说'
      var wrap = el('div')
      wrap.style.cssText = 'min-height:56px;display:flex;align-items:center;justify-content:center;'
      var sp = el('div', 'whale-big', S.speech)
      sp.style.cssText = 'font-size:14px;line-height:1.3;text-align:center;'
      wrap.appendChild(sp)
      bodyEl.appendChild(wrap)
    } else if (S.mode === 'balance') {
      titleEl.textContent = '🐳 余额'
      var b = d.balance
      if (b && b.ok === true && Array.isArray(b.rows) && b.rows.length > 0) {
        var row0 = b.rows[0]
        var cur = row0.currency === 'CNY' ? '¥' : (typeof row0.currency === 'string' && row0.currency !== '' ? row0.currency + ' ' : '')
        bodyEl.appendChild(el('div', 'whale-big', cur + fmtMoney(row0.total)))
        if (d.sessionCost && typeof d.sessionCost.costCny === 'number') bodyEl.appendChild(row('当前会话消耗', '≈¥' + fmtCost(d.sessionCost.costCny)))
        if (d.realMonthlyCost && typeof d.realMonthlyCost.totalCny === 'number') bodyEl.appendChild(row('本月消耗', '¥' + fmtCost(d.realMonthlyCost.totalCny)))
        else if (d.monthlyUsage && typeof d.monthlyUsage.costCny === 'number') bodyEl.appendChild(row('本月消耗', '≈¥' + fmtCost(d.monthlyUsage.costCny)))
        if (d.costDiff && typeof d.costDiff.diff === 'number' && isFinite(d.costDiff.diff)) bodyEl.appendChild(row('消耗差值', '≈¥' + fmtCost(Math.max(0, d.costDiff.diff))))
        else if (!d.costDiff || d.costDiff.diff === null || d.costDiff.diff === undefined) bodyEl.appendChild(row('消耗差值', '—'))
      } else {
        bodyEl.appendChild(el('div', 'whale-empty', (d.balanceError || '余额加载中…')))
      }
    } else if (S.mode === 'efficiency') {
      titleEl.textContent = '🐳 效率'
      var e = d.efficiency || {}
      var st = e && e.sessionTokens
      if (st && typeof st.input === 'number') bodyEl.appendChild(row('会话 tokens 入/出', String((st.input || 0) + (st.cacheRead || 0)) + ' / ' + String(st.output || 0)))
      var miss = st && typeof st.input === 'number' ? st.input : 0
      var hit = st && typeof st.cacheRead === 'number' ? st.cacheRead : 0
      bodyEl.appendChild(row('缓存 命中/未命中', String(hit) + ' / ' + String(miss)))
      if (e && typeof e.remark === 'string' && e.remark !== '') {
        var rk = el('div', 'whale-remark')
        rk.textContent = e.remark
        bodyEl.appendChild(rk)
      }
    } else {
      titleEl.textContent = '🐳 Tokens'
      var u = d.usage || {}
      bodyEl.appendChild(row('模型调用次数', String(u.calls || 0)))
      bodyEl.appendChild(row('输入 tokens', String(u.inputTokens || 0)))
      bodyEl.appendChild(row('输出 tokens', String(u.outputTokens || 0)))
      bodyEl.appendChild(row('缓存读取', String(u.cacheReadTokens || 0)))
    }
    if (S.notice === null && S.lbMode === null) {
      var nextMode = S.mode === 'balance' ? 'usage' : S.mode === 'usage' ? 'efficiency' : 'balance'
      var nextLabel = nextMode === 'balance' ? '看余额' : nextMode === 'usage' ? '看用量' : '看效率'
      actionsEl.appendChild(btn(nextLabel, null, function () { S.mode = nextMode; render() }))
      // 单向拉起:桌宠运行时点击只提示,绝不反向关闭(关闭请用桌宠自己的 X)
      var petAlive = !!(S.data && S.data.voiceEngine === 'pet')
      actionsEl.appendChild(btn(petAlive ? '桌宠运行中' : '拉起桌宠', null, function () {
        if (petAlive) {
          S.petNote = '桌宠运行中 ✓'
          render()
          setTimeout(function () { S.petNote = null; render() }, 3000)
          return
        }
        S.petNote = '拉起中…'
        render()
        callApi(API.desktopToggle, {}).then(function (r) {
          S.petNote = r && r.ok === true ? '桌宠已拉起 ✓' : '拉起失败'
          render()
          refreshState()
          setTimeout(function () { S.petNote = null; render() }, 3000)
        })
      }))
      actionsEl.appendChild(btn('刷新', 'whale-btn-primary', function () {
        S.busy = true
        render()
        callApi(API.refreshBalance, {}).then(function () {
          S.busy = false
          refreshState()
        }).catch(function () { S.busy = false; refreshState() })
      }))
    }
  }

  function render() {
    if (rootEl === undefined) return
    renderBoard()
    rootEl.style.transform = 'scale(' + S.settings.petScale + ') translate(' + S.pos.x + 'px, ' + S.pos.y + 'px)'
    // 立绘
    if (S.skins.main && S.skins.main.base64) {
      imgEl.src = 'data:image/png;base64,' + S.skins.main.base64
      imgEl.style.display = ''
    } else {
      imgEl.style.display = 'none'
    }
    // 爱心(元素稳定:按 id 缓存,不反复重建/重播动画)
    if (heartEls === undefined) heartEls = {}
    var alive = {}
    for (var j = 0; j < S.patHearts.length; j++) {
      var h = S.patHearts[j]
      alive[h.id] = true
      if (!heartEls[h.id]) {
        var hn = el('span', 'whale-heart', h.emoji)
        hn.style.left = h.left + 'px'
        hn.style.top = h.top + 'px'
        sceneEl.appendChild(hn)
        heartEls[h.id] = hn
      }
    }
    for (var hid in heartEls) {
      if (!alive[hid]) { try { heartEls[hid].remove() } catch (e) { /* ignore */ }; delete heartEls[hid] }
    }
    // 害羞贴纸(元素稳定:只在出现/消失时创建/移除,不反复触发 pop 动画)
    if (S.patStickerOn && S.skins.sticker && S.skins.sticker.base64) {
      if (stickerEl === undefined) {
        stickerEl = el('img', 'whale-pat-sticker')
        stickerEl.src = 'data:image/png;base64,' + S.skins.sticker.base64
        stickerEl.style.cssText = 'left:128px;top:36px;width:150px;height:150px;'
        sceneEl.appendChild(stickerEl)
      }
    } else if (stickerEl !== undefined) {
      try { stickerEl.remove() } catch (e) { /* ignore */ }
      stickerEl = undefined
    }
    // petNote
    noteEl.textContent = S.petNote || ''
    noteEl.style.display = S.petNote ? '' : 'none'
  }

  // ---------- 状态轮询 ----------
  function refreshState() {
    callApi(API.state, {}).then(function (s) {
      if (!s || s.ok !== true) return
      S.data = s
      if (s.settings && typeof s.settings === 'object') S.settings = s.settings
      if (s.taskQueue) processQueue(s.taskQueue)
      if (s.lowBalance && s.lowBalance.active === true && typeof s.lowBalance.version === 'number' && s.lowBalance.version > S.lbHandledVersion) {
        S.lbHandledVersion = s.lowBalance.version
        S.lbMode = 'prompt'
        playNoticeVoice('low_balance')
      } else if (s.lowBalance && s.lowBalance.active !== true) {
        if (S.lbMode === 'prompt' || S.lbMode === 'options' || S.lbMode === 'qr') S.lbMode = null
      }
      render()
    })
  }

  // ---------- 拖拽与摸头 ----------
  var drag = { on: false, moved: 0, sx: 0, sy: 0, ox: 0, oy: 0 }
  var pat = { enterAt: 0, lastAt: 0 }

  function onPointerDown(e) {
    e.preventDefault()
    try { if (e.target && e.target.setPointerCapture && typeof e.pointerId === 'number') e.target.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
    drag.on = true
    drag.moved = 0
    drag.sx = e.clientX
    drag.sy = e.clientY
    drag.ox = S.pos.x
    drag.oy = S.pos.y
  }
  function onPointerMove(e) {
    if (drag.on) {
      var dx = e.clientX - drag.sx
      var dy = e.clientY - drag.sy
      drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy))
      S.pos = { x: drag.ox + dx, y: drag.oy + dy }
      render()
      return
    }
    try {
      var rect = imgEl.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      var fx = (e.clientX - rect.left) / rect.width
      var fy = (e.clientY - rect.top) / rect.height
      var now = Date.now()
      if (fx >= 0.15 && fx <= 0.85 && fy <= 0.38) {
        if (pat.enterAt === 0) pat.enterAt = now
        if (now - pat.enterAt > 650 && now - pat.lastAt > 2600) {
          pat.lastAt = now
          pat.enterAt = 0
          triggerPat()
        }
      } else {
        pat.enterAt = 0
      }
    } catch (err) { /* ignore */ }
  }
  function onPointerEnd() { drag.on = false }

  // ---------- 启动 ----------
  function mount() {
    if (rootEl !== undefined) return
    // D14:整页未刷新时,上一实例挂的根节点会残留在页面上 ⇒ 先清掉再挂,避免「两只浏览器宠」
    try {
      var stale = document.querySelectorAll('.whale-mascot-root')
      for (var i = 0; i < stale.length; i++) stale[i].remove()
    } catch (e) { /* ignore */ }
    injectStyles()
    rootEl = el('div', 'whale-mascot-root')
    sceneEl = el('div', 'whale-mascot-scene')
    boardEl = el('div', 'whale-board')
    boardEl.style.cssText = 'left:38px;top:340px;width:180px;min-height:84px;'
    titleEl = el('div', 'whale-board-title')
    bodyEl = el('div')
    actionsEl = el('div', 'whale-board-actions')
    boardEl.appendChild(titleEl)
    boardEl.appendChild(bodyEl)
    boardEl.appendChild(actionsEl)
    imgEl = el('img', 'whale-mascot-img')
    imgEl.draggable = false
    imgEl.style.cssText = 'left:-90px;bottom:0px;width:500px;height:520px;'
    imgEl.addEventListener('pointerdown', onPointerDown)
    imgEl.addEventListener('pointermove', onPointerMove)
    imgEl.addEventListener('pointerup', onPointerEnd)
    imgEl.addEventListener('pointercancel', onPointerEnd)
    noteEl = el('div', 'whale-petnote')
    noteEl.style.display = 'none'
    sceneEl.appendChild(boardEl)
    sceneEl.appendChild(imgEl)
    sceneEl.appendChild(noteEl)
    rootEl.appendChild(sceneEl)
    document.body.appendChild(rootEl)

    // 资产
    callApi(API.asset, { skin: 3 }).then(function (r) { if (r && r.ok === true) { S.skins.main = r; render() } })
    callApi(API.asset, { skin: 4 }).then(function (r) { if (r && r.ok === true) { S.skins.sticker = r } })
    callApi(API.noticeVoices, {}).then(function (r) { if (r && r.ok === true) S.voices = r.voices || {} })

    // 存在感
    var markSeen = function () { S.presence.lastSeenAt = Date.now() }
    markSeen()
    window.addEventListener('mousemove', markSeen)
    window.addEventListener('keydown', markSeen)
    window.addEventListener('pointerdown', markSeen)
    window.addEventListener('touchstart', markSeen)

    refreshState()
    callApi(API.refreshBalance, {})
    setInterval(refreshState, 1000)
    setInterval(idleTick, 10000)
  }

  // ---------- 设置卡片(设置 → 插件 → 鲸鱼娘桌宠) ----------
  var SETTINGS_CSS = [
    '.ws-card{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);border-radius:12px;transition:border-color .16s,background .16s}',
    '.ws-card:hover{border-color:var(--dsw-alias-label-dimmed,#c8ccd4)}',
    '.ws-card.open{background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-color:var(--dsw-alias-label-dimmed,#c8ccd4)}',
    '.ws-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
    '.ws-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f6ef7);outline-offset:-2px}',
    '.ws-headtext{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}',
    '.ws-name{color:var(--dsw-alias-label-primary,#1f2328);font-size:15px;font-weight:600;line-height:1.4}',
    '.ws-version{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:12px;font-weight:400;margin-left:6px}',
    '.ws-desc{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:13px;line-height:1.5}',
    '.ws-chevron{color:var(--dsw-alias-label-tertiary,#8b93a1);flex:none;display:inline-flex;transition:transform .16s}',
    '.ws-chevron.open{transform:rotate(180deg)}',
    '.ws-body{border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);margin:0 16px;padding-bottom:8px}',
    '.ws-row{display:flex;align-items:center;gap:12px;padding:12px 0}',
    '.ws-row+.ws-row{border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb)}',
    '.ws-labelbox{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}',
    '.ws-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1f2328)}',
    '.ws-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b93a1)}',
    '.ws-switch{position:relative;width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l1);cursor:pointer;flex:none}',
    '.ws-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s ease}',
    '.ws-switch.on{background:var(--dsw-alias-brand-primary)}',
    '.ws-switch.on::after{transform:translateX(16px)}',
    '.ws-select{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 8px;font-size:13px;outline:none}',
    '.ws-range{flex:none;width:120px}',
    '.ws-scale{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b93a1);min-width:38px;text-align:right}',
    '.ws-note{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b93a1);padding:2px 0}',
  ].join('\n')
  // ---------- 设置卡 v3:零 React 依赖(手造元素 + ref 回调挂原生 DOM) ----------
  // 不再 require/import React、不用 useState/useEffect:
  // - 根元素手造 { $$typeof: Symbol.for('react.element') } —— React 元素身份只认这个 Symbol,跨实例跨版本可渲染;
  // - 卡内容在 ref 回调里 document.createElement 构建,状态闭包化,手动刷新 DOM;
  // - 不挑 React 实例 ⇒ 0.1.1(list 派发)/ 0.1.5(keyed 派发)同一份代码通吃。
  function makeSettingsCardElement() {
    return {
      $$typeof: Symbol.for('react.element'),
      type: 'div',
      key: null,
      ref: mountSettingsCard,
      props: {},
    }
  }

  function mountSettingsCard(node) {
    if (!node) return // 卸载时 React 以 null 调 ref

    var S = { open: false, cfg: null, note: '' }

    function make(tag, className, text) {
      var n = document.createElement(tag)
      if (className) n.className = className
      if (text !== undefined && text !== null) n.textContent = text
      return n
    }

    function chevron() {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 14 14')
      svg.setAttribute('width', '14')
      svg.setAttribute('height', '14')
      svg.setAttribute('style', 'display:block')
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', 'M3 5.5 7 9.5 11 5.5')
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', 'currentColor')
      path.setAttribute('stroke-width', '1.6')
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(path)
      return svg
    }

    function buildRow(label, hint, control) {
      var row = make('div', 'ws-row')
      var lb = make('div', 'ws-labelbox')
      lb.appendChild(make('div', 'ws-label', label))
      if (hint) lb.appendChild(make('div', 'ws-hint', hint))
      row.appendChild(lb)
      if (control) row.appendChild(control)
      return row
    }

    function sw(key, label, hint) {
      var swt = make('div', 'ws-switch' + (S.cfg && S.cfg[key] ? ' on' : ''))
      swt.addEventListener('click', function () {
        var patch = {}
        patch[key] = !(S.cfg && S.cfg[key])
        save(patch)
      })
      return buildRow(label, hint, swt)
    }

    function load() {
      fetch('/api/dsh-whale-pet/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json() })
        .then(function (j) {
          if (j && j.ok && j.settings) {
            S.cfg = j.settings
            renderBody()
          }
        })
        .catch(function () {})
    }

    function save(patch) {
      var next = Object.assign({}, S.cfg || {}, patch || {})
      S.cfg = next
      S.note = '保存中…'
      renderBody()
      fetch('/api/dsh-whale-pet/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: next }) })
        .then(function (r) { return r.json() })
        .then(function (j) {
          S.note = j && j.ok ? '已保存 ✓(台词/语音/大小立即生效,自动拉起下次重启生效)' : '保存失败'
          renderBody()
        })
        .catch(function () {
          S.note = '保存失败'
          renderBody()
        })
    }

    function renderBody() {
      if (!bodyEl) return
      bodyEl.textContent = ''
      if (S.cfg === null) {
        bodyEl.appendChild(buildRow('', '加载中…', null))
        return
      }
      bodyEl.appendChild(sw('idleEnabled', '随机台词', '空闲时鲸鱼娘主动说话'))
      bodyEl.appendChild(buildRow('台词频率', '安静 = 间隔加倍,活泼 = 减半', (function () {
        var sel = make('select', 'ws-select')
        var opts = [['quiet', '安静'], ['normal', '标准'], ['chatty', '活泼']]
        for (var i = 0; i < opts.length; i++) {
          var o = make('option', null, opts[i][1])
          o.value = opts[i][0]
          sel.appendChild(o)
        }
        sel.value = S.cfg.idleFrequency || 'normal'
        sel.addEventListener('change', function () { save({ idleFrequency: sel.value }) })
        return sel
      })()))
      bodyEl.appendChild(sw('voiceEnabled', '语音朗读', '台词与任务通知的语音'))
      bodyEl.appendChild(buildRow('浏览器宠大小', '60% ~ 120%', (function () {
        var rng = make('input', 'ws-range')
        rng.type = 'range'
        rng.min = '0.6'
        rng.max = '1.2'
        rng.step = '0.05'
        rng.value = String(S.cfg.petScale || 0.75)
        var scale = make('span', 'ws-scale', Math.round((S.cfg.petScale || 0.75) * 100) + '%')
        rng.addEventListener('input', function () { scale.textContent = Math.round(parseFloat(rng.value) * 100) + '%' })
        rng.addEventListener('change', function () { save({ petScale: parseFloat(rng.value) }) })
        var wrap = make('span')
        wrap.appendChild(rng)
        wrap.appendChild(scale)
        return wrap
      })()))
      bodyEl.appendChild(sw('autoLaunchPet', '自动拉起桌面宠', 'DSH 启动时自动出现桌面宠(默认关,靠木牌「拉起桌宠」)'))
      bodyEl.appendChild(sw('lowBalanceAlert', '低余额提醒', '余额低于 5 元时提醒充值'))
      bodyEl.appendChild(sw('dndEnabled', '免打扰时段', '时段内静音、不弹气泡;审批与「需要协助」仍会提醒'))
      bodyEl.appendChild(buildRow('免打扰时间', '支持跨午夜(如 22:00 – 09:00)', (function () {
        var start = make('input', 'ws-select')
        start.type = 'time'
        start.value = S.cfg.dndStart || ''
        start.addEventListener('change', function () { save({ dndStart: start.value }) })
        var dash = make('span', 'ws-scale', '–')
        var end = make('input', 'ws-select')
        end.type = 'time'
        end.value = S.cfg.dndEnd || ''
        end.addEventListener('change', function () { save({ dndEnd: end.value }) })
        var wrap = make('span')
        wrap.appendChild(start)
        wrap.appendChild(dash)
        wrap.appendChild(end)
        return wrap
      })()))
      if (S.note) bodyEl.appendChild(buildRow('', S.note, null))
    }

    var bodyEl = null

    function renderAll() {
      node.textContent = ''
      node.className = S.open ? 'ws-card open' : 'ws-card'
      var header = make('button', 'ws-header')
      header.type = 'button'
      header.setAttribute('aria-expanded', S.open ? 'true' : 'false')
      header.addEventListener('click', function () {
        S.open = !S.open
        renderAll()
      })
      var ht = make('div', 'ws-headtext')
      var nm = make('div', 'ws-name', '鲸鱼娘桌宠')
      nm.appendChild(make('span', 'ws-version', 'v1.0.4'))
      ht.appendChild(nm)
      ht.appendChild(make('div', 'ws-desc', '台词、语音、大小与桌面宠拉起行为'))
      header.appendChild(ht)
      var cv = make('span', S.open ? 'ws-chevron open' : 'ws-chevron')
      cv.appendChild(chevron())
      header.appendChild(cv)
      node.appendChild(header)
      if (S.open) {
        bodyEl = make('div', 'ws-body')
        node.appendChild(bodyEl)
        renderBody()
      } else {
        bodyEl = null
      }
    }

    // 兜底:宿主重渲染可能清掉手动插入的子 DOM(卡突然空白)→ 被清空且仍挂载时自动重建
    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () {
        if (!node.isConnected) { mo.disconnect(); return }
        if (node.childNodes.length === 0) renderAll()
      })
      mo.observe(node, { childList: true })
    }

    renderAll()
    load()
  }
  function registerSettingsCard(ctx) {
    // v4:声明式 inject 优先(ctx.slots),ctx.get 兜底;拿不到 slots 时 console.warn,绝不再静默。
    var slots = ctx && ctx.slots
    if (!slots && ctx && typeof ctx.get === 'function') {
      try { slots = ctx.get('slots') } catch (e) { slots = undefined }
    }
    if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
      if (typeof console !== 'undefined' && console.warn) console.warn('[whale-pet] settings card not registered: slots service unavailable (ctx.slots/ctx.get both missed)')
      return
    }
    try {
      var styleEl = document.createElement('style')
      styleEl.textContent = SETTINGS_CSS
      document.head.appendChild(styleEl)
      slots.inject('settings.plugin.item', function () {
        return slots.register(
          { name: 'settings.plugin.item', id: 'dsh-whale-pet-plugin', order: 40, label: '鲸鱼娘桌宠', key: 'dsh-whale-pet' },
          function () { return makeSettingsCardElement() }
        )
      })
      // 探针:注册后自查 slot 条目表,一次钉死「注册到底成没成」(装包复验时看 console)
      if (typeof console !== 'undefined' && console.log) {
        try {
          var entries = typeof slots.entries === 'function' ? slots.entries('settings.plugin.item') : null
          var ours = false
          var n = 0
          if (entries && typeof entries.forEach === 'function') {
            entries.forEach(function (e) { n++; if (e && e.options && e.options.id === 'dsh-whale-pet-plugin') ours = true })
          }
          console.log('[whale-pet] settings card registered; slot entries = ' + n + ', ours present = ' + ours)
        } catch (e) { console.log('[whale-pet] settings card registered (entries probe unavailable)') }
      }
    } catch (e) { /* 注册失败绝不让 GUI 启动崩掉 */ }
  }

  // (输入框互动入口已按用户反馈移除——桌宠本体可直接摸/点,按钮面板冗余)

  function apply(ctx) {
    mount()
    registerSettingsCard(ctx) // v3:零 React 依赖,无条件注册(不再因 react 缺失而静默消失)
    // 测试钩子:渲染测试页可通过 window.__whale 直接触发摸头/通知,验证贴纸/爱心/台词/通知视图
    if (typeof window !== 'undefined' && window.__WHALE_TEST__ === true) {
      window.__whale = {
        triggerPat: triggerPat,
        sayIdle: function () { sayLine(pickLine(IDLE_LINES, 'idle'), 5000) },
        showNotice: function (item) { S.notice = item; render() },
      }
    }
  }
  exports.apply = apply
  exports.inject = ['slots'] // v4:声明式注入,与官方设置卡插件同款姿势;ctx.slots 直读、ctx.get 兜底
  return module.exports
} })

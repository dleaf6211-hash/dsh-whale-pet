/**
 * dsh-whale-pet 浏览器客户端（vanilla DOM,无 React,无构建步骤）
 * 自包含于 __ModuleLoader__ 工厂格式;宿主通信走 /api/dsh-whale-pet/* 路由。
 */
window.__ModuleLoader__.load({ id: "dsh-whale-pet-plugin", factory: function (require) {
  var module = { exports: {} }
  var exports = module.exports

  // ---------- 常量与台词表 ----------
  var API = {
    state: '/api/dsh-whale-pet/state',
    refreshBalance: '/api/dsh-whale-pet/refresh-balance',
    speech: '/api/dsh-whale-pet/speech',
    speechAudio: '/api/dsh-whale-pet/speech-audio',
    asset: '/api/dsh-whale-pet/asset',
    noticeVoices: '/api/dsh-whale-pet/notice-voices',
    desktopToggle: '/api/dsh-whale-pet/desktop-toggle',
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
  var PET_SCALE = 0.75

  // ---------- 状态 ----------
  var S = {
    mode: 'balance',
    data: null,
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

  function sayLine(item, ms) {
    if (S.speechTimer !== null) { clearTimeout(S.speechTimer); S.speechTimer = null }
    S.speech = item.t
    callApi(API.speech, speechArgs(item, ms))
    // 浏览器只在桌面宠未接管语音时播
    if (!(S.data && S.data.voiceEngine === 'pet')) {
      callApi(API.speechAudio, speechArgs(item)).then(function (r) {
        if (r && r.ok === true && r.base64 && !(S.data && S.data.voiceEngine === 'pet') && S.notice === null) {
          playB64Audio(r.base64)
        }
      })
    }
    S.speechTimer = setTimeout(function () { S.speechTimer = null; S.speech = null; render() }, ms)
  }

  function idleTick() {
    if (S.speechTimer !== null) return
    if (S.notice !== null || S.lbMode !== null || S.busy) return
    var busy = !!(S.data && S.data.busy === true)
    var intervalMs = 120000
    if (busy) intervalMs = 30000
    else {
      var present = S.presence.lastSeenAt > 0 && (Date.now() - S.presence.lastSeenAt) < 180000
      intervalMs = present ? 50000 : 120000
    }
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
    sayLine(item, 4500)
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
    var v = S.voices[status]
    if (v && v.base64) { playB64Audio(v.base64) }
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
  }

  // ---------- 渲染 ----------
  var rootEl, sceneEl, boardEl, titleEl, bodyEl, actionsEl, imgEl, noteEl

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
    bodyEl.innerHTML = ''
    actionsEl.innerHTML = ''
    var d = S.data || {}

    if (S.notice !== null) {
      var n = S.notice
      titleEl.textContent = NOTICE_TITLES[n.status] || '📢 任务通知'
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
      actionsEl.appendChild(btn('知道了', null, function () { if (S.noticeTimer) clearTimeout(S.noticeTimer); S.notice = null; S.noticeTimer = null; render() }))
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
      } else {
        bodyEl.appendChild(el('div', 'whale-empty', (d.balanceError || '余额加载中…')))
      }
    } else {
      titleEl.textContent = '🐳 Tokens'
      var u = d.usage || {}
      bodyEl.appendChild(row('模型调用', String(u.calls || 0)))
      bodyEl.appendChild(row('输入 tokens', String(u.inputTokens || 0)))
      bodyEl.appendChild(row('输出 tokens', String(u.outputTokens || 0)))
      bodyEl.appendChild(row('缓存读取', String(u.cacheReadTokens || 0)))
    }
    if (S.notice === null && S.lbMode === null) {
      actionsEl.appendChild(btn(S.mode === 'balance' ? '看用量' : '看余额', null, function () { S.mode = S.mode === 'balance' ? 'usage' : 'balance'; render() }))
      actionsEl.appendChild(btn('拉起桌宠', null, function () {
        S.petNote = '拉起中…'
        render()
        callApi(API.desktopToggle, {}).then(function (r) {
          S.petNote = r && r.ok === true ? '桌宠已拉起 ✓' : '拉起失败'
          render()
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
    rootEl.style.transform = 'scale(' + PET_SCALE + ') translate(' + S.pos.x + 'px, ' + S.pos.y + 'px)'
    // 立绘
    if (S.skins.main && S.skins.main.base64) {
      imgEl.src = 'data:image/png;base64,' + S.skins.main.base64
      imgEl.style.display = ''
    } else {
      imgEl.style.display = 'none'
    }
    // 爱心
    var oldHearts = sceneEl.querySelectorAll('.whale-heart')
    for (var i = 0; i < oldHearts.length; i++) oldHearts[i].remove()
    for (var j = 0; j < S.patHearts.length; j++) {
      var h = S.patHearts[j]
      var hn = el('span', 'whale-heart', h.emoji)
      hn.style.left = h.left + 'px'
      hn.style.top = h.top + 'px'
      sceneEl.appendChild(hn)
    }
    // 害羞贴纸
    var oldSt = sceneEl.querySelector('.whale-pat-sticker')
    if (oldSt) oldSt.remove()
    if (S.patStickerOn && S.skins.sticker && S.skins.sticker.base64) {
      var st = el('img', 'whale-pat-sticker')
      st.src = 'data:image/png;base64,' + S.skins.sticker.base64
      st.style.cssText = 'left:128px;top:36px;width:150px;height:150px;'
      sceneEl.appendChild(st)
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

  function apply(ctx) {
    mount()
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
  exports.inject = []
  return module.exports
} })

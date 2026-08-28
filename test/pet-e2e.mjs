// pet-e2e.mjs — 桌面宠真机端到端测试:生成脚本→写状态→拉起真实 WPF 宠物→验证存活→关闭
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { buildPetScript } from '../lib/index.js'

const dir = mkdtempSync(join(tmpdir(), 'whale-pet-e2e-'))
const statePath = join(dir, 'whale-desktop-state.json')
const cmdPath = join(dir, 'whale-pet-cmd.json')
const skinPath = 'E:/dsh-workspace/whale-repo/assets/skins/whale-skin-0.png'
const speechWav = join(dir, 'whale-speech-last.wav')
const scriptPath = join(dir, 'whale-pet.ps1')

const stateJson = {
  balanceTotal: 89.59,
  balanceText: '¥89.59',
  balanceFetchedAt: '12:00:00',
  lowBalanceActive: false,
  skin: 0,
  ghost: false,
  speech: { text: '', expireAt: 0, audioTick: 0 },
  tokens: { input: '1', output: '1', cacheRead: '0', calls: '1' },
  voiceEngine: 'browser',
  notice: null,
  labels: {
    titleBalance: '🐳 余额', titleUsage: '🐳 Tokens', speechTitle: '💬 鲸鱼娘说',
    btnUsage: '看用量', btnBalance: '看余额', btnRefresh: '刷新', btnGhost: '透明', btnClose: 'X', btnGotIt: '知道了',
    rowCalls: '模型调用', rowIn: '输入 tokens', rowOut: '输出 tokens', rowCache: '缓存读取',
    refreshedAt: '刷新于',
  },
}
writeFileSync(statePath, JSON.stringify(stateJson), 'utf8')
writeFileSync(scriptPath, buildPetScript(statePath, cmdPath, skinPath, speechWav), 'utf8')

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
  if (!cond) failures++
}

const child = spawn('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], { stdio: 'ignore', windowsHide: true })
check('pet process spawned', child.pid > 0)

setTimeout(() => {
  // 互斥检测:能 WaitOne(0) 说明宠物没拿;拿不到说明宠物活着
  let held = false
  try {
    const r = execFileSync('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-Command', "$m=New-Object System.Threading.Mutex($false,'WhalePetMutex'); if($m.WaitOne(0)){'FREE';$m.ReleaseMutex()}else{'HELD'}"], { encoding: 'utf8', timeout: 15000 })
    held = String(r).trim() === 'HELD'
  } catch (e) { /* ignore */ }
  check('pet mutex HELD (window alive)', held)

  // 关闭:直接按 PID 杀(测试进程就是宠物本体)
  let killed = false
  try {
    execFileSync('C:\\WINDOWS\\system32\\taskkill.exe', ['/f', '/pid', String(child.pid)], { encoding: 'utf8', timeout: 15000 })
    killed = true
  } catch (e) { killed = false }
  check('pet process killed', killed)

  // 再验一次互斥已释放
  let freed = false
  try {
    const r2 = execFileSync('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-Command', "$m=New-Object System.Threading.Mutex($false,'WhalePetMutex'); if($m.WaitOne(0)){'FREE';$m.ReleaseMutex()}else{'HELD'}"], { encoding: 'utf8', timeout: 15000 })
    freed = String(r2).trim() === 'FREE'
  } catch (e) { /* ignore */ }
  check('mutex released after kill', freed)

  console.log('---')
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES')
  rmSync(dir, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
}, 8000)

function log(msg) {
  console.log(`[📦 节点分组脚本] ${msg}`)
}

const { type, name } = $arguments
log(`开始处理参数 name: ${name}, type: ${type}`)

//  1. 匹配规则配置
const MAIN_REGION = { US: /(?<!-)\bUS\b/i, VN: /(?<!-)\bVN\b/i, JP: /(?<!-)\bJP\b/i, SG: /(?<!-)\bSG\b/i, TW: /(?<!-)\bTW\b/i }
const RE_TIKTOK = /\bTK\b|tiktok/i
const RE_TK_US = /TK-US/i; const RE_TK_VN = /TK-VN/i; const RE_TK_JP = /TK-JP/i; const RE_TK_SG = /TK-SG/i; const RE_TK_TW = /TK-TW/i

const TIKTOK_MAIN = {
  'TK-US-AUTO': tag => MAIN_REGION.US.test(tag) || RE_TK_US.test(tag),
  'TK-VN-AUTO': tag => MAIN_REGION.VN.test(tag) || RE_TK_VN.test(tag),
  'TK-JP-AUTO': tag => MAIN_REGION.JP.test(tag) || RE_TK_JP.test(tag),
  'TK-SG-AUTO': tag => MAIN_REGION.SG.test(tag) || RE_TK_SG.test(tag),
  'TK-TW-AUTO': tag => MAIN_REGION.TW.test(tag) || RE_TK_TW.test(tag),
}

const AI_RULES = {
  'OpenAI-AUTO': /openai|chatgpt|gpt[⁺+]/i,
  'Gemini-AUTO': /\b(gemini|gm)\b/i,
  'Copilot-AUTO': /\b(copilot|CP)\b/i,
  'YouTube-AUTO': /\b(youtube|yt)\b/i,
  'Netflix-AUTO': /\b(netflix|nf)\b/i,
  'Disney-AUTO': /(?<!\w)(disney\+?|d\+)(?!\w)/i,
  'AI-AUTO': /^(?=.*gpt[⁺+])(?=.*\b(gemini|gm)\b)/i,
  'CF-AUTO': /^(?=.*gpt[⁺+])(?=.*(\bX\b|twitter))/i,
}

const REGIONS = {
  'HK-AUTO': /(?:^|[^-])\b(?:HK|港|Hong\s?Kong)\b/i,
  'TW-AUTO': /(?:^|[^-])\b(?:TW|台|taiwan)\b/i,
  'JP-AUTO': /(?:^|[^-])\b(?:JP|日|japan)\b/i,
  'SG-AUTO': /(?:^|[^-])\b(?:SG|新|singapore)\b/i,
  'US-AUTO': /(?:^|[^-])\b(?:US|美|american)\b/i,
}

const GROUP_RULES = { 'AUTO': null, 'MANUAL': null, ...REGIONS, ...AI_RULES }

//  2. 获取并解析节点
let config = JSON.parse($files[0])
const subType = /^1$|col/i.test(type) ? 'collection' : 'subscription'

// 2.1 获取标准 Sing-Box 节点
let artifactStr = await produceArtifact({
  name,
  type: subType,
  platform: 'sing-box',
})
let data = JSON.parse(artifactStr)
let outbounds = data.outbounds || []
let endpoints = data.endpoints || []

// 2.2 破局核心：向 Sub-Store 借用 ClashMeta 的解析引擎，强制吐出 OpenVPN
let metaProxies = []
try {
  metaProxies = await produceArtifact({
    name,
    type: subType,
    platform: 'ClashMeta', // ClashMeta 引擎支持 OpenVPN，不会被过滤
    produceType: 'internal'
  })
} catch (e) {
  log(`⚠️ 获取 ClashMeta 引擎节点失败: ${e}`)
}

// 2.3 从 Clash 格式中精准提取 OpenVPN，并手动翻译成 Sing-Box 极简格式
const openvpnNodes = metaProxies.filter(p => p.type === 'openvpn')
if (openvpnNodes.length > 0) log(`🔥 成功通过 Meta 引擎拦截到 ${openvpnNodes.length} 个 OpenVPN 节点`)

for (const p of openvpnNodes) {
  // 组装极简 openvpn-client
  const ovpnNode = {
    type: "openvpn-client",
    tag: p.name || "ovpn-client",
    server: p.server,
    server_port: parseInt(p.port, 10),
    network: (p.udp === false || (p.proto && p.proto.toLowerCase() === 'tcp')) ? 'tcp' : 'udp',
  }

  if (p.auth) ovpnNode.auth = p.auth
  if (p.cipher) ovpnNode.cipher = p.cipher
  if (p['data-ciphers'] && p['data-ciphers'].length > 0) ovpnNode.data_ciphers = p['data-ciphers']
  if (p.username) ovpnNode.username = p.username
  if (p.password) ovpnNode.password = p.password

  // 极简 TLS 组装
  if (p.ca || p.cert || p.key || p.sni || p.server_name || p.peer) {
    ovpnNode.tls = {}
    const sni = p.sni || p.server_name || p.peer
    if (sni) ovpnNode.tls.server_name = sni
    if (p.ca) ovpnNode.tls.certificate = Array.isArray(p.ca) ? p.ca : [p.ca.trim()]
    if (p.cert) ovpnNode.tls.client_certificate = Array.isArray(p.cert) ? p.cert : [p.cert.trim()]
    if (p.key) ovpnNode.tls.client_key = Array.isArray(p.key) ? p.key : [p.key.trim()]
  }

  // 放入 endpoints 参加统一调度 (已修正: outbounds -> endpoints)
  endpoints.push(ovpnNode)
}

// 日志提示已相应修改
log(`当前可用总代理数: ${outbounds.length} 个常规出站, ${endpoints.length} 个端点(含OVPN)`)

//  3. 注入节点与性能排序
if (!Array.isArray(config.outbounds)) config.outbounds = []
config.outbounds.push(...outbounds)

if (endpoints.length > 0) {
  if (!Array.isArray(config.endpoints)) config.endpoints = []
  config.endpoints.push(...endpoints)
}

// 合并节点用于后续分组测速匹配
let proxies = [...outbounds, ...endpoints]
const speedCache = new Map()

function parseSpeed(tag) {
  if (speedCache.has(tag)) return speedCache.get(tag)
  const match = tag.match(/\|([\d.]+)MB\/s\|/)
  const speed = match ? parseFloat(match[1]) : 0
  speedCache.set(tag, speed)
  return speed
}

const proxiesSortedBySpeed = [...proxies].sort((a, b) => parseSpeed(b.tag) - parseSpeed(a.tag))

function getTags(sortedProxies, regex) {
  let list = regex ? sortedProxies.filter(p => regex.test(p.tag)) : sortedProxies
  return list.slice(0, 100).map(p => p.tag)
}

function getTikTokTagsStrict(sortedProxies, tag) {
  const matcher = TIKTOK_MAIN[tag]
  let list = sortedProxies.filter(p => RE_TIKTOK.test(p.tag) && matcher(p.tag))
  return list.slice(0, 100).map(p => p.tag)
}

//  4. 智能分组与回退策略
function normalizeOutbounds(o, tags) {
  if (o.type !== 'selector' && o.type !== 'urltest') return

  if (!Array.isArray(o.outbounds) || o.outbounds.length === 0) o.outbounds = ['AUTO']

  if (tags && tags.length > 0) {
    if (o.outbounds.length === 1 && (o.outbounds[0] === 'AUTO' || o.outbounds[0] === 'DIRECT')) {
      o.outbounds = tags.slice()
    } else {
      o.outbounds = [...new Set([...o.outbounds, ...tags])]
    }
  } else {
    if (o.type === 'urltest' && o.outbounds.length === 1 && o.outbounds[0] === 'DIRECT') {
      o.outbounds = ['AUTO']
    }
  }
}

for (const o of config.outbounds) {
  if (!o.tag || (o.type !== 'selector' && o.type !== 'urltest')) continue

  if (TIKTOK_MAIN[o.tag]) {
    normalizeOutbounds(o, getTikTokTagsStrict(proxiesSortedBySpeed, o.tag))
    continue
  }

  const rule = GROUP_RULES[o.tag]
  if (rule !== undefined) normalizeOutbounds(o, getTags(proxiesSortedBySpeed, rule))
}

//  5. 终极兜底逻辑
const COMPATIBLE_TAG = 'COMPATIBLE'
let hasCompatible = false

function injectCompatible() {
  if (!hasCompatible) {
    config.outbounds.push({ tag: COMPATIBLE_TAG, type: 'direct' })
    hasCompatible = true
  }
  return COMPATIBLE_TAG
}

for (const o of config.outbounds) {
  if (o.type === 'selector' || o.type === 'urltest') {
    normalizeOutbounds(o, [])
    if (!o.outbounds || o.outbounds.length === 0 || (o.outbounds.length === 1 && o.outbounds[0] === o.tag)) {
      o.outbounds = [injectCompatible()]
      log(`⚠️ 策略组 [${o.tag}] 触发兜底`)
    }
  }
}

log(`🔚 节点分组与合并完成`)
$content = JSON.stringify(config, null, 2)
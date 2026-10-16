function log(msg) {
  console.log(`[📦 节点分组脚本] ${msg}`)
}

const { type, name } = $arguments
log(`开始处理参数 name: ${name}, type: ${type}`)

// 地区主标识（避免 GM-US / YT-US / CP-US 这种附属地区）
const MAIN_REGION = {
  US: /(?<!-)\bUS\b/i,
  VN: /(?<!-)\bVN\b/i,
  JP: /(?<!-)\bJP\b/i,
  SG: /(?<!-)\bSG\b/i,
  TW: /(?<!-)\bTW\b/i,
}

// TikTok 通用标识
// 注：裸 TK 会匹配 STK / GTK 等子串
const RE_TIKTOK = /\bTK\b|tiktok/i

// TikTok 各地区严格匹配用的独立正则
const RE_TK_US = /TK-US/i
const RE_TK_VN = /TK-VN/i
const RE_TK_JP = /TK-JP/i
const RE_TK_SG = /TK-SG/i
const RE_TK_TW = /TK-TW/i

// TikTok 主地区标识（严格匹配）
const TIKTOK_MAIN = {
  'TK-US-AUTO': tag => MAIN_REGION.US.test(tag) || RE_TK_US.test(tag),
  'TK-VN-AUTO': tag => MAIN_REGION.VN.test(tag) || RE_TK_VN.test(tag),
  'TK-JP-AUTO': tag => MAIN_REGION.JP.test(tag) || RE_TK_JP.test(tag),
  'TK-SG-AUTO': tag => MAIN_REGION.SG.test(tag) || RE_TK_SG.test(tag),
  'TK-TW-AUTO': tag => MAIN_REGION.TW.test(tag) || RE_TK_TW.test(tag),
}

// AI / 平台正则 (同 JSON 中的 URLTest tag 严格一致)
const AI_RULES = {
  'OpenAI-AUTO': /openai|chatgpt|gpt[⁺+]/i,
  'Gemini-AUTO': /\b(gemini|gm)\b/i,
  'Copilot-AUTO': /\b(copilot|CP)\b/i,
  'YouTube-AUTO': /\b(youtube|yt)\b/i,
  'Netflix-AUTO': /\b(netflix|nf)\b/i,
  // 匹配 Disney, Disney+, D+ (使用零宽断言防止 + 号破坏单词边界)
  'Disney-AUTO': /(?<!\w)(disney\+?|d\+)(?!\w)/i,
  // gm 加单词边界，避免误中 program / mgmt 等含 "gm" 子串的 tag
  'AI-AUTO': /^(?=.*gpt[⁺+])(?=.*\b(gemini|gm)\b)/i,
  // 裸字母 X 会匹配任意含 x 的 tag（MAX / EXPRESS / NETFLIX...），
  // 加上 \b 限定为独立的 "X" 词
  'CF-AUTO': /^(?=.*gpt[⁺+])(?=.*(\bX\b|twitter))/i,
}

// 地区 AUTO 正则
const REGIONS = {
  'HK-AUTO': /(?:^|[^-])\b(?:HK|港|Hong\s?Kong)\b/i,
  'TW-AUTO': /(?:^|[^-])\b(?:TW|台|taiwan)\b/i,
  'JP-AUTO': /(?:^|[^-])\b(?:JP|日|japan)\b/i,
  'SG-AUTO': /(?:^|[^-])\b(?:SG|新|singapore)\b/i,
  'US-AUTO': /(?:^|[^-])\b(?:US|美|american)\b/i,
}

// 统一分组规则 (null 代表匹配所有节点)
const GROUP_RULES = {
  'AUTO': null,
  'MANUAL': null,
  ...REGIONS,
  ...AI_RULES,
}

// 解析配置 & 生成节点
let config = JSON.parse($files[0])

// 增加容错参数的获取节点
log(`开始获取订阅节点`)

const subType = /^1$|col/i.test(type) ? 'collection' : 'subscription'

// 2.1 获取标准 Sing-Box 节点配置
let artifactStr = await produceArtifact({
  name,
  type: subType,
  platform: 'sing-box',
})

// Sub-Store 为 sing-box 生成的是一个包含 outbounds 和 // 解析生成的 JSON 数据（分离 outbounds 和 endpoints）
let data = JSON.parse(artifactStr)
let outbounds = data.outbounds || []
let endpoints = data.endpoints || []

// 2.2 获取原始内部节点，强制提取被丢弃的 OpenVPN 节点
let rawProxies = []
try {
  rawProxies = await produceArtifact({
    name,
    type: subType,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: { 'include-unsupported-proxy': true }
  })
} catch (e) {
  log(`⚠️ 获取内部原始节点失败: ${e}`)
}

// 兼容部分旧版本环境
if (!Array.isArray(rawProxies) && typeof $proxies !== 'undefined') {
  rawProxies = $proxies
}

// 2.3 转换并拼装 OpenVPN 端点
if (Array.isArray(rawProxies)) {
  const openvpnNodes = rawProxies.filter(p => p.type === 'openvpn' || p.type === 'openvpn-client')
  if (openvpnNodes.length > 0) log(`查找到 ${openvpnNodes.length} 个 OpenVPN 原始节点，准备合并注入`)

  for (const p of openvpnNodes) {
    // 核心必填字段
    const ovpnNode = {
      type: "openvpn-client",
      tag: p.name || "ovpn-client",
      server: p.server,
      server_port: parseInt(p.port, 10),
      network: (p.udp === false || (p.proto && p.proto.toLowerCase() === 'tcp')) ? 'tcp' : 'udp',
    }

    // 选填字段（有值才注入，不生成空字符串，保持配置干净）
    if (p.auth) ovpnNode.auth = p.auth
    if (p.cipher) ovpnNode.cipher = p.cipher
    if (p['data-ciphers'] && p['data-ciphers'].length > 0) ovpnNode.data_ciphers = p['data-ciphers']
    if (p.username) ovpnNode.username = p.username
    if (p.password) ovpnNode.password = p.password

    // TLS 证书部分
    if (p.ca || p.cert || p.key || p.sni || p.server_name || p.peer) {
      ovpnNode.tls = {}
      const sni = p.sni || p.server_name || p.peer
      if (sni) ovpnNode.tls.server_name = sni
      if (p.ca) ovpnNode.tls.certificate = Array.isArray(p.ca) ? p.ca : [p.ca.trim()]
      if (p.cert) ovpnNode.tls.client_certificate = Array.isArray(p.cert) ? p.cert : [p.cert.trim()]
      if (p.key) ovpnNode.tls.client_key = Array.isArray(p.key) ? p.key : [p.key.trim()]
    }

    // 直接推入 outbounds，当做普通节点参与后续路由与测速！
    outbounds.push(ovpnNode)
  }
}

log(`成功获取 ${outbounds.length} 个常规节点, ${endpoints.length} 个 Endpoint 端点`)

// 分别注入到对应的配置数组中
if (!Array.isArray(config.outbounds)) config.outbounds = []
config.outbounds.push(...outbounds)

// Endpoint 依然保留（兼容如 WireGuard 等原生端点）
if (data.endpoints && data.endpoints.length > 0) {
  if (!Array.isArray(config.endpoints)) config.endpoints = []
  config.endpoints.push(...data.endpoints)
}

// 性能优化：速度缓存 + 全局预排序
const speedCache = new Map()

function parseSpeed(tag) {
  if (speedCache.has(tag)) return speedCache.get(tag)
  const match = tag.match(/\|([\d.]+)MB\/s\|/)
  const speed = match ? parseFloat(match[1]) : 0
  speedCache.set(tag, speed)
  return speed
}

// 只排序这一次，后面所有分组都复用这个结果
const proxiesSortedBySpeed = [...outbounds].sort((a, b) => parseSpeed(b.tag) - parseSpeed(a.tag))

// 获取分组 tag 列表（从预排序数组里过滤，最多 100 个）
function getTags(sortedProxies, regex) {
  let list = regex ? sortedProxies.filter(p => regex.test(p.tag)) : sortedProxies
  return list.slice(0, 100).map(p => p.tag)
}

// TikTok 严格匹配（所有地区），同样复用预排序数组
function getTikTokTagsStrict(sortedProxies, tag) {
  const matcher = TIKTOK_MAIN[tag]
  let list = sortedProxies.filter(p => RE_TIKTOK.test(p.tag) && matcher(p.tag))
  return list.slice(0, 100).map(p => p.tag)
}

// outbounds 归一化 & 智能填充 (支持 0 节点安全回退机制)
function normalizeOutbounds(o, tags) {
  if (o.type !== 'selector' && o.type !== 'urltest') return

  if (!Array.isArray(o.outbounds) || o.outbounds.length === 0) {
    o.outbounds = ['AUTO']
  }

  if (tags && tags.length > 0) {
    if (o.outbounds.length === 1 && (o.outbounds[0] === 'AUTO' || o.outbounds[0] === 'DIRECT')) {
      o.outbounds = tags.slice()
    } else {
      // 追加并去重
      o.outbounds = [...new Set([...o.outbounds, ...tags])]
    }
  } else {
    // 测速组空集时回退
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
  if (rule !== undefined) {
    normalizeOutbounds(o, getTags(proxiesSortedBySpeed, rule))
  }
}

// 终极兜底逻辑：注入 COMPATIBLE (直连)
const COMPATIBLE_TAG = 'COMPATIBLE'
let hasCompatible = false

function injectCompatible() {
  if (!hasCompatible) {
    config.outbounds.push({ tag: COMPATIBLE_TAG, type: 'direct' })
    hasCompatible = true
  }
  return COMPATIBLE_TAG
}

// 修复所有仍然异常的 selector/urltest
for (const o of config.outbounds) {
  if (o.type === 'selector' || o.type === 'urltest') {
    normalizeOutbounds(o, []) // 基础格式校验

    if (!o.outbounds || o.outbounds.length === 0 || (o.outbounds.length === 1 && o.outbounds[0] === o.tag)) {
      o.outbounds = [injectCompatible()]
      log(`⚠️ 警告: 策略组 [${o.tag}] 发生空集或死锁，已自动注入兜底节点`)
    }
  }
}

log(`🔚 节点分组与合并完成`)
$content = JSON.stringify(config, null, 2)
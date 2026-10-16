function log(msg) {
  console.log(`[📦 节点分组脚本] ${msg}`)
}

const { type, name } = $arguments
log(`开始处理参数 name: ${name}, type: ${type}`)

// 1. 匹配规则配置
const MAIN_REGION = {
  US: /(?<!-)\bUS\b/i,
  VN: /(?<!-)\bVN\b/i,
  JP: /(?<!-)\bJP\b/i,
  SG: /(?<!-)\bSG\b/i,
  TW: /(?<!-)\bTW\b/i
}

const RE_TIKTOK = /\bTK\b|tiktok/i
const RE_TK_US = /TK-US/i
const RE_TK_VN = /TK-VN/i
const RE_TK_JP = /TK-JP/i
const RE_TK_SG = /TK-SG/i
const RE_TK_TW = /TK-TW/i

const TIKTOK_MAIN = {
  'TK-US-AUTO': tag => MAIN_REGION.US.test(tag) || RE_TK_US.test(tag),
  'TK-VN-AUTO': tag => MAIN_REGION.VN.test(tag) || RE_TK_VN.test(tag),
  'TK-JP-AUTO': tag => MAIN_REGION.JP.test(tag) || RE_TK_JP.test(tag),
  'TK-SG-AUTO': tag => MAIN_REGION.SG.test(tag) || RE_TK_SG.test(tag),
  'TK-TW-AUTO': tag => MAIN_REGION.TW.test(tag) || RE_TK_TW.test(tag)
}

const AI_RULES = {
  'OpenAI-AUTO': /openai|chatgpt|gpt[⁺+]/i,
  'Gemini-AUTO': /\b(gemini|gm)\b/i,
  'Copilot-AUTO': /\b(copilot|CP)\b/i,
  'YouTube-AUTO': /\b(youtube|yt)\b/i,
  'Netflix-AUTO': /\b(netflix|nf)\b/i,
  'Disney-AUTO': /(?<!\w)(?:disney\+?|d\+)(?!\w)/i,
  'AI-AUTO': /^(?=.*gpt[⁺+])(?=.*\b(gemini|gm)\b)/i,
  'CF-AUTO': /^(?=.*gpt[⁺+])(?=.*(?:\bX\b|twitter))/i
}

const REGIONS = {
  'HK-AUTO': /(?:^|[^A-Za-z0-9-])(?:HK|港|Hong\s?Kong)(?=$|[^A-Za-z0-9])/i,
  'TW-AUTO': /(?:^|[^A-Za-z0-9-])(?:TW|台|taiwan)(?=$|[^A-Za-z0-9])/i,
  'JP-AUTO': /(?:^|[^A-Za-z0-9-])(?:JP|日|japan)(?=$|[^A-Za-z0-9])/i,
  'SG-AUTO': /(?:^|[^A-Za-z0-9-])(?:SG|新|singapore)(?=$|[^A-Za-z0-9])/i,
  'US-AUTO': /(?:^|[^A-Za-z0-9-])(?:US|美|american)(?=$|[^A-Za-z0-9])/i
}

const GROUP_RULES = {
  'AUTO': null,
  'MANUAL': null,
  ...REGIONS,
  ...AI_RULES
}

// 2. 解析原始配置
let config = JSON.parse($files[0])

if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.endpoints)) config.endpoints = []

const subType = /^1$|col/i.test(type) ? 'collection' : 'subscription'

// 判断 Sing-Box OpenVPN Endpoint 类型
function isOpenVPNEndpoint(node) {
  return node &&
    (node.type === 'openvpn-client' || node.type === 'openvpn-server')
}

// 按 tag 合并 Endpoint，同时清理已有重复项
function mergeEndpointsByTag(target, items) {
  const merged = []
  const seen = new Set()

  for (const node of [...target, ...items]) {
    if (!node) continue

    if (node.tag && seen.has(node.tag)) continue

    merged.push(node)

    if (node.tag) {
      seen.add(node.tag)
    }
  }

  target.splice(0, target.length, ...merged)
}

// 先迁移原始配置中误放在 outbounds 的 OpenVPN 节点
const originalOpenVPN = config.outbounds.filter(isOpenVPNEndpoint)

config.outbounds = config.outbounds.filter(
  node => !isOpenVPNEndpoint(node)
)

mergeEndpointsByTag(config.endpoints, originalOpenVPN)

if (originalOpenVPN.length > 0) {
  log(`已从原始 outbounds 迁移 ${originalOpenVPN.length} 个 OpenVPN 节点至 endpoints`)
}

// 3. 获取标准 Sing-Box 节点
const artifactStr = await produceArtifact({
  name,
  type: subType,
  platform: 'sing-box'
})

const data = JSON.parse(artifactStr)

let outbounds = Array.isArray(data.outbounds) ? data.outbounds : []
let endpoints = Array.isArray(data.endpoints) ? data.endpoints : []

// 标准产物中的 OpenVPN 也统一迁移至 endpoints
const artifactOpenVPN = outbounds.filter(isOpenVPNEndpoint)

outbounds = outbounds.filter(
  node => !isOpenVPNEndpoint(node)
)

mergeEndpointsByTag(endpoints, artifactOpenVPN)

if (artifactOpenVPN.length > 0) {
  log(`已从标准产物 outbounds 迁移 ${artifactOpenVPN.length} 个 OpenVPN 节点至 endpoints`)
}

// 4. 借用 ClashMeta 解析引擎提取 OpenVPN
let metaProxies = []

try {
  const metaResult = await produceArtifact({
    name,
    type: subType,
    platform: 'ClashMeta',
    produceType: 'internal'
  })

  if (Array.isArray(metaResult)) {
    metaProxies = metaResult
  } else if (typeof metaResult === 'string') {
    const parsed = JSON.parse(metaResult)

    if (Array.isArray(parsed)) {
      metaProxies = parsed
    } else if (parsed && Array.isArray(parsed.proxies)) {
      metaProxies = parsed.proxies
    }
  } else if (metaResult && Array.isArray(metaResult.proxies)) {
    metaProxies = metaResult.proxies
  }
} catch (e) {
  log(`⚠️ 获取 ClashMeta 引擎节点失败: ${e}`)
}

const openvpnNodes = metaProxies.filter(
  p => p && p.type === 'openvpn'
)

if (openvpnNodes.length > 0) {
  log(`🔥 成功通过 Meta 引擎拦截到 ${openvpnNodes.length} 个 OpenVPN 节点`)
}

// 将证书字段统一转换为数组
function normalizeCertificate(value) {
  if (Array.isArray(value)) {
    const result = value
      .filter(item => typeof item === 'string' && item.trim())
      .map(item => item.trim())

    return result.length > 0 ? result : null
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()]
  }

  return null
}

// 5. 转换 OpenVPN 节点并加入 endpoints
for (const p of openvpnNodes) {
  if (!p.server || !p.port) {
    log(`⚠️ 跳过缺少 server 或 port 的 OpenVPN 节点: ${p.name || 'unknown'}`)
    continue
  }

  const serverPort = parseInt(p.port, 10)

  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    log(`⚠️ 跳过端口无效的 OpenVPN 节点: ${p.name || 'unknown'}`)
    continue
  }

  const ovpnNode = {
    type: 'openvpn-client',
    tag: p.name || 'ovpn-client',
    server: p.server,
    server_port: serverPort,
    network: (
      p.udp === false ||
      (typeof p.proto === 'string' && p.proto.toLowerCase() === 'tcp')
    ) ? 'tcp' : 'udp'
  }

  if (p.auth) {
    ovpnNode.auth = p.auth
  }

  if (p.cipher) {
    ovpnNode.cipher = p.cipher
  }

  const dataCiphers = p['data-ciphers']

  if (Array.isArray(dataCiphers) && dataCiphers.length > 0) {
    ovpnNode.data_ciphers = dataCiphers
  } else if (typeof dataCiphers === 'string' && dataCiphers.trim()) {
    ovpnNode.data_ciphers = dataCiphers
      .split(/[,;]+/)
      .map(cipher => cipher.trim())
      .filter(Boolean)
  }

  if (p.username) {
    ovpnNode.username = p.username
  }

  if (p.password) {
    ovpnNode.password = p.password
  }

  const tls = {}
  const sni = p.sni || p.server_name || p.peer

  if (sni) {
    tls.server_name = sni
  }

  const ca = normalizeCertificate(p.ca)
  const cert = normalizeCertificate(p.cert)
  const key = normalizeCertificate(p.key)

  if (ca) {
    tls.certificate = ca
  }

  if (cert) {
    tls.client_certificate = cert
  }

  if (key) {
    tls.client_key = key
  }

  if (Object.keys(tls).length > 0) {
    ovpnNode.tls = tls
  }

  // 统一写入 endpoints，按 tag 去重
  mergeEndpointsByTag(endpoints, [ovpnNode])
}

log(`当前可用总代理数: ${outbounds.length} 个常规出站, ${endpoints.length} 个端点(含 OVPN)`)

// 6. 注入节点：严格区分 outbounds 和 endpoints
config.outbounds.push(
  ...outbounds.filter(node => !isOpenVPNEndpoint(node))
)

mergeEndpointsByTag(
  config.endpoints,
  endpoints.filter(node => node && node.tag)
)

// 最终兜底：清理所有 outbounds 中的 OpenVPN 节点
const misplacedOpenVPN = config.outbounds.filter(isOpenVPNEndpoint)

if (misplacedOpenVPN.length > 0) {
  config.outbounds = config.outbounds.filter(
    node => !isOpenVPNEndpoint(node)
  )

  mergeEndpointsByTag(config.endpoints, misplacedOpenVPN)

  log(`已执行最终检查，迁移 ${misplacedOpenVPN.length} 个 OpenVPN 节点至 endpoints`)
}

// 7. 合并节点，用于分组和速度排序
const proxyMap = new Map()

for (const p of [...outbounds, ...config.endpoints]) {
  if (p && p.tag && !proxyMap.has(p.tag)) {
    proxyMap.set(p.tag, p)
  }
}

const proxies = [...proxyMap.values()]
const speedCache = new Map()

function parseSpeed(tag) {
  if (speedCache.has(tag)) {
    return speedCache.get(tag)
  }

  const match = String(tag || '').match(/\|([\d.]+)MB\/s\|/i)
  const speed = match ? parseFloat(match[1]) : 0

  speedCache.set(tag, speed)

  return speed
}

const proxiesSortedBySpeed = [...proxies].sort(
  (a, b) => parseSpeed(b.tag) - parseSpeed(a.tag)
)

function getTags(sortedProxies, regex) {
  const list = regex
    ? sortedProxies.filter(p => regex.test(p.tag))
    : sortedProxies

  return list.slice(0, 100).map(p => p.tag)
}

function getTikTokTagsStrict(sortedProxies, tag) {
  const matcher = TIKTOK_MAIN[tag]

  if (!matcher) return []

  const list = sortedProxies.filter(
    p => RE_TIKTOK.test(p.tag) && matcher(p.tag)
  )

  return list.slice(0, 100).map(p => p.tag)
}

// 8. 智能分组与回退策略
function normalizeOutbounds(o, tags) {
  if (o.type !== 'selector' && o.type !== 'urltest') {
    return
  }

  if (!Array.isArray(o.outbounds) || o.outbounds.length === 0) {
    o.outbounds = ['AUTO']
  }

  if (tags && tags.length > 0) {
    if (
      o.outbounds.length === 1 &&
      (o.outbounds[0] === 'AUTO' || o.outbounds[0] === 'DIRECT')
    ) {
      o.outbounds = tags.slice()
    } else {
      o.outbounds = [...new Set([...o.outbounds, ...tags])]
    }
  } else if (
    o.type === 'urltest' &&
    o.outbounds.length === 1 &&
    o.outbounds[0] === 'DIRECT'
  ) {
    o.outbounds = ['AUTO']
  }
}

for (const o of config.outbounds) {
  if (!o.tag || (o.type !== 'selector' && o.type !== 'urltest')) {
    continue
  }

  if (TIKTOK_MAIN[o.tag]) {
    normalizeOutbounds(
      o,
      getTikTokTagsStrict(proxiesSortedBySpeed, o.tag)
    )
    continue
  }

  const rule = GROUP_RULES[o.tag]

  if (rule !== undefined) {
    normalizeOutbounds(
      o,
      getTags(proxiesSortedBySpeed, rule)
    )
  }
}

// 9. 终极兜底逻辑
const COMPATIBLE_TAG = 'COMPATIBLE'
let hasCompatible = config.outbounds.some(
  o => o.tag === COMPATIBLE_TAG
)

function injectCompatible() {
  if (!hasCompatible) {
    config.outbounds.push({
      tag: COMPATIBLE_TAG,
      type: 'direct'
    })

    hasCompatible = true
  }

  return COMPATIBLE_TAG
}

for (const o of config.outbounds) {
  if (o.type !== 'selector' && o.type !== 'urltest') {
    continue
  }

  normalizeOutbounds(o, [])

  if (
    !o.outbounds ||
    o.outbounds.length === 0 ||
    (o.outbounds.length === 1 && o.outbounds[0] === o.tag)
  ) {
    o.outbounds = [injectCompatible()]
    log(`⚠️ 策略组 [${o.tag}] 触发兜底`)
  }
}

// 10. 最终验证与输出
const remainingOpenVPN = config.outbounds.filter(isOpenVPNEndpoint)

if (remainingOpenVPN.length > 0) {
  config.outbounds = config.outbounds.filter(
    node => !isOpenVPNEndpoint(node)
  )

  mergeEndpointsByTag(config.endpoints, remainingOpenVPN)
}

log(
  `🔎 最终检查：outbounds ${config.outbounds.length} 个，endpoints ${config.endpoints.length} 个`
)

log('🔚 节点分组与合并完成')

$content = JSON.stringify(config, null, 2)
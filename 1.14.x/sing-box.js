function log(msg) { console.log(`[📦 Sing-Box 分组] ${msg}`) }
const { type, name } = $arguments

// 1. 解析参数
const subType = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'
log(`📥 开始处理 [${name}] | 参数 type: ${type} -> 判定为: ${subType}`)

// 2. 匹配规则
const MAIN_REGION = { US: /(?<!-)\bUS\b/i, VN: /(?<!-)\bVN\b/i, JP: /(?<!-)\bJP\b/i, SG: /(?<!-)\bSG\b/i, TW: /(?<!-)\bTW\b/i }
const RE_TIKTOK = /\bTK\b|tiktok/i
const RE_TK_US = /TK-US/i, RE_TK_VN = /TK-VN/i, RE_TK_JP = /TK-JP/i, RE_TK_SG = /TK-SG/i, RE_TK_TW = /TK-TW/i
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
const GROUP_RULES = { AUTO: null, MANUAL: null, ...REGIONS, ...AI_RULES }

// 3. 解析配置并统一 Endpoint
let config = JSON.parse($files[0])
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.endpoints)) config.endpoints = []

const isOpenVPN = node => node && (node.type === 'openvpn-client' || node.type === 'openvpn-server')

function fixOpenVPN(node) {
  if (isOpenVPN(node) && node.mode !== 'static_key' && node.cipher) {
    const cipher = node.cipher.toUpperCase()
    if (!node.data_ciphers?.length) node.data_ciphers = [cipher]
    if (!node.data_ciphers_fallback) node.data_ciphers_fallback = cipher
    delete node.cipher
  }
  return node
}

function mergeEndpoints(target, nodes) {
  const tags = new Set(target.map(node => node.tag).filter(Boolean))
  for (const node of nodes) {
    fixOpenVPN(node)
    if (node.tag && tags.has(node.tag)) continue
    target.push(node)
    if (node.tag) tags.add(node.tag)
  }
}

config.endpoints.forEach(fixOpenVPN)
mergeEndpoints(config.endpoints, config.outbounds.filter(isOpenVPN))
config.outbounds = config.outbounds.filter(node => !isOpenVPN(node))

// 4. 获取标准 Sing-Box 节点
const artifactStr = await produceArtifact({ name, type: subType, platform: 'sing-box' })
const data = JSON.parse(artifactStr)
let outbounds = data.outbounds || [], endpoints = data.endpoints || []
mergeEndpoints(endpoints, outbounds.filter(isOpenVPN))
outbounds = outbounds.filter(node => !isOpenVPN(node))
endpoints.forEach(fixOpenVPN)

// 5. 借用 ClashMeta 引擎提取 OpenVPN
let metaProxies = []
try {
  metaProxies = await produceArtifact({ name, type: subType, platform: 'ClashMeta', produceType: 'internal' })
  const openvpnNodes = metaProxies.filter(p => p.type === 'openvpn')
  if (openvpnNodes.length) {
    log(`🔧 借用 Meta 引擎成功拦截提取 ${openvpnNodes.length} 个 OpenVPN 节点`)
    for (const p of openvpnNodes) {
      const ovpnNode = {
        type: 'openvpn-client', tag: p.name || 'ovpn-client', server: p.server,
        server_port: parseInt(p.port, 10), network: p.udp === false || (p.proto && p.proto.toLowerCase() === 'tcp') ? 'tcp' : 'udp'
      }
      if (p.auth) ovpnNode.auth = p.auth
      const dataCiphers = p['data-ciphers'] || (p.cipher ? [p.cipher] : [])
      if (dataCiphers.length) ovpnNode.data_ciphers = (Array.isArray(dataCiphers) ? dataCiphers : dataCiphers.split(/[,;]+/)).map(cipher => cipher.trim().toUpperCase())
      if (p.cipher) ovpnNode.data_ciphers_fallback = p.cipher.toUpperCase()
      if (p.username) ovpnNode.username = p.username
      if (p.password) ovpnNode.password = p.password
      if (p.ca || p.cert || p.key || p.sni || p.server_name || p.peer) {
        ovpnNode.tls = {}
        const sni = p.sni || p.server_name || p.peer
        if (sni) ovpnNode.tls.server_name = sni
        if (p.ca) ovpnNode.tls.certificate = Array.isArray(p.ca) ? p.ca : [p.ca.trim()]
        if (p.cert) ovpnNode.tls.client_certificate = Array.isArray(p.cert) ? p.cert : [p.cert.trim()]
        if (p.key) ovpnNode.tls.client_key = Array.isArray(p.key) ? p.key : [p.key.trim()]
      }
      mergeEndpoints(endpoints, [ovpnNode])
    }
  }
} catch (e) {
  log(`❌ 获取 ClashMeta 引擎节点失败: ${e.message || e}`)
}

log(`📊 节点获取完成 | 常规出站: ${outbounds.length} 个 | 端点(含OVPN): ${endpoints.length} 个`)

// 6. 注入配置
config.outbounds.push(...outbounds.filter(node => !isOpenVPN(node)))
mergeEndpoints(config.endpoints, endpoints)
config.outbounds = config.outbounds.filter(node => !isOpenVPN(node))

// 7. 合并节点并按速度排序
const proxyMap = new Map([...outbounds, ...config.endpoints].filter(node => node.tag).map(node => [node.tag, node]))
const speedCache = new Map()
function parseSpeed(tag) {
  if (!speedCache.has(tag)) {
    const match = tag.match(/\|([\d.]+)MB\/s\|/i)
    speedCache.set(tag, match ? parseFloat(match[1]) : 0)
  }
  return speedCache.get(tag)
}
const proxiesSortedBySpeed = [...proxyMap.values()].sort((a, b) => parseSpeed(b.tag) - parseSpeed(a.tag))

function getTags(sortedProxies, regex) {
  return (regex ? sortedProxies.filter(p => regex.test(p.tag)) : sortedProxies).slice(0, 100).map(p => p.tag)
}
function getTikTokTagsStrict(sortedProxies, tag) {
  const matcher = TIKTOK_MAIN[tag]
  return matcher ? sortedProxies.filter(p => RE_TIKTOK.test(p.tag) && matcher(p.tag)).slice(0, 100).map(p => p.tag) : []
}

// 8. 智能分组与回退
function normalizeOutbounds(o, tags) {
  if (o.type !== 'selector' && o.type !== 'urltest') return
  if (!Array.isArray(o.outbounds) || !o.outbounds.length) o.outbounds = ['AUTO']
  if (tags.length) {
    if (o.outbounds.length === 1 && ['AUTO', 'DIRECT'].includes(o.outbounds[0])) o.outbounds = tags.slice()
    else o.outbounds = [...new Set([...o.outbounds, ...tags])]
  } else if (o.type === 'urltest' && o.outbounds.length === 1 && o.outbounds[0] === 'DIRECT') {
    o.outbounds = ['AUTO']
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

// 9. 无可用节点时回退到 COMPATIBLE
const COMPATIBLE_TAG = 'COMPATIBLE'
let hasCompatible = config.outbounds.some(o => o.tag === COMPATIBLE_TAG)
function injectCompatible() {
  if (!hasCompatible) {
    config.outbounds.push({ tag: COMPATIBLE_TAG, type: 'direct' })
    hasCompatible = true
  }
  return COMPATIBLE_TAG
}

const fallbackGroups = [] // 收集触发兜底的策略组名称
for (const o of config.outbounds) {
  if (o.type !== 'selector' && o.type !== 'urltest') continue
  normalizeOutbounds(o, [])
  if (!o.outbounds.length || (o.outbounds.length === 1 && o.outbounds[0] === o.tag)) {
    o.outbounds = [injectCompatible()]
    fallbackGroups.push(o.tag) // 存入数组，不直接打印
  }
}

// 聚合打印兜底警告
if (fallbackGroups.length > 0) {
  log(`⚠️ 触发直连兜底: 发现 ${fallbackGroups.length} 个策略组无可用节点 (${fallbackGroups.join(', ')})`)
}

log(`✅ 处理完成 | 最终生成出站(outbounds): ${config.outbounds.length} 个 | 端点(endpoints): ${config.endpoints.length} 个`)
$content = JSON.stringify(config, null, 2)
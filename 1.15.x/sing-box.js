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
  'YouTube-AUTO': /^(?!.*(?:CN|RU|IR)).*\b(youtube|yt)\b/i,
  'YouTube-CN': /^(?=.*(?:CN|RU|IR)).*\b(youtube|yt)\b/i,
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
  AUTO: /^(?!.*(?:CN|RU|IR)).*/i,
  MANUAL: null,
  ...REGIONS,
  ...AI_RULES
}

// 3. 🛡️ 拦截兜底逻辑：全面定义 Sing-Box 重负载网络端点类型 (内存消耗大户)
const HEAVY_ENDPOINTS = new Set([
  'wireguard', 'tailscale', 'openconnect',
  'openvpn-client', 'openvpn-server',
  'masque-client', 'masque-server'
])
const isHeavyNode = node => node && HEAVY_ENDPOINTS.has(node.type)

let config = JSON.parse($files[0])
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.endpoints)) config.endpoints = []

// 修复 OpenVPN 遗留 Cipher 格式问题
function fixOpenVPN(node) {
  if (node && (node.type === 'openvpn-client' || node.type === 'openvpn-server') && node.mode !== 'static_key' && node.cipher) {
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

// 兜底一：整理 Sub-Store 给的初始配置，如果有漏网的重型节点在 outbounds 中，强行移入 endpoints
config.endpoints.forEach(fixOpenVPN)
mergeEndpoints(config.endpoints, config.outbounds.filter(isHeavyNode))
config.outbounds = config.outbounds.filter(node => !isHeavyNode(node))

// 4. 获取标准 Sing-Box 节点
const artifactStr = await produceArtifact({ name, type: subType, platform: 'sing-box' })
const data = JSON.parse(artifactStr)
let outbounds = data.outbounds || [], endpoints = data.endpoints || []
// 兜底二：新获取的节点同样执行严格过滤
mergeEndpoints(endpoints, outbounds.filter(isHeavyNode))
outbounds = outbounds.filter(node => !isHeavyNode(node))
endpoints.forEach(fixOpenVPN)

// 5. 借用 ClashMeta 引擎补充 Sub-Store 目前缺失的 OpenVPN 节点
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

// 统一合并至总配置
config.outbounds.push(...outbounds)
mergeEndpoints(config.endpoints, endpoints)
log(`📊 节点获取完成 | 常规出站: ${config.outbounds.length} 个 | 独立端点(含兜底拦截): ${config.endpoints.length} 个`)


// 6. 速度解析与节点裂变提取
const speedCache = new Map()
function parseSpeed(tag) {
  if (typeof tag !== 'string') return 0
  if (!speedCache.has(tag)) {
    const match = tag.match(/\|([\d.]+)MB\/s\|/i)
    speedCache.set(tag, match ? parseFloat(match[1]) : 0)
  }
  return speedCache.get(tag)
}

function getBaseName(tag) {
  if (typeof tag !== 'string') return tag
  let base = tag.replace(/\|[\d.]+MB\/s\|/gi, '').trim()
  base = base.replace(/\|\+\d+$/i, '').replace(/\|已裂变$/i, '').trim()
  return base
}

const structuralTypes = new Set(['selector', 'urltest', 'direct', 'block', 'dns', 'bypass'])
const structuralTags = new Set(config.outbounds.filter(o => structuralTypes.has(o.type)).map(o => o.tag).filter(Boolean))

const allProxies = [...config.outbounds, ...config.endpoints].filter(node => node.tag && !structuralTypes.has(node.type))

// ⚡ 核心优选：全局混合排序！轻量节点与重度端点一视同仁，按速度降序。
// 这保证了后续挑选时，无论普通节点还是 WG/OVPN 端点，都是从最快的开始拿！
allProxies.sort((a, b) => parseSpeed(b.tag) - parseSpeed(a.tag))

// 7. 裂变去重：同物理机保留最高速
const uniqueProxies = []
const seenBaseNames = new Set()

for (const p of allProxies) {
  const baseName = getBaseName(p.tag)
  if (!seenBaseNames.has(baseName)) {
    seenBaseNames.add(baseName)
    uniqueProxies.push(p)
  }
}
log(`🔄 裂变去重: 原始节点 ${allProxies.length} 个 -> 去重后有效实体 ${uniqueProxies.length} 个`)

// 8. ⚠️ 双重内存保护：精准控制 Endpoints 数量
const GLOBAL_MAX_PROXIES = 100 // 全局节点数上限 (宽松)
const MAX_ENDPOINTS = 10       // 端点节点上限 (严格防 OOM，专门钳制 WG/OVPN 等大户)
const KEEP_PER_GROUP = 10      // 每个策略组保留额度
const KEEP_AUTO = 20           // AUTO 组额外保留额度

const retainedTags = new Set()
let currentEndpointCount = 0

// 标识重负载节点，作为管控的身份证 (因为在前面兜底环节，重负载都被赶进 endpoints 里了)
const endpointTagSet = new Set(config.endpoints.map(n => n.tag).filter(Boolean))

function selectAndRetain(matcher, limit, isRegex = true) {
  let matched = isRegex
    ? uniqueProxies.filter(p => matcher.test(p.tag))
    : uniqueProxies.filter(p => RE_TIKTOK.test(p.tag) && matcher(p.tag))

  const selectedTags = []
  for (const p of matched) {
    if (selectedTags.length >= limit) break

    // 判断该节点是否是重负载的 Endpoint
    const isEndpoint = endpointTagSet.has(p.tag)

    if (retainedTags.has(p.tag)) {
      selectedTags.push(p.tag)
    } else {
      // 门槛 1：检查全局限额
      if (retainedTags.size >= GLOBAL_MAX_PROXIES) continue

      // 门槛 2：⚠️ 检查 Endpoint 专属限额
      // 因为已经全局按速度排序了，所以能够进来的 Endpoint 绝对是本组测速最靠前的优质节点
      if (isEndpoint && currentEndpointCount >= MAX_ENDPOINTS) continue

      retainedTags.add(p.tag)
      if (isEndpoint) currentEndpointCount++
      selectedTags.push(p.tag)
    }
  }
  return selectedTags
}

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

// 智能装填
for (const o of config.outbounds) {
  if (!o.tag || (o.type !== 'selector' && o.type !== 'urltest')) continue

  let tagsToInject = []
  if (TIKTOK_MAIN[o.tag]) {
    tagsToInject = selectAndRetain(TIKTOK_MAIN[o.tag], KEEP_PER_GROUP, false)
  } else if (GROUP_RULES[o.tag] !== undefined) {
    const limit = o.tag === 'AUTO' ? KEEP_AUTO : KEEP_PER_GROUP
    if (GROUP_RULES[o.tag]) {
      tagsToInject = selectAndRetain(GROUP_RULES[o.tag], limit, true)
    }
  }
  normalizeOutbounds(o, tagsToInject)
}

// 9. 🧹 物理节点彻底瘦身 (剥离落榜节点，释放内存)
const beforeEndpointsCount = config.endpoints.length
const beforeOutboundsCount = config.outbounds.length

config.endpoints = config.endpoints.filter(node => retainedTags.has(node.tag))
config.outbounds = config.outbounds.filter(node => structuralTypes.has(node.type) || retainedTags.has(node.tag))

const retainedOutboundsProxies = config.outbounds.filter(n => !structuralTypes.has(n.type)).length
log(`✂️ 内存瘦身: 重负载端点 [${beforeEndpointsCount} -> ${config.endpoints.length}] | 常规代理 [${beforeOutboundsCount - config.outbounds.filter(n => structuralTypes.has(n.type)).length} -> ${retainedOutboundsProxies}]`)

// 10. 智能兜底与死链清理
const COMPATIBLE_TAG = 'COMPATIBLE'
let hasCompatible = config.outbounds.some(o => o.tag === COMPATIBLE_TAG)
function injectCompatible() {
  if (!hasCompatible) {
    config.outbounds.push({ tag: COMPATIBLE_TAG, type: 'direct' })
    hasCompatible = true
  }
  return COMPATIBLE_TAG
}

const fallbackGroups = []
for (const o of config.outbounds) {
  if (!structuralTypes.has(o.type) || (o.type !== 'selector' && o.type !== 'urltest')) continue

  o.outbounds = o.outbounds.filter(t =>
    retainedTags.has(t) ||
    structuralTags.has(t) ||
    ['DIRECT', 'REJECT', 'COMPATIBLE'].includes(t)
  )

  if (!o.outbounds.length || (o.outbounds.length === 1 && o.outbounds[0] === o.tag)) {
    o.outbounds = [injectCompatible()]
    fallbackGroups.push(o.tag)
  }
}

if (fallbackGroups.length > 0) {
  log(`⚠️ 触发直连兜底: 发现 ${fallbackGroups.length} 个策略组无可用节点 (${fallbackGroups.join(', ')})`)
}

log(`✅ 处理完成 | 生成出站(包含分组): ${config.outbounds.length} 个 | 优选端点数: ${config.endpoints.length} 个 | 实体代理总数: ${retainedTags.size} 个`)
$content = JSON.stringify(config, null, 2)
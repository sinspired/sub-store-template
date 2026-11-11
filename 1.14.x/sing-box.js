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
  MANUAL: null, // null 代表无条件全量接收（池内所有节点）
  ...REGIONS,
  ...AI_RULES
}

// 3. 🛡️ 拦截兜底逻辑：全面定义 Sing-Box 重负载端点类型
const HEAVY_ENDPOINTS = new Set([
  'wireguard', 'tailscale', 'openconnect',
  'openvpn-client', 'openvpn-server',
  'masque-client', 'masque-server'
])
const isHeavyNode = node => node && HEAVY_ENDPOINTS.has(node.type)

let config = JSON.parse($files[0])
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.endpoints)) config.endpoints = []

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

// 兜底一：把所有重型节点强行集中到 endpoints 统一看管
config.endpoints.forEach(fixOpenVPN)
mergeEndpoints(config.endpoints, config.outbounds.filter(isHeavyNode))
config.outbounds = config.outbounds.filter(node => !isHeavyNode(node))

// 4. 获取标准 Sing-Box 节点
const artifactStr = await produceArtifact({ name, type: subType, platform: 'sing-box' })
const data = JSON.parse(artifactStr)
let outbounds = data.outbounds || [], endpoints = data.endpoints || []
mergeEndpoints(endpoints, outbounds.filter(isHeavyNode))
outbounds = outbounds.filter(node => !isHeavyNode(node))
endpoints.forEach(fixOpenVPN)

// 5. 借用 Meta 引擎补充 Sub-Store 缺失的 OpenVPN
let metaProxies = []
try {
  metaProxies = await produceArtifact({ name, type: subType, platform: 'ClashMeta', produceType: 'internal' })
  const openvpnNodes = metaProxies.filter(p => p.type === 'openvpn')
  if (openvpnNodes.length) {
    log(`🔧 成功拦截补充 ${openvpnNodes.length} 个 OpenVPN 节点`)
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
  log(`❌ 获取 Meta OpenVPN 节点失败: ${e.message || e}`)
}

// 统一合并至总配置
config.outbounds.push(...outbounds)
mergeEndpoints(config.endpoints, endpoints)
log(`📊 节点初始获取: 常规出站 ${config.outbounds.length} 个 | 重负载端点 ${config.endpoints.length} 个`)

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
// 全局速度降序
allProxies.sort((a, b) => parseSpeed(b.tag) - parseSpeed(a.tag))

// 7. 裂变去重
const uniqueProxies = []
const seenBaseNames = new Set()

for (const p of allProxies) {
  const baseName = getBaseName(p.tag)
  if (!seenBaseNames.has(baseName)) {
    seenBaseNames.add(baseName)
    uniqueProxies.push(p)
  }
}
log(`🔄 去重清洗: 原始节点 ${allProxies.length} -> 独立物理服务器 ${uniqueProxies.length} 个`)

// 8. 🌟 建立【全局安全池】 (彻底解决分组缺节点的问题，同时死守内存防线)
const GLOBAL_MAX_PROXIES = 100 // 基础容量（前 100 名最快节点）
const MIN_REGION_NODES = 10    // 地区分组最低保底数量
const MAX_ENDPOINTS = 10       // 严格死守 WG/OVPN 等内存大户
const endpointTagSet = new Set(config.endpoints.map(n => n.tag).filter(Boolean))

const safePool = []
const safeTags = new Set()
let currentEndpointCount = 0

function addNodeToPool(p, bypassLimit = false) {
  if (!bypassLimit && safePool.length >= GLOBAL_MAX_PROXIES) return false
  if (safeTags.has(p.tag)) return true // 已添加过

  const isEndpoint = endpointTagSet.has(p.tag)
  // 无论是否是保底索取，重型节点死守封顶上限
  if (isEndpoint && currentEndpointCount >= MAX_ENDPOINTS) return true

  safePool.push(p)
  safeTags.add(p.tag)
  if (isEndpoint) currentEndpointCount++
  return true
}

// 阶段 1: 绝对速度优先。无条件先取全网测速最快的前 100 个节点入池。
for (const p of uniqueProxies) {
  if (safePool.length >= GLOBAL_MAX_PROXIES) break
  addNodeToPool(p)
}

// 阶段 2: 地区保底补充。如果某些地区/流媒体在前 100 里的数量太少，则向 100 名外索取。
const diversityRules = [...Object.values(TIKTOK_MAIN), ...Object.values(REGIONS)]
for (const rule of diversityRules) {
  if (!rule) continue

  // 统计当前池子里该规则节点数量
  let currentCount = 0
  for (const p of safePool) {
    const isMatch = rule.test ? rule.test(p.tag) : rule(p.tag)
    if (isMatch) currentCount++
  }

  // 如果不足保底值，从 100 名以外遍历强行补充进来
  if (currentCount < MIN_REGION_NODES) {
    let needed = MIN_REGION_NODES - currentCount
    for (const p of uniqueProxies) {
      if (needed <= 0) break
      if (safeTags.has(p.tag)) continue

      const isMatch = rule.test ? rule.test(p.tag) : rule(p.tag)
      if (isMatch) {
        const beforeSize = safeTags.size
        addNodeToPool(p, true) // bypassLimit = true, 允许总池子突破 100 的限制
        if (safeTags.size > beforeSize) needed--
      }
    }
  }
}

const retainedTags = new Set(safePool.map(p => p.tag))
log(`🛡️ 全局安全池已建立: 共萃取 ${safePool.length} 个顶级节点 (包含重度端点 ${currentEndpointCount}/${MAX_ENDPOINTS})`)

// 9. 无限制全量分发装填 (释放所有节点的并发测速潜力)
function getMatchedTags(matcher, isRegex = true) {
  // 💡 如果是 MANUAL (匹配规则为 null)，直接全量返回池子里的所有 100+ 节点！
  if (!matcher) return safePool.map(p => p.tag)

  // 💡 其他地区与 AUTO 分组，不设数量上限，全量返回安全池中所有满足条件的节点
  let matched = isRegex
    ? safePool.filter(p => matcher.test(p.tag))
    : safePool.filter(p => RE_TIKTOK.test(p.tag) && matcher(p.tag))
  return matched.map(p => p.tag)
}

function normalizeOutbounds(o, tags) {
  if (o.type !== 'selector' && o.type !== 'urltest') return
  if (!Array.isArray(o.outbounds)) o.outbounds = []
  if (tags.length) {
    // 核心修复：直接去重拼接，完美保留原有的 AUTO/DIRECT 等结构，且追加全部匹配到的节点
    o.outbounds = [...new Set([...o.outbounds, ...tags])]
  }
}

// 给所有分组按需分发节点
for (const o of config.outbounds) {
  if (!o.tag || (o.type !== 'selector' && o.type !== 'urltest')) continue

  let tagsToInject = []
  if (TIKTOK_MAIN[o.tag]) {
    tagsToInject = getMatchedTags(TIKTOK_MAIN[o.tag], false)
  } else if (GROUP_RULES[o.tag] !== undefined) {
    tagsToInject = getMatchedTags(GROUP_RULES[o.tag], true)
  }
  normalizeOutbounds(o, tagsToInject)
}

// 10. 🧹 物理节点彻底瘦身 (剥离未进入安全池的废弃节点，释放内存)
const beforeEndpointsCount = config.endpoints.length
const beforeOutboundsCount = config.outbounds.length

config.endpoints = config.endpoints.filter(node => retainedTags.has(node.tag))
config.outbounds = config.outbounds.filter(node => structuralTypes.has(node.type) || retainedTags.has(node.tag))

const retainedOutboundsProxies = config.outbounds.filter(n => !structuralTypes.has(n.type)).length
log(`✂️ 内存精简清理: 重度端点 [${beforeEndpointsCount} -> ${config.endpoints.length}] | 常规代理 [${beforeOutboundsCount - config.outbounds.filter(n => structuralTypes.has(n.type)).length} -> ${retainedOutboundsProxies}]`)

// 11. 智能兜底与死链清理
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

log(`✅ 完美装填完毕 | 生成出站总数: ${config.outbounds.length} 个 | 重负载端点数: ${config.endpoints.length} 个 | 实体代理总数: ${retainedTags.size} 个`)
$content = JSON.stringify(config, null, 2)

// Sub-Store Sing-Box 节点优选与分组脚本
/**
 * 基础用法（通常只需传 name 和 type 两个参数）：
 *   #name=sub&type=0
 * 参数说明：
 *   - name：订阅名称（必填）
 *   - type：订阅类型（支持中文）；0 / sub / 订阅 = 单订阅（默认），1 / col / 组合 / 合集 = 组合订阅
 *
 * 可选数量参数（不传则按默认值生效）：
 *   #name=sub&type=0&maxNodes=100&minRegion=5&minEndpoints=5&maxEndpoints=15&maxOpenVPN=5
 *   - maxNodes / max_nodes：全局测速优选容量上限（默认 100）
 *   - minRegion / min_region：地区与 TikTok 分组最低保底（默认 5）
 *   - minEndpoints / min_endpoints：端点独立保底数量（默认 5）
 *   - maxEndpoints / max_endpoints：端点总上限（默认 15）
 *   - maxOpenVPN / max_openvpn：OpenVPN 客户端上限（默认 5）
 */

function log(msg, level = 'INFO') {
  const badge = level === 'ERROR' ? '❌ ' : level === 'WARN' ? '⚠️ ' : ''
  const text = `[Sing-Box-分组] ${badge}${msg}`
  if (level === 'ERROR' && typeof console.error === 'function') console.error(text)
  else if (level === 'WARN' && typeof console.warn === 'function') console.warn(text)
  else console.log(text)
}

const startTime = Date.now()

function parseIntArg(val, fallback, allowZero = false) {
  if (val === undefined || val === null || val === '') return fallback
  const num = Number(val)
  if (!Number.isFinite(num)) return fallback
  const intVal = Math.floor(num)
  return allowZero ? (intVal >= 0 ? intVal : fallback) : (intVal > 0 ? intVal : fallback)
}

const args = (typeof $arguments !== 'undefined' && $arguments) || {}
const { type, name } = args

const GLOBAL_MAX_NODES = parseIntArg(args.maxNodes ?? args.max_nodes ?? args.max, 100)
const MIN_REGION_NODES = parseIntArg(args.minRegion ?? args.min_region ?? args.regionMin, 5, true)
const MAX_ENDPOINTS = parseIntArg(args.maxEndpoints ?? args.max_endpoints ?? args.epMax, 15, true)
const MIN_ENDPOINTS = Math.min(
  parseIntArg(args.minEndpoints ?? args.min_endpoints ?? args.epMin, 5, true),
  MAX_ENDPOINTS
)
const MAX_OPENVPN = Math.min(
  parseIntArg(args.maxOpenVPN ?? args.max_openvpn ?? args.ovpnMax, 5, true),
  MAX_ENDPOINTS
)

// 1. 解析参数与模板配置
const subType = /^1$|col|组合|合集/i.test(String(type || '')) ? 'collection' : 'subscription'
const sourceLabel = subType === 'collection' ? '组合订阅' : '订阅'
const subDesc = `${sourceLabel}「${name || '未命名'}」`

const fileName = (() => {
  const req = typeof $options !== 'undefined' ? $options?._req : undefined
  const raw =
    req?.params?.name ||
    (req?.path || req?.url || '').match(/\/api\/file\/([^/?#]+)/)?.[1] ||
    req?.body?.name ||
    ''
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return String(raw)
  }
})()

const startTarget = fileName ? `文件「${fileName}」（${subDesc}）` : subDesc
const endTarget = fileName ? `文件「${fileName}」处理完成（引用${subDesc}）` : `${subDesc}处理完成`

log(
  `🚀 开始处理${startTarget} | ` +
  `总优选 ${GLOBAL_MAX_NODES} / 地区保底 ${MIN_REGION_NODES} / 端点保底 ${MIN_ENDPOINTS} / 端点上限 ${MAX_ENDPOINTS} / OpenVPN上限 ${MAX_OPENVPN}`
)

const jsonParser = (typeof ProxyUtils !== 'undefined' && ProxyUtils.JSON5) ? ProxyUtils.JSON5 : JSON
let config
try {
  config = jsonParser.parse($content ?? $files[0])
} catch (e) {
  log(`模板配置解析失败：${e?.message || e}`, 'ERROR')
  throw e
}
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.endpoints)) config.endpoints = []

// 策略组与内置功能出站（含 sing-box 1.14+ 的 bridge），不计入普通代理节点
const STRUCTURAL_TYPES = new Set(['selector', 'urltest', 'direct', 'bridge', 'block', 'dns', 'bypass'])
// 客户端端点（可作为出站被 selector / urltest 引用）与服务端端点（仅做保留，不参与代理筛选）
const CLIENT_ENDPOINT_TYPES = new Set(['wireguard', 'tailscale', 'openconnect', 'openvpn-client', 'masque-client'])
const SERVER_ENDPOINT_TYPES = new Set(['openvpn-server', 'masque-server'])
const isAnyEndpoint = node => node && (CLIENT_ENDPOINT_TYPES.has(node.type) || SERVER_ENDPOINT_TYPES.has(node.type))

function countProxyOutbounds(nodes) {
  let count = 0
  for (const node of nodes) {
    if (node?.tag && !STRUCTURAL_TYPES.has(node.type)) count++
  }
  return count
}

function countClientEndpoints(nodes) {
  let total = 0
  let ovpn = 0
  for (const node of nodes) {
    if (node?.tag && !SERVER_ENDPOINT_TYPES.has(node.type)) {
      total++
      if (node.type === 'openvpn-client') ovpn++
    }
  }
  return { total, ovpn }
}

// 2. 节点匹配规则
const MAIN_REGION = {
  US: /(?<!-)\bUS\b/i,
  VN: /(?<!-)\bVN\b/i,
  JP: /(?<!-)\bJP\b/i,
  SG: /(?<!-)\bSG\b/i,
  TW: /(?<!-)\bTW\b/i
}
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

// 3. 端点迁移与 OpenVPN 字段兼容修正
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
  const tags = new Set()
  for (const n of target) {
    if (n?.tag) tags.add(n.tag)
  }
  let added = 0
  for (const node of nodes) {
    fixOpenVPN(node)
    if (node.tag && tags.has(node.tag)) continue
    target.push(node)
    added++
    if (node.tag) tags.add(node.tag)
  }
  return added
}

// 将模板 outbounds 中属于端点协议的节点迁移至 endpoints
config.endpoints.forEach(fixOpenVPN)
const templateEndpointsInOut = []
const templateCleanOut = []
for (const node of config.outbounds) {
  if (isAnyEndpoint(node)) templateEndpointsInOut.push(node)
  else templateCleanOut.push(node)
}
if (templateEndpointsInOut.length) {
  mergeEndpoints(config.endpoints, templateEndpointsInOut)
  config.outbounds = templateCleanOut
}

// 4. 并发拉取 Sing-Box 完整产物 与 ClashMeta OpenVPN 补充节点
const [singboxRes, metaRes] = await Promise.allSettled([
  produceArtifact({ name, type: subType, platform: 'sing-box' }),
  produceArtifact({ type: subType, name, platform: 'ClashMeta', produceType: 'internal' })
])

if (singboxRes.status === 'rejected') {
  throw singboxRes.reason
}

const artifactRaw = singboxRes.value
const data = typeof artifactRaw === 'string' ? JSON.parse(artifactRaw) : artifactRaw
if (!data || typeof data !== 'object' || Array.isArray(data)) {
  throw new Error('Sing-Box 产物格式异常：未返回完整配置对象')
}

const outbounds = []
const endpoints = Array.isArray(data.endpoints) ? [...data.endpoints] : []
endpoints.forEach(fixOpenVPN)

if (Array.isArray(data.outbounds)) {
  const extraEndpoints = []
  for (const node of data.outbounds) {
    if (isAnyEndpoint(node)) extraEndpoints.push(node)
    else outbounds.push(node)
  }
  if (extraEndpoints.length) mergeEndpoints(endpoints, extraEndpoints)
}

// 5. 处理 ClashMeta 引擎补充的 OpenVPN 客户端端点
if (metaRes.status === 'fulfilled') {
  try {
    const metaProxies = metaRes.value
    if (!Array.isArray(metaProxies)) throw new Error('ClashMeta internal 未返回节点数组')

    const ovpnCandidates = []
    for (const p of metaProxies) {
      if (p.type !== 'openvpn') continue
      const ovpnNode = {
        type: 'openvpn-client',
        tag: p.name || 'ovpn-client',
        server: p.server,
        server_port: parseInt(p.port, 10),
        network: p.udp === false || (p.proto && p.proto.toLowerCase() === 'tcp') ? 'tcp' : 'udp'
      }
      if (p.auth) ovpnNode.auth = p.auth
      const dataCiphers = p['data-ciphers'] || (p.cipher ? [p.cipher] : [])
      if (dataCiphers.length) {
        ovpnNode.data_ciphers = (Array.isArray(dataCiphers) ? dataCiphers : dataCiphers.split(/[,;]+/)).map(c => c.trim().toUpperCase())
      }
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
      ovpnCandidates.push(ovpnNode)
    }

    if (ovpnCandidates.length) {
      const metaOpenVPNAdded = mergeEndpoints(endpoints, ovpnCandidates)
      log(`🔧 补充 OpenVPN 客户端端点 (ClashMeta)：发现 ${ovpnCandidates.length} 个，新增 ${metaOpenVPNAdded} 个`)
    }
  } catch (e) {
    log(`OpenVPN 客户端端点补充失败：${e?.message || e}`, 'WARN')
  }
} else {
  log(`OpenVPN 客户端端点补充失败：${metaRes.reason?.message || metaRes.reason}`, 'WARN')
}

// 合并至总配置
config.outbounds.push(...outbounds)
mergeEndpoints(config.endpoints, endpoints)

const initialProxyCount = countProxyOutbounds(config.outbounds)
const initialEpStats = countClientEndpoints(config.endpoints)
log(
  `📥 载入节点：普通代理 (outbounds) ${initialProxyCount} 个，端点 (endpoints) ${initialEpStats.total} 个` +
  (initialEpStats.total ? `（OpenVPN ${initialEpStats.ovpn} / 其他 ${initialEpStats.total - initialEpStats.ovpn}）` : '')
)

// 记录模板原有策略组与内置出站 tag
const structuralTags = new Set()
for (const o of config.outbounds) {
  if (o?.tag && STRUCTURAL_TYPES.has(o.type)) structuralTags.add(o.tag)
}

// 6. 测速解析、预计算并排序去重
const RE_SPEED = /\|([\d.]+)\s*(MB|KB)\/s\|/i
const RE_STRIP_SPEED = /\|[\d.]+\s*(?:MB|KB)\/s\|/gi
const RE_STRIP_IDX = /\|\+\d+$/i
const RE_STRIP_SPLIT = /\|已裂变$/i

function parseSpeed(tag) {
  const match = RE_SPEED.exec(tag)
  if (!match) return 0
  const val = parseFloat(match[1])
  return match[2].toUpperCase() === 'MB' ? val : val / 1024
}

function getBaseName(tag) {
  return tag
    .replace(RE_STRIP_SPEED, '')
    .trim()
    .replace(RE_STRIP_IDX, '')
    .replace(RE_STRIP_SPLIT, '')
    .trim()
}

const rawProxies = []
for (const node of config.outbounds) {
  if (node?.tag && !STRUCTURAL_TYPES.has(node.type)) {
    rawProxies.push({ node, tag: node.tag, speed: parseSpeed(node.tag), isEndpoint: false, isOpenVPN: false })
  }
}
for (const node of config.endpoints) {
  if (node?.tag && !SERVER_ENDPOINT_TYPES.has(node.type)) {
    rawProxies.push({
      node,
      tag: node.tag,
      speed: parseSpeed(node.tag),
      isEndpoint: true,
      isOpenVPN: node.type === 'openvpn-client'
    })
  }
}

rawProxies.sort((a, b) => b.speed - a.speed)

const uniqueProxies = []
const seenBaseNames = new Set()
let uniqueOutboundsCount = 0
let uniqueEndpointsCount = 0

for (const item of rawProxies) {
  const baseName = getBaseName(item.tag)
  if (!seenBaseNames.has(baseName)) {
    seenBaseNames.add(baseName)
    uniqueProxies.push(item)
    if (item.isEndpoint) uniqueEndpointsCount++
    else uniqueOutboundsCount++
  }
}

const dupOutRemoved = initialProxyCount - uniqueOutboundsCount
const dupEpRemoved = initialEpStats.total - uniqueEndpointsCount
log(
  `🧹 节点去重：${rawProxies.length} → ${uniqueProxies.length} 个` +
  `（同名移除：普通代理 ${dupOutRemoved} 个，端点 ${dupEpRemoved} 个）`
)

// 7. 建立全局节点池（速度优先 + 端点独立保底 + 地区/TikTok 单遍保底）
const safePool = []
const safeTags = new Set()
const safeOutboundTags = new Set()
const safeEndpointTags = new Set()
let currentEndpointCount = 0
let currentOpenVPNCount = 0

function addItemToPool(item, bypassGlobalLimit = false) {
  if (!bypassGlobalLimit && safePool.length >= GLOBAL_MAX_NODES) return false
  if (safeTags.has(item.tag)) return false
  if (item.isEndpoint) {
    if (currentEndpointCount >= MAX_ENDPOINTS) return false
    if (item.isOpenVPN && currentOpenVPNCount >= MAX_OPENVPN) return false
  }

  safePool.push(item)
  safeTags.add(item.tag)
  if (item.isEndpoint) {
    safeEndpointTags.add(item.tag)
    currentEndpointCount++
    if (item.isOpenVPN) currentOpenVPNCount++
  } else {
    safeOutboundTags.add(item.tag)
  }
  return true
}

// 第一轮：绝对速度优先（受总优选上限与端点/OpenVPN 上限约束）
for (const item of uniqueProxies) {
  if (safePool.length >= GLOBAL_MAX_NODES) break
  addItemToPool(item, false)
}

// 第二轮：端点独立保底（避免高测速普通代理把优质 WireGuard 等端点全部挤出池外）
let endpointAddedCount = 0
if (currentEndpointCount < MIN_ENDPOINTS) {
  for (const item of uniqueProxies) {
    if (currentEndpointCount >= MIN_ENDPOINTS) break
    if (!item.isEndpoint || safeTags.has(item.tag)) continue
    if (addItemToPool(item, true)) endpointAddedCount++
  }
}

// 第三轮：地区与 TikTok 单遍统计缺口并保底补充
const diversityRules = MIN_REGION_NODES > 0
  ? [...Object.values(TIKTOK_MAIN).map(fn => tag => RE_TIKTOK.test(tag) && fn(tag)), ...Object.values(REGIONS)]
  : []

const ruleNeeds = []
for (const rule of diversityRules) {
  let count = 0
  const isReg = Boolean(rule.test)
  for (const item of safePool) {
    if ((isReg ? rule.test(item.tag) : rule(item.tag)) && ++count >= MIN_REGION_NODES) break
  }
  if (count < MIN_REGION_NODES) {
    ruleNeeds.push({ rule, isReg, needed: MIN_REGION_NODES - count })
  }
}

let regionAddedCount = 0
if (ruleNeeds.length) {
  for (const item of uniqueProxies) {
    if (safeTags.has(item.tag)) continue
    if (item.isEndpoint && (currentEndpointCount >= MAX_ENDPOINTS || (item.isOpenVPN && currentOpenVPNCount >= MAX_OPENVPN))) {
      continue
    }

    let hitsAny = false
    for (const r of ruleNeeds) {
      if (r.needed > 0 && (r.isReg ? r.rule.test(item.tag) : r.rule(item.tag))) {
        hitsAny = true
        break
      }
    }
    if (!hitsAny) continue

    if (addItemToPool(item, true)) {
      regionAddedCount++
      let remainingAll = 0
      for (const r of ruleNeeds) {
        if (r.needed > 0) {
          if (r.isReg ? r.rule.test(item.tag) : r.rule(item.tag)) r.needed--
          if (r.needed > 0) remainingAll++
        }
      }
      if (remainingAll === 0) break
    }
  }
}

const safeProxyCount = safePool.length - currentEndpointCount
const supplementParts = []
if (endpointAddedCount) supplementParts.push(`端点保底 +${endpointAddedCount}`)
if (regionAddedCount) supplementParts.push(`地区/TikTok +${regionAddedCount}`)

log(
  `🎯 优选节点池：普通代理 ${safeProxyCount} 个，端点 ${currentEndpointCount} 个（OpenVPN ${currentOpenVPNCount}），共 ${safePool.length} 个` +
  (supplementParts.length ? `（${supplementParts.join('，')}）` : '')
)

// 8. 策略组分发（客户端端点同样可作为 selector / urltest 候选出站）
const safePoolTags = safePool.map(item => item.tag)
const tikTokPoolTags = safePoolTags.filter(tag => RE_TIKTOK.test(tag))

function getMatchedTags(matcher, isRegex = true) {
  if (!matcher) return safePoolTags.slice()
  return isRegex
    ? safePoolTags.filter(tag => matcher.test(tag))
    : tikTokPoolTags.filter(tag => matcher(tag))
}

function normalizeOutbounds(outbound, tags) {
  if (!Array.isArray(outbound.outbounds)) outbound.outbounds = []
  if (!tags.length) return

  if (outbound.type === 'urltest' || outbound.outbounds.length <= 1) {
    outbound.outbounds = tags
    return
  }

  const original = outbound.outbounds.filter(tag => tag !== outbound.tag)
  outbound.outbounds = [...new Set([...original, ...tags])]
}

const updatedGroups = { selector: 0, urltest: 0 }
for (const outbound of config.outbounds) {
  if (!outbound.tag || (outbound.type !== 'selector' && outbound.type !== 'urltest')) continue

  let tagsToInject = []
  if (TIKTOK_MAIN[outbound.tag]) {
    tagsToInject = getMatchedTags(TIKTOK_MAIN[outbound.tag], false)
  } else if (GROUP_RULES[outbound.tag] !== undefined) {
    tagsToInject = getMatchedTags(GROUP_RULES[outbound.tag], true)
  }

  if (!tagsToInject.length) continue
  normalizeOutbounds(outbound, tagsToInject)
  updatedGroups[outbound.type]++
}
log(`📂 策略组更新：选择器 (selector) ${updatedGroups.selector} 个，自动测速 (urltest) ${updatedGroups.urltest} 个`)

// 9. 清理未入选节点，并统计精简原因
let epDroppedOvpnCap = 0
let epDroppedMaxCap = 0
let epDroppedSpeedRank = 0
for (const item of uniqueProxies) {
  if (!item.isEndpoint || safeEndpointTags.has(item.tag)) continue
  if (item.isOpenVPN && currentOpenVPNCount >= MAX_OPENVPN) epDroppedOvpnCap++
  else if (currentEndpointCount >= MAX_ENDPOINTS) epDroppedMaxCap++
  else epDroppedSpeedRank++
}

const seenEndpointTags = new Set(structuralTags)
config.endpoints = config.endpoints.filter(node => {
  if (!node?.tag) return false
  if (SERVER_ENDPOINT_TYPES.has(node.type)) {
    seenEndpointTags.add(node.tag)
    return true
  }
  if (!safeEndpointTags.has(node.tag) || seenEndpointTags.has(node.tag)) return false
  seenEndpointTags.add(node.tag)
  return true
})

const seenOutTags = new Set(structuralTags)
config.outbounds = config.outbounds.filter(node => {
  if (STRUCTURAL_TYPES.has(node.type)) return true
  if (!node?.tag || !safeOutboundTags.has(node.tag) || seenOutTags.has(node.tag) || seenEndpointTags.has(node.tag)) {
    return false
  }
  seenOutTags.add(node.tag)
  return true
})

const afterProxyCount = countProxyOutbounds(config.outbounds)
const afterEpStats = countClientEndpoints(config.endpoints)
const rankOutRemoved = Math.max(0, uniqueOutboundsCount - afterProxyCount)

const epDropReasons = []
if (dupEpRemoved) epDropReasons.push(`去重 ${dupEpRemoved}`)
if (epDroppedOvpnCap) epDropReasons.push(`OpenVPN上限 ${epDroppedOvpnCap}`)
if (epDroppedMaxCap) epDropReasons.push(`端点上限 ${epDroppedMaxCap}`)
if (epDroppedSpeedRank) epDropReasons.push(`节点速度未进前序 ${epDroppedSpeedRank}`)

log(
  `✂️ 内存精简：普通代理 ${initialProxyCount} → ${afterProxyCount}（去重 ${dupOutRemoved} / 节点速度淘汰 ${rankOutRemoved}），` +
  `端点 (endpoints) ${initialEpStats.total} → ${afterEpStats.total}` +
  (epDropReasons.length ? `（${epDropReasons.join(' / ')}）` : '')
)

// 10. 清理失效引用，空分组兜底并校验 selector.default
const COMPATIBLE_TAG = 'COMPATIBLE'
const RESERVED_TAGS = new Set(['DIRECT', 'REJECT', COMPATIBLE_TAG])
let hasCompatible = config.outbounds.some(outbound => outbound.tag === COMPATIBLE_TAG)

function injectCompatible() {
  if (!hasCompatible) {
    config.outbounds.push({ tag: COMPATIBLE_TAG, type: 'direct' })
    hasCompatible = true
  }
  return COMPATIBLE_TAG
}

const fallbackGroups = []
for (const outbound of config.outbounds) {
  if (outbound.type !== 'selector' && outbound.type !== 'urltest') continue

  outbound.outbounds = (Array.isArray(outbound.outbounds) ? outbound.outbounds : []).filter(tag =>
    safeTags.has(tag) || structuralTags.has(tag) || RESERVED_TAGS.has(tag)
  )

  if (!outbound.outbounds.length || (outbound.outbounds.length === 1 && outbound.outbounds[0] === outbound.tag)) {
    outbound.outbounds = [injectCompatible()]
    fallbackGroups.push(outbound.tag)
  }

  if (outbound.type === 'selector' && outbound.default && !outbound.outbounds.includes(outbound.default)) {
    delete outbound.default
  }
}

if (fallbackGroups.length) {
  log(`${fallbackGroups.length} 个策略组无可用出站，已设为直连兜底 (${COMPATIBLE_TAG})：${fallbackGroups.join(', ')}`, 'WARN')
}

// 11. 单遍汇总最终配置统计
let finalProxyCount = 0
let finalSelectorCount = 0
let finalURLTestCount = 0
let otherOutboundCount = 0

for (const node of config.outbounds) {
  if (node.type === 'selector') finalSelectorCount++
  else if (node.type === 'urltest') finalURLTestCount++
  else if (STRUCTURAL_TYPES.has(node.type)) otherOutboundCount++
  else if (node?.tag) finalProxyCount++
}
const finalEpStats = countClientEndpoints(config.endpoints)

const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

log(
  `✅ ${endTarget}：普通代理 (outbounds) ${finalProxyCount} 个，端点 (endpoints) ${finalEpStats.total} 个` +
  (finalEpStats.total ? `（OpenVPN ${finalEpStats.ovpn} / 其他 ${finalEpStats.total - finalEpStats.ovpn}）` : '') +
  ` | 出站配置 ${config.outbounds.length} 项（selector ${finalSelectorCount} / urltest ${finalURLTestCount} / 其他 ${otherOutboundCount}）` +
  ` | 耗时 ${elapsed}s`
)

$content = JSON.stringify(config, null, 2)

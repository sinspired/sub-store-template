// Sub-Store Sing-Box 节点优选与分组脚本
/**
 * 用法：#name=订阅名&type=0 （0/sub=单订阅，1/col/组合=组合订阅）
 * 版本与精简：
 *   - version=1.14 / 1.15 / 1.14-lite / 1.15-lite（<1.15 删证书固定字段，>=1.15 删 tun.stack，含 lite/ios 开启低内存精简）
 *   - lite=1 / ios=1：强制开启低内存精简（不拉取 ClashMeta/OpenVPN、删 services 与冗余规则集、错峰拉长测速）
 * 限额参数（括号内为 标准 / lite 默认值，支持传 all 不限制）：
 *   - maxNodes(100/80) / maxAuto(100/60) / minRegion(10/5) / maxRegion(20/15) / maxTikTok(随地区/3) / maxGroup(60/40)
 *   - minEndpoints(0) / maxEndpoints(15/0，设 0 跳过 OpenVPN 拉取) / maxOpenVPN(5/0)
 * 其他可选：
 *   - drop=字段1,字段2 / insecure=1 / dropRuleSets=... / noServices=1 / keepServices=1 / noDashboard=1
 *   - minInterval=15m / httpWindow=512 KB / dnsCache=256 / dualFetch=1
 */

function log(msg, level = 'INFO') {
  const badge = level === 'ERROR' ? '❌ ' : level === 'WARN' ? '⚠️ ' : ''
  const text = `[Sing-Box-分组] ${badge}${msg}`
  if (level === 'ERROR' && typeof console.error === 'function') console.error(text)
  else if (level === 'WARN' && typeof console.warn === 'function') console.warn(text)
  else console.log(text)
}

const startTime = Date.now()
const args = (typeof $arguments !== 'undefined' && $arguments) || {}
let normalizedArgs = null

function getArg(...names) {
  for (const key of names) {
    const val = args[key]
    if (val !== undefined && val !== null && val !== '') return val
  }
  if (!normalizedArgs) {
    normalizedArgs = Object.create(null)
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined || v === null || v === '') continue
      const norm = k.toLowerCase().replace(/[_-]/g, '')
      if (!(norm in normalizedArgs)) normalizedArgs[norm] = v
    }
  }
  for (const key of names) {
    const norm = key.toLowerCase().replace(/[_-]/g, '')
    if (norm in normalizedArgs) return normalizedArgs[norm]
  }
  return undefined
}

function parseIntArg(val, fallback, allowZero = false) {
  if (val === undefined || val === null || val === '') return fallback
  const num = Number(String(val).trim())
  if (!Number.isFinite(num)) return fallback
  const intVal = Math.floor(num)
  return allowZero ? (intVal >= 0 ? intVal : fallback) : (intVal > 0 ? intVal : fallback)
}

function parseLimitArg(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback
  const str = String(val).trim().toLowerCase()
  if (str === 'all' || str === 'unlimited' || str === 'inf' || str === 'infinity' || str === '-1') return Infinity
  const num = Number(str)
  if (!Number.isFinite(num)) return fallback
  const intVal = Math.floor(num)
  return intVal > 0 ? intVal : fallback
}

function parseBoolArg(val) {
  return /^(1|true|yes|on)$/i.test(String(val ?? '').trim())
}

function parseMajorMinor(ver) {
  if (ver === undefined || ver === null || valEmpty(ver)) return null
  const m = String(ver).trim().match(/(?:^|[^\d.])v?(\d+)\.(\d+)/i)
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null
}

function valEmpty(v) {
  return v === undefined || v === null || String(v).trim() === ''
}

function parseListArg(val) {
  if (val === undefined || val === null || val === '') return []
  const items = Array.isArray(val) ? val : [val]
  const out = []
  for (const item of items) {
    if (item === undefined || item === null) continue
    let text = String(item)
    try { text = decodeURIComponent(text) } catch { }
    for (const part of text.split(/[,，、;；|\s]+/)) {
      const cleaned = part.trim().replace(/^["'`]+|["'`]+$/g, '').trim()
      if (cleaned) out.push(cleaned)
    }
  }
  return out
}

function parseDurationSec(val) {
  if (val === undefined || val === null || val === '') return 0
  const s = String(val).trim()
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s)
  const re = /(\d+(?:\.\d+)?)(h|m|s|ms)/gi
  let total = 0, matched = false, m
  while ((m = re.exec(s)) !== null) {
    matched = true
    const n = Number(m[1]), unit = m[2].toLowerCase()
    if (unit === 'h') total += n * 3600
    else if (unit === 'm') total += n * 60
    else if (unit === 's') total += n
    else if (unit === 'ms') total += n / 1000
  }
  return matched ? total : 0
}

function formatDuration(sec) {
  const s = Math.max(1, Math.round(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rem = s % 60
  return `${h ? `${h}h` : ''}${m ? `${m}m` : ''}${rem || (!h && !m) ? `${rem}s` : ''}`
}

const fmtLimit = v => (Number.isFinite(v) ? String(v) : '不限')

// 1. 解析运行参数
const type = getArg('type')
const name = getArg('name')
const rawVersion = getArg('version', 'ver', 'v', 'sbVersion')
const SB_VERSION = parseMajorMinor(rawVersion)
const IS_LITE = parseBoolArg(getArg('lite', 'ios')) || /\b(lite|ios)\b/i.test(String(rawVersion ?? ''))

const GLOBAL_MAX_NODES = parseIntArg(getArg('maxNodes', 'max'), IS_LITE ? 80 : 100)
const MAX_AUTO_NODES = parseLimitArg(getArg('maxAuto', 'autoMax'), IS_LITE ? 60 : 100)
const MIN_REGION_NODES = parseIntArg(getArg('minRegion', 'regionMin'), IS_LITE ? 5 : 10, true)
const MAX_REGION_NODES = parseLimitArg(getArg('maxRegion', 'regionMax'), IS_LITE ? 15 : 20)
const rawMaxTikTok = getArg('maxTikTok', 'tiktokMax')
const MAX_TIKTOK_NODES = rawMaxTikTok !== undefined
  ? parseLimitArg(rawMaxTikTok, MAX_REGION_NODES)
  : (IS_LITE ? Math.min(3, MAX_REGION_NODES) : MAX_REGION_NODES)
const MAX_GROUP_NODES = parseLimitArg(getArg('maxGroup', 'groupMax', 'maxAI', 'aiMax'), IS_LITE ? 40 : 60)

const MAX_ENDPOINTS = parseIntArg(getArg('maxEndpoints', 'epMax'), IS_LITE ? 0 : 15, true)
const MIN_ENDPOINTS = Math.min(parseIntArg(getArg('minEndpoints', 'epMin'), IS_LITE ? 0 : 0, true), MAX_ENDPOINTS)
const MAX_OPENVPN = Math.min(parseIntArg(getArg('maxOpenVPN', 'ovpnMax'), IS_LITE ? 0 : 5, true), MAX_ENDPOINTS)

const rawKeepServices = getArg('keepServices', 'keepApi')
const rawNoServices = getArg('noServices', 'noApi', 'disableServices')
const DISABLE_SERVICES = rawKeepServices !== undefined
  ? !parseBoolArg(rawKeepServices)
  : (rawNoServices !== undefined ? parseBoolArg(rawNoServices) : IS_LITE)
const DISABLE_DASHBOARD = parseBoolArg(getArg('noDashboard', 'disableDashboard'))

const LITE_DROP_RULESETS = [
  'anti_ad',
  'geosite/category-ads-all',
  'Proxy',
  'geosite/github',
  'AliPay',
  'BiliBili',
  'geosite/apple-cn'
]
const rawDropRuleSets = getArg('dropRuleSets', 'dropRuleset', 'removeRuleSets')
const dropRuleSetList = rawDropRuleSets !== undefined
  ? parseListArg(rawDropRuleSets)
  : (IS_LITE ? LITE_DROP_RULESETS : [])

const rawMinInterval = getArg('minInterval', 'urltestInterval')
const MIN_URLTEST_SEC = rawMinInterval !== undefined ? parseDurationSec(rawMinInterval) : (IS_LITE ? 900 : 0)

const rawHttpWindow = getArg('httpWindow', 'httpClientWindow')
const HTTP_WINDOW = rawHttpWindow !== undefined ? String(rawHttpWindow).trim() : (IS_LITE ? '512 KB' : '')
const DNS_CACHE_CAP = parseIntArg(getArg('dnsCache', 'dnsCacheCapacity'), IS_LITE ? 256 : 0, true)

const CERT_PIN_INSECURE = parseBoolArg(getArg('insecure', 'fallbackInsecure'))
const dropFieldSet = new Set(parseListArg(getArg('drop', 'dropField', 'dropFields', 'remove', 'exclude')))

// TODO: 新版本发布后，移除此临时分支。1.14.x 文件夹目前必须移除 certificate_sha256 才能正常使用
if (!SB_VERSION) {
  dropFieldSet.add('certificate_sha256')
  dropFieldSet.add('client_certificate_sha256')
}

if (SB_VERSION && (SB_VERSION.major < 1 || (SB_VERSION.major === 1 && SB_VERSION.minor < 15))) {
  dropFieldSet.add('certificate_sha256')
  dropFieldSet.add('client_certificate_sha256')
}
const REMOVE_TUN_STACK = Boolean(SB_VERSION && (SB_VERSION.major > 1 || (SB_VERSION.major === 1 && SB_VERSION.minor >= 15)))
const dropFieldsList = [...dropFieldSet]

const subType = /^1$|col|组合|合集/i.test(String(type || '')) ? 'collection' : 'subscription'
const subDesc = `${subType === 'collection' ? '组合订阅' : '订阅'}「${name || '未命名'}」`

const fileName = (() => {
  const req = typeof $options !== 'undefined' ? $options?._req : undefined
  const raw = req?.params?.name || (req?.path || req?.url || '').match(/\/api\/file\/([^/?#]+)/)?.[1] || req?.body?.name || ''
  if (!raw) return ''
  try { return decodeURIComponent(raw) } catch { return String(raw) }
})()

const startTarget = fileName ? `文件「${fileName}」（${subDesc}）` : subDesc
const endTarget = fileName ? `文件「${fileName}」处理完成（引用${subDesc}）` : `${subDesc}处理完成`

const compatParts = []
if (IS_LITE) compatParts.push('Lite精简')
if (SB_VERSION) compatParts.push(`sing-box ${SB_VERSION.major}.${SB_VERSION.minor}`)
if (REMOVE_TUN_STACK) compatParts.push('移除tun.stack')
if (dropFieldsList.length) compatParts.push(`剔除[${dropFieldsList.join(',')}]`)
if (CERT_PIN_INSECURE) compatParts.push('insecure=true')

log(
  `🚀 开始处理${startTarget} | ` +
  `总池 ${GLOBAL_MAX_NODES} / AUTO≤${fmtLimit(MAX_AUTO_NODES)} / ` +
  `地区 ${MIN_REGION_NODES}~${fmtLimit(MAX_REGION_NODES)} / 分组≤${fmtLimit(MAX_GROUP_NODES)} / ` +
  `端点 ${MIN_ENDPOINTS}~${MAX_ENDPOINTS}` +
  (compatParts.length ? ` | ${compatParts.join(' / ')}` : '')
)

if (rawVersion !== undefined && !SB_VERSION && !/^(lite|ios)$/i.test(String(rawVersion).trim())) {
  log(`无法识别的版本「${rawVersion}」，已忽略版本兼容预设（示例：1.14 / 1.14-lite / 1.15）`, 'WARN')
}

const jsonParser = (typeof ProxyUtils !== 'undefined' && ProxyUtils.JSON5) ? ProxyUtils.JSON5 : JSON
let config
try {
  config = jsonParser.parse($content ?? $files[0])
} catch (e) {
  log(`模板解析失败：${e?.message || e}`, 'ERROR')
  throw e
}
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.endpoints)) config.endpoints = []

const STRUCTURAL_TYPES = new Set(['selector', 'urltest', 'direct', 'bridge', 'block', 'dns', 'bypass'])
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
  let total = 0, ovpn = 0
  for (const node of nodes) {
    if (node?.tag && !SERVER_ENDPOINT_TYPES.has(node.type)) {
      total++
      if (node.type === 'openvpn-client') ovpn++
    }
  }
  return { total, ovpn }
}

// 2. 分组匹配规则
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
const GROUP_RULES = { AUTO: /^(?!.*(?:CN|RU|IR)).*/i, MANUAL: null, ...REGIONS, ...AI_RULES }

// 3. 端点迁移与 OpenVPN 修正
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
  const tags = new Set(target.map(n => n?.tag).filter(Boolean))
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
if (MAX_ENDPOINTS === 0) {
  config.endpoints = config.endpoints.filter(n => n?.tag && SERVER_ENDPOINT_TYPES.has(n.type))
}

function extractOpenVPNCandidates(metaProxies) {
  const ovpnCandidates = []
  for (const p of metaProxies) {
    if (p?.type !== 'openvpn') continue
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
  return ovpnCandidates
}

// 4. 拉取订阅产物
const useDualFetch = parseBoolArg(getArg('dualFetch'))
let data
let ovpnCandidates = []

if (MAX_OPENVPN === 0) {
  const artifactRaw = await produceArtifact({ name, type: subType, platform: 'sing-box' })
  data = typeof artifactRaw === 'string' ? JSON.parse(artifactRaw) : artifactRaw
} else if (!useDualFetch) {
  const internalProxies = await produceArtifact({ type: subType, name, platform: 'ClashMeta', produceType: 'internal' })
  if (!Array.isArray(internalProxies)) throw new Error('ClashMeta internal 未返回节点数组')
  ovpnCandidates = extractOpenVPNCandidates(internalProxies)
  const artifactRaw = ProxyUtils.produce(internalProxies, 'sing-box')
  data = typeof artifactRaw === 'string' ? JSON.parse(artifactRaw) : artifactRaw
} else {
  const [singboxRes, metaRes] = await Promise.allSettled([
    produceArtifact({ name, type: subType, platform: 'sing-box' }),
    produceArtifact({ type: subType, name, platform: 'ClashMeta', produceType: 'internal' })
  ])
  if (singboxRes.status === 'rejected') throw singboxRes.reason
  data = typeof singboxRes.value === 'string' ? JSON.parse(singboxRes.value) : singboxRes.value
  if (metaRes.status === 'fulfilled' && Array.isArray(metaRes.value)) {
    try { ovpnCandidates = extractOpenVPNCandidates(metaRes.value) } catch (e) {
      log(`OpenVPN 端点补充失败：${e?.message || e}`, 'WARN')
    }
  } else {
    const errMsg = metaRes.status === 'rejected' ? (metaRes.reason?.message || metaRes.reason) : '未返回数组'
    log(`OpenVPN 端点补充失败：${errMsg}`, 'WARN')
  }
}

if (!data || typeof data !== 'object' || Array.isArray(data)) {
  throw new Error('Sing-Box 产物格式异常：未返回完整配置对象')
}

const outbounds = []
const endpoints = []
let discardedSubEndpoints = 0

if (Array.isArray(data.endpoints)) {
  for (const ep of data.endpoints) {
    if (MAX_ENDPOINTS === 0 && !SERVER_ENDPOINT_TYPES.has(ep?.type)) { discardedSubEndpoints++; continue }
    endpoints.push(ep)
  }
}
endpoints.forEach(fixOpenVPN)

if (Array.isArray(data.outbounds)) {
  const extraEndpoints = []
  for (const node of data.outbounds) {
    if (isAnyEndpoint(node)) {
      if (MAX_ENDPOINTS === 0 && !SERVER_ENDPOINT_TYPES.has(node.type)) discardedSubEndpoints++
      else extraEndpoints.push(node)
    } else {
      outbounds.push(node)
    }
  }
  if (extraEndpoints.length) mergeEndpoints(endpoints, extraEndpoints)
}

if (MAX_ENDPOINTS === 0) {
  log(`🚫 已禁用客户端端点：跳过 ClashMeta 拉取${discardedSubEndpoints ? `并过滤 ${discardedSubEndpoints} 个订阅端点` : ''}`)
} else if (ovpnCandidates.length) {
  const metaOpenVPNAdded = mergeEndpoints(endpoints, ovpnCandidates)
  log(`🔧 补充 OpenVPN 端点：发现 ${ovpnCandidates.length} 个，新增 ${metaOpenVPNAdded} 个`)
}

config.outbounds.push(...outbounds)
if (endpoints.length) mergeEndpoints(config.endpoints, endpoints)

const initialProxyCount = countProxyOutbounds(config.outbounds)
const initialEpStats = countClientEndpoints(config.endpoints)
log(
  `📥 载入节点：普通代理 ${initialProxyCount} 个，端点 ${initialEpStats.total} 个` +
  (initialEpStats.total ? `（OpenVPN ${initialEpStats.ovpn} / 其他 ${initialEpStats.total - initialEpStats.ovpn}）` : '')
)

const structuralTags = new Set()
for (const o of config.outbounds) {
  if (o?.tag && STRUCTURAL_TYPES.has(o.type)) structuralTags.add(o.tag)
}

// 5. 测速排序与同名去重
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
  return tag.replace(RE_STRIP_SPEED, '').trim().replace(RE_STRIP_IDX, '').replace(RE_STRIP_SPLIT, '').trim()
}

const rawProxies = []
for (const node of config.outbounds) {
  if (node?.tag && !STRUCTURAL_TYPES.has(node.type)) {
    rawProxies.push({ node, tag: node.tag, speed: parseSpeed(node.tag), isEndpoint: false, isOpenVPN: false, rank: 0 })
  }
}
if (MAX_ENDPOINTS > 0) {
  for (const node of config.endpoints) {
    if (node?.tag && !SERVER_ENDPOINT_TYPES.has(node.type)) {
      rawProxies.push({ node, tag: node.tag, speed: parseSpeed(node.tag), isEndpoint: true, isOpenVPN: node.type === 'openvpn-client', rank: 0 })
    }
  }
}

rawProxies.sort((a, b) => b.speed - a.speed)

const uniqueProxies = []
const seenBaseNames = new Set()
let uniqueOutboundsCount = 0, uniqueEndpointsCount = 0

for (const item of rawProxies) {
  const baseName = getBaseName(item.tag)
  if (!seenBaseNames.has(baseName)) {
    seenBaseNames.add(baseName)
    item.rank = uniqueProxies.length
    uniqueProxies.push(item)
    if (item.isEndpoint) uniqueEndpointsCount++
    else uniqueOutboundsCount++
  }
}

const dupOutRemoved = initialProxyCount - uniqueOutboundsCount
const dupEpRemoved = initialEpStats.total - uniqueEndpointsCount
log(`🧹 去重：${rawProxies.length} → ${uniqueProxies.length} 个（移除同名：代理 ${dupOutRemoved} / 端点 ${dupEpRemoved}）`)

// 6. 构建全局优选池（速度优先 + 端点保底 + 地区/TikTok 保底）
const safePool = []
const safeTags = new Set()
const safeOutboundTags = new Set()
const safeEndpointTags = new Set()
let currentEndpointCount = 0, currentOpenVPNCount = 0

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

for (const item of uniqueProxies) {
  if (safePool.length >= GLOBAL_MAX_NODES) break
  addItemToPool(item, false)
}

let endpointAddedCount = 0
if (currentEndpointCount < MIN_ENDPOINTS) {
  for (const item of uniqueProxies) {
    if (currentEndpointCount >= MIN_ENDPOINTS) break
    if (!item.isEndpoint || safeTags.has(item.tag)) continue
    if (addItemToPool(item, true)) endpointAddedCount++
  }
}

const diversitySpecs = MIN_REGION_NODES > 0
  ? [
    ...Object.values(TIKTOK_MAIN).map(fn => ({ rule: tag => RE_TIKTOK.test(tag) && fn(tag), isReg: false, targetMin: Math.min(MIN_REGION_NODES, MAX_TIKTOK_NODES) })),
    ...Object.values(REGIONS).map(reg => ({ rule: reg, isReg: true, targetMin: Math.min(MIN_REGION_NODES, MAX_REGION_NODES) }))
  ]
  : []

const ruleNeeds = []
for (const spec of diversitySpecs) {
  if (spec.targetMin <= 0) continue
  let count = 0
  for (const item of safePool) {
    if ((spec.isReg ? spec.rule.test(item.tag) : spec.rule(item.tag)) && ++count >= spec.targetMin) break
  }
  if (count < spec.targetMin) ruleNeeds.push({ rule: spec.rule, isReg: spec.isReg, needed: spec.targetMin - count })
}

let regionAddedCount = 0
if (ruleNeeds.length) {
  for (const item of uniqueProxies) {
    if (safeTags.has(item.tag)) continue
    if (item.isEndpoint && (currentEndpointCount >= MAX_ENDPOINTS || (item.isOpenVPN && currentOpenVPNCount >= MAX_OPENVPN))) continue

    let hitsAny = false
    for (const r of ruleNeeds) {
      if (r.needed > 0 && (r.isReg ? r.rule.test(item.tag) : r.rule(item.tag))) { hitsAny = true; break }
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

// 保底追加后按 rank 恢复总池优先级顺序，确保分组裁剪同取最优节点
if (endpointAddedCount > 0 || regionAddedCount > 0) {
  safePool.sort((a, b) => a.rank - b.rank)
}

const supplementParts = []
if (endpointAddedCount) supplementParts.push(`端点保底 +${endpointAddedCount}`)
if (regionAddedCount) supplementParts.push(`地区/TK +${regionAddedCount}`)
log(
  `🎯 优选池：代理 ${safePool.length - currentEndpointCount} 个，端点 ${currentEndpointCount} 个` +
  (currentOpenVPNCount ? `（OpenVPN ${currentOpenVPNCount}）` : '') +
  `，共 ${safePool.length} 个` +
  (supplementParts.length ? `（${supplementParts.join('，')}）` : '')
)

// 7. 策略组分发（严格按优序早停截断）
const safePoolTags = safePool.map(item => item.tag)
let tikTokPoolTags = null

function getMatchedTags(matcher, isRegex = true, limit = Infinity, isTikTok = false) {
  if (!matcher) return Number.isFinite(limit) ? safePoolTags.slice(0, limit) : safePoolTags.slice()
  let source = safePoolTags
  if (isTikTok) {
    if (!tikTokPoolTags) tikTokPoolTags = safePoolTags.filter(tag => RE_TIKTOK.test(tag))
    source = tikTokPoolTags
  }
  const matched = []
  for (let i = 0; i < source.length; i++) {
    const tag = source[i]
    if (isRegex ? matcher.test(tag) : matcher(tag)) {
      matched.push(tag)
      if (matched.length >= limit) break
    }
  }
  return matched
}

function getGroupLimit(tag) {
  if (tag === 'AUTO') return MAX_AUTO_NODES
  if (Object.prototype.hasOwnProperty.call(REGIONS, tag)) return MAX_REGION_NODES
  if (Object.prototype.hasOwnProperty.call(AI_RULES, tag)) return MAX_GROUP_NODES
  return Infinity
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
let maxUrltestLen = 0
for (const outbound of config.outbounds) {
  if (!outbound.tag || (outbound.type !== 'selector' && outbound.type !== 'urltest')) continue
  let tagsToInject = []
  if (TIKTOK_MAIN[outbound.tag]) tagsToInject = getMatchedTags(TIKTOK_MAIN[outbound.tag], false, MAX_TIKTOK_NODES, true)
  else if (GROUP_RULES[outbound.tag] !== undefined) tagsToInject = getMatchedTags(GROUP_RULES[outbound.tag], true, getGroupLimit(outbound.tag), false)
  if (!tagsToInject.length) continue
  normalizeOutbounds(outbound, tagsToInject)
  updatedGroups[outbound.type]++
  if (outbound.type === 'urltest' && tagsToInject.length > maxUrltestLen) maxUrltestLen = tagsToInject.length
}
log(`📂 策略组：selector ${updatedGroups.selector} 个，urltest ${updatedGroups.urltest} 个（单组测速上限 ${maxUrltestLen}）`)

// 8. 清理未入选节点与失效引用
const seenEndpointTags = new Set(structuralTags)
config.endpoints = config.endpoints.filter(node => {
  if (!node?.tag) return false
  if (SERVER_ENDPOINT_TYPES.has(node.type)) { seenEndpointTags.add(node.tag); return true }
  if (!safeEndpointTags.has(node.tag) || seenEndpointTags.has(node.tag)) return false
  seenEndpointTags.add(node.tag)
  return true
})

const seenOutTags = new Set(structuralTags)
config.outbounds = config.outbounds.filter(node => {
  if (STRUCTURAL_TYPES.has(node.type)) return true
  if (!node?.tag || !safeOutboundTags.has(node.tag) || seenOutTags.has(node.tag) || seenEndpointTags.has(node.tag)) return false
  seenOutTags.add(node.tag)
  return true
})

const afterProxyCount = countProxyOutbounds(config.outbounds)
const afterEpStats = countClientEndpoints(config.endpoints)
log(`✂️ 精简：代理 ${initialProxyCount} → ${afterProxyCount}，端点 ${initialEpStats.total} → ${afterEpStats.total}`)

const COMPATIBLE_TAG = 'COMPATIBLE'
const RESERVED_TAGS = new Set(['DIRECT', 'REJECT', COMPATIBLE_TAG])
let hasCompatible = config.outbounds.some(outbound => outbound.tag === COMPATIBLE_TAG)
function injectCompatible() {
  if (!hasCompatible) { config.outbounds.push({ tag: COMPATIBLE_TAG, type: 'direct' }); hasCompatible = true }
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
if (fallbackGroups.length) log(`空分组兜底 (${COMPATIBLE_TAG})：${fallbackGroups.join(', ')}`, 'WARN')

// 9. Lite 轻量运行时优化
const optNotes = []

if (DISABLE_SERVICES && Array.isArray(config.services) && config.services.length) {
  const n = config.services.length
  delete config.services
  optNotes.push(`移除 services×${n}`)
} else if (DISABLE_DASHBOARD && Array.isArray(config.services)) {
  let n = 0
  for (const svc of config.services) {
    if (svc?.type === 'api' && svc.dashboard) { svc.dashboard = { enabled: false }; n++ }
  }
  if (n) optNotes.push(`禁用 dashboard×${n}`)
}

if (dropRuleSetList.length) {
  const dropSet = new Set(dropRuleSetList)
  let removedRs = 0
  if (Array.isArray(config.route?.rule_set)) {
    const nextRs = []
    for (const rs of config.route.rule_set) {
      if (!rs) continue
      if (typeof rs.tag === 'string') { if (dropSet.has(rs.tag)) { removedRs++; continue } }
      else if (Array.isArray(rs.tag)) {
        const kept = rs.tag.filter(t => !dropSet.has(t))
        removedRs += rs.tag.length - kept.length
        if (!kept.length) continue
        rs.tag = kept
      }
      nextRs.push(rs)
    }
    config.route.rule_set = nextRs
  }

  const NON_MATCH_KEYS = new Set(['rule_set', 'outbound', 'action', 'server', 'timeout', 'disable_cache'])
  const pruneRules = rules => {
    if (!Array.isArray(rules)) return rules
    const next = []
    for (const rule of rules) {
      if (!rule) continue
      if (typeof rule.rule_set === 'string') {
        if (dropSet.has(rule.rule_set)) {
          if (!Object.keys(rule).some(k => !NON_MATCH_KEYS.has(k))) continue
          delete rule.rule_set
        }
      } else if (Array.isArray(rule.rule_set)) {
        const kept = rule.rule_set.filter(t => !dropSet.has(t))
        if (!kept.length) {
          if (!Object.keys(rule).some(k => !NON_MATCH_KEYS.has(k))) continue
          delete rule.rule_set
        } else rule.rule_set = kept
      }
      next.push(rule)
    }
    return next
  }

  if (config.route?.rules) config.route.rules = pruneRules(config.route.rules)
  if (config.dns?.rules) config.dns.rules = pruneRules(config.dns.rules)
  if (removedRs > 0) optNotes.push(`剔除 rule_set ${removedRs} 个`)
}

if (MIN_URLTEST_SEC > 0) {
  let tuned = 0, idx = 0
  for (const outbound of config.outbounds) {
    if (outbound.type !== 'urltest') continue
    if ((parseDurationSec(outbound.interval) || 180) < MIN_URLTEST_SEC) {
      outbound.interval = formatDuration(MIN_URLTEST_SEC + idx * 67)
      idx++
      tuned++
    }
    if (!outbound.idle_timeout) outbound.idle_timeout = '30m0s'
  }
  if (tuned) optNotes.push(`错峰放宽 ${tuned} 组测速≥${formatDuration(MIN_URLTEST_SEC)}`)
}

if (HTTP_WINDOW && Array.isArray(config.http_clients)) {
  let tuned = 0
  for (const hc of config.http_clients) {
    if (!hc || typeof hc !== 'object') continue
    hc.stream_receive_window = HTTP_WINDOW
    hc.connection_receive_window = HTTP_WINDOW
    if (IS_LITE && (!hc.max_concurrent_streams || hc.max_concurrent_streams > 4)) hc.max_concurrent_streams = 4
    tuned++
  }
  if (tuned) optNotes.push(`http窗口=${HTTP_WINDOW}`)
}

if (DNS_CACHE_CAP > 0 && config.dns && (!config.dns.cache_capacity || config.dns.cache_capacity > DNS_CACHE_CAP)) {
  config.dns.cache_capacity = DNS_CACHE_CAP
  optNotes.push(`dns缓存=${DNS_CACHE_CAP}`)
}

if (optNotes.length) log(`📱 轻量优化：${optNotes.join(' | ')}`)

// 10. 版本与字段兼容剔除
function deleteByPath(target, parts, depth, statKey, stats) {
  if (!target || typeof target !== 'object') return 0
  if (Array.isArray(target)) {
    let count = 0
    for (let i = 0; i < target.length; i++) {
      if (target[i] && typeof target[i] === 'object') count += deleteByPath(target[i], parts, depth, statKey, stats)
    }
    return count
  }
  const key = parts[depth]
  if (!Object.prototype.hasOwnProperty.call(target, key)) return 0
  if (depth === parts.length - 1) {
    if (CERT_PIN_INSECURE && key === 'certificate_sha256' && target.insecure !== true) {
      target.insecure = true
      stats.insecurePatched++
    }
    delete target[key]
    stats.byField[statKey] = (stats.byField[statKey] || 0) + 1
    return 1
  }
  return deleteByPath(target[key], parts, depth + 1, statKey, stats)
}

function deleteBareKeys(target, keySet, stats) {
  if (!target || typeof target !== 'object') return 0
  let count = 0
  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      if (target[i] && typeof target[i] === 'object') count += deleteBareKeys(target[i], keySet, stats)
    }
    return count
  }
  for (const key of Object.keys(target)) {
    if (keySet.has(key)) {
      if (CERT_PIN_INSECURE && key === 'certificate_sha256' && target.insecure !== true) {
        target.insecure = true
        stats.insecurePatched++
      }
      delete target[key]
      stats.byField[key] = (stats.byField[key] || 0) + 1
      count++
    } else if (target[key] && typeof target[key] === 'object') {
      count += deleteBareKeys(target[key], keySet, stats)
    }
  }
  return count
}

if (dropFieldsList.length || REMOVE_TUN_STACK) {
  const compatStats = { byField: {}, insecurePatched: 0 }
  let removedTotal = 0

  if (REMOVE_TUN_STACK && Array.isArray(config.inbounds)) {
    for (const ib of config.inbounds) {
      if (ib?.type === 'tun' && Object.prototype.hasOwnProperty.call(ib, 'stack')) {
        delete ib.stack
        compatStats.byField['tun.stack'] = (compatStats.byField['tun.stack'] || 0) + 1
        removedTotal++
      }
    }
  }

  if (dropFieldsList.length) {
    const bareKeys = new Set(), pathRules = []
    for (const field of dropFieldsList) {
      if (field.includes('.')) {
        const rootOnly = field.startsWith('$.')
        const parts = (rootOnly ? field.slice(2) : field).split('.').filter(Boolean)
        if (parts.length) pathRules.push({ field, parts, rootOnly })
      } else bareKeys.add(field)
    }

    if (bareKeys.size) removedTotal += deleteBareKeys(config, bareKeys, compatStats)
    for (const rule of pathRules) {
      if (rule.rootOnly) removedTotal += deleteByPath(config, rule.parts, 0, rule.field, compatStats)
      else {
        removedTotal += deleteByPath(config.outbounds, rule.parts, 0, rule.field, compatStats)
        removedTotal += deleteByPath(config.endpoints, rule.parts, 0, rule.field, compatStats)
        if (rule.parts[0] !== 'outbounds' && rule.parts[0] !== 'endpoints' && Object.prototype.hasOwnProperty.call(config, rule.parts[0])) {
          removedTotal += deleteByPath(config, rule.parts, 0, rule.field, compatStats)
        }
      }
    }
  }

  if (removedTotal > 0) {
    const detail = Object.entries(compatStats.byField).map(([k, v]) => `${k}×${v}`).join(', ')
    log(
      `🛡️ 兼容处理：已移除 ${removedTotal} 处字段（${detail}）` +
      (compatStats.insecurePatched ? `，并补全 ${compatStats.insecurePatched} 处 tls.insecure=true` : '')
    )
  }
}

// 11. 输出统计
let finalProxyCount = 0, finalSelectorCount = 0, finalURLTestCount = 0, otherOutboundCount = 0
for (const node of config.outbounds) {
  if (node.type === 'selector') finalSelectorCount++
  else if (node.type === 'urltest') finalURLTestCount++
  else if (STRUCTURAL_TYPES.has(node.type)) otherOutboundCount++
  else if (node?.tag) finalProxyCount++
}
const finalEpStats = countClientEndpoints(config.endpoints)
const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

log(
  `✅ ${endTarget}：代理 ${finalProxyCount} 个，端点 ${finalEpStats.total} 个` +
  (finalEpStats.total ? `（OpenVPN ${finalEpStats.ovpn} / 其他 ${finalEpStats.total - finalEpStats.ovpn}）` : '') +
  ` | 出站 ${config.outbounds.length} 项（selector ${finalSelectorCount} / urltest ${finalURLTestCount} / 其他 ${otherOutboundCount}）` +
  ` | ${elapsed}s`
)

$content = JSON.stringify(config, null, 2)
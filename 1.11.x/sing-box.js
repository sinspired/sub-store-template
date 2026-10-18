function log(msg) { console.log(`[📦 节点分组脚本] ${msg}`) }
const { type, name } = $arguments
log(`开始处理参数 name: ${name}, type: ${type}`)

// 1. 匹配规则
const MAIN_REGION = { US: /(?<!-)\bUS\b/i, VN: /(?<!-)\bVN\b/i, JP: /(?<!-)\bJP\b/i, SG: /(?<!-)\bSG\b/i, TW: /(?<!-)\bTW\b/i }
const RE_TIKTOK = /\bTK\b|tiktok/i
const RE_TK_US = /TK-US/i, RE_TK_VN = /TK-VN/i, RE_TK_JP = /TK-JP/i, RE_TK_SG = /TK-SG/i, RE_TK_TW = /TK-TW/i

const TIKTOK_MAIN = {
  'TIKTOK-US': tag => MAIN_REGION.US.test(tag) || RE_TK_US.test(tag),
  'TIKTOK-VN': tag => MAIN_REGION.VN.test(tag) || RE_TK_VN.test(tag),
  'TIKTOK-JP': tag => MAIN_REGION.JP.test(tag) || RE_TK_JP.test(tag),
  'TIKTOK-SG': tag => MAIN_REGION.SG.test(tag) || RE_TK_SG.test(tag),
  'TIKTOK-TW': tag => MAIN_REGION.TW.test(tag) || RE_TK_TW.test(tag)
}

const AI_RULES = {
  'OpenAI': /openai|chatgpt|gpt[⁺+]/i,
  'Gemini': /\b(gemini|gm)\b/i,
  'Copilot': /\b(copilot|CP)\b/i,
  'Youtube': /\b(youtube|yt)\b/i,
  'AI-plus': /^(?=.*gpt[⁺+])(?=.*\b(gemini|gm)\b)/i,
  'CF优选': /^(?=.*gpt[⁺+])(?=.*(?:\bX\b|twitter))/i
}

const REGIONS = {
  'HK AUTO': /(?:^|[^A-Za-z0-9-])(?:HK|港|Hong\s?Kong)(?=$|[^A-Za-z0-9])/i,
  'TW AUTO': /(?:^|[^A-Za-z0-9-])(?:TW|台|taiwan)(?=$|[^A-Za-z0-9])/i,
  'JP AUTO': /(?:^|[^A-Za-z0-9-])(?:JP|日|japan)(?=$|[^A-Za-z0-9])/i,
  'SG AUTO': /(?:^|[^A-Za-z0-9-])(?:SG|新|singapore)(?=$|[^A-Za-z0-9])/i,
  'US AUTO': /(?:^|[^A-Za-z0-9-])(?:US|美|american)(?=$|[^A-Za-z0-9])/i
}

const GROUP_RULES = { 'AUTO': null, ...REGIONS, ...AI_RULES }

// 2. 解析基础配置并初始化
let config = JSON.parse($files[0])
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.endpoints)) config.endpoints = []

// 3. 兼容中文与拼音传参 (支持 "组合" / "组合订阅" / "col" / "1")
const subType = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'
log(`判定订阅类型为: ${subType}`)

// 取消 internal 模式，直接获取平台原生的标准 JSON 字符串（自带 outbounds 和 endpoints）
let artifactStr = await produceArtifact({
  name,
  type: subType,
  platform: 'sing-box'
})

let artifactData = JSON.parse(artifactStr)
let sourceOutbounds = artifactData.outbounds || []
let sourceEndpoints = artifactData.endpoints || [] // Sub-Store 自动会将 wireguard 等提取到这里

// 4. 过滤掉 Sing-box 1.11 不支持的协议
// 1.11 不支持 anytls，也尚未支持 openvpn
const isUnsupported = p => p.type === 'anytls' || p.type === 'openvpn' || p.type === 'openvpn-client'

let validOutbounds = sourceOutbounds.filter(p => !isUnsupported(p))
let validEndpoints = sourceEndpoints.filter(p => !isUnsupported(p))

log(`节点解析完成: ${validOutbounds.length} 个出站, ${validEndpoints.length} 个端点`)

// 注入节点与端点
config.outbounds.push(...validOutbounds)
config.endpoints.push(...validEndpoints)

// 合并起来用于提取 Tag 和策略组关联
const allValidNodes = [...validOutbounds, ...validEndpoints]

// 5. 按速度排序与缓存优化（从 Tag 提取测速数据）
const speedCache = new Map()
function parseSpeed(tag) {
  if (!speedCache.has(tag)) {
    const match = tag.match(/\|([\d.]+)MB\/s\|/i)
    speedCache.set(tag, match ? parseFloat(match[1]) : 0)
  }
  return speedCache.get(tag)
}

const proxiesSortedBySpeed = allValidNodes.sort((a, b) => parseSpeed(b.tag) - parseSpeed(a.tag))

function getTags(sortedProxies, regex) {
  return (regex ? sortedProxies.filter(p => regex.test(p.tag)) : sortedProxies).slice(0, 50).map(p => p.tag)
}

function getTikTokTagsStrict(sortedProxies, tag) {
  const matcher = TIKTOK_MAIN[tag]
  return matcher ? sortedProxies.filter(p => RE_TIKTOK.test(p.tag) && matcher(p.tag)).slice(0, 50).map(p => p.tag) : []
}

// 6. 智能分组注入
function normalizeOutbounds(o, tags) {
  if (!Array.isArray(o.outbounds)) o.outbounds = []
  // 清理可能由于模板预设产生的空字符串和 null
  o.outbounds = o.outbounds.filter(v => v !== null && v !== "")
  if (tags.length > 0) {
    o.outbounds.push(...tags)
  }
  // 去重
  o.outbounds = [...new Set(o.outbounds)]
}

for (const o of config.outbounds) {
  if (!o.tag || (o.type !== 'selector' && o.type !== 'urltest')) continue

  // 匹配 TikTok 规则
  if (TIKTOK_MAIN[o.tag]) {
    normalizeOutbounds(o, getTikTokTagsStrict(proxiesSortedBySpeed, o.tag))
    continue
  }

  // 匹配地区与 AI 规则
  const rule = GROUP_RULES[o.tag]
  if (rule !== undefined) {
    normalizeOutbounds(o, getTags(proxiesSortedBySpeed, rule))
  }
}

// 7. 无可用节点时回退到 COMPATIBLE (直连兜底)
const COMPATIBLE_TAG = 'COMPATIBLE'
let hasCompatible = config.outbounds.some(o => o.tag === COMPATIBLE_TAG)

function injectCompatible() {
  if (!hasCompatible) {
    config.outbounds.push({ tag: COMPATIBLE_TAG, type: 'direct' })
    hasCompatible = true
  }
  return COMPATIBLE_TAG
}

for (const o of config.outbounds) {
  if (o.type !== 'selector' && o.type !== 'urltest') continue

  if (!o.outbounds.length || (o.outbounds.length === 1 && o.outbounds[0] === o.tag)) {
    o.outbounds = [injectCompatible()]
    log(`⚠️ 策略组 [${o.tag}] 为空，已触发 COMPATIBLE 兜底`)
  }
}

log('🔚 节点分组与合并完成')
$content = JSON.stringify(config, null, 2)
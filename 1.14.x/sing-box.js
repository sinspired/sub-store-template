const { type, name } = $arguments

// 正则 & 分组规则

// 地区正则
const REGIONS = {
  HK: /(?:^|[^-])\b(?:HK|港|Hong\s?Kong)\b/i,
  TW: /(?:^|[^-])\b(?:TW|台|taiwan)\b/i,
  JP: /(?:^|[^-])\b(?:JP|日|japan)\b/i,
  SG: /(?:^|[^-])\b(?:SG|新|singapore)\b/i,
  US: /(?:^|[^-])\b(?:US|美|american)\b/i,
}

// TikTok 通用标识
const RE_TIKTOK = /TK|tiktok/i

// TikTok 地区正则
const TIKTOK_REGION = {
  'TIKTOK-US': /\bUS\b|TK-US/i,
  'TIKTOK-VN': /\bVN\b|TK-VN/i,
  'TIKTOK-JP': /\bJP\b|TK-JP/i,
  'TIKTOK-SG': /\bSG\b|TK-SG/i,
  'TIKTOK-TW': /\bTW\b|TK-TW/i,
}

// AI / 平台正则
const AI_RULES = {
  OpenAI: /openai|chatgpt|gpt⁺/i,
  Gemini: /\b(gemini|gm)\b/i,
  Copilot: /\b(copilot|CP)\b/i,
  Youtube: /\b(youtube|yt)\b/i,
  'AI-plus': /^(?=.*gpt⁺)(?=.*(gemini|gm))/i,
  'CF优选': /^(?=.*gpt⁺)(?=.*(X|twitter))/i,
}

// 分组规则（selector / urltest 都可用）
const GROUP_RULES = {
  // 自动分组
  'AUTO': null,

  // 地区 AUTO
  'HK AUTO': REGIONS.HK,
  'TW AUTO': REGIONS.TW,
  'JP AUTO': REGIONS.JP,
  'SG AUTO': REGIONS.SG,
  'US AUTO': REGIONS.US,

  // TikTok 分组
  ...TIKTOK_REGION,

  // AI 系列
  ...AI_RULES,
}

// 解析配置 & 生成节点
let config = JSON.parse($files[0])

let proxies = await produceArtifact({
  name,
  type: /^1$|col/i.test(type) ? 'collection' : 'subscription',
  platform: 'sing-box',
  produceType: 'internal',
})

// 注入节点（原始 outbounds + 新节点）
config.outbounds.push(...proxies)

// 速度缓存
const speedCache = new Map()

function parseSpeed(tag) {
  if (speedCache.has(tag)) return speedCache.get(tag)
  const match = tag.match(/\|([\d.]+)MB\/s\|/)
  const speed = match ? parseFloat(match[1]) : 0
  speedCache.set(tag, speed)
  return speed
}

// 获取分组 tag 列表（按速度排序，最多 100 个）
function getTags(proxies, regex) {
  let list = regex ? proxies.filter(p => regex.test(p.tag)) : proxies

  list.sort((a, b) => parseSpeed(b.tag) - parseSpeed(a.tag))

  return list.slice(0, 100).map(p => p.tag)
}

// TikTok 专用：必须同时满足 TikTok + 地区
function getTikTokTags(proxies, regionRegex) {
  let list = proxies.filter(p => RE_TIKTOK.test(p.tag) && regionRegex.test(p.tag))

  list.sort((a, b) => parseSpeed(b.tag) - parseSpeed(a.tag))

  return list.slice(0, 100).map(p => p.tag)
}

// outbounds 智能填充

// 统一处理 null / 空数组 / DIRECT 占位
function normalizeOutbounds(o, tags) {
  // 没有 outbounds 或不是数组 → 视为 ["DIRECT"]
  if (!Array.isArray(o.outbounds)) {
    o.outbounds = ['DIRECT']
  }

  // 空数组 → 视为 ["DIRECT"]
  if (o.outbounds.length === 0) {
    o.outbounds = ['DIRECT']
  }

  // 如果当前只有一个 DIRECT 且有真实节点 → 用真实节点替换 DIRECT
  if (o.outbounds.length === 1 && o.outbounds[0] === 'DIRECT' && tags.length > 0) {
    o.outbounds = tags.slice()
    return
  }

  // 否则正常追加
  if (tags.length > 0) {
    o.outbounds.push(...tags)
    // 去重
    o.outbounds = [...new Set(o.outbounds)]
  }
}

// 安全追加（对 selector / urltest 通用）
function safePush(o, tags) {
  normalizeOutbounds(o, tags)
}

// 主逻辑：按 tag 分组填充
for (const o of config.outbounds) {
  // 只处理有 tag 的 selector / urltest（未来可扩展）
  if (!o.tag) continue
  if (o.type !== 'selector' && o.type !== 'urltest') continue

  const tag = o.tag
  const rule = GROUP_RULES[tag]

  if (rule === undefined) continue

  // TikTok 分组：必须同时满足 TikTok + 地区
  if (TIKTOK_REGION[tag]) {
    const tags = getTikTokTags(proxies, TIKTOK_REGION[tag])
    safePush(o, tags)
    continue
  }

  // 普通分组：AUTO / 地区 / AI / CF优选 等
  const tags = getTags(proxies, rule)
  safePush(o, tags)
}

// 统一修复所有 outbounds
for (const o of config.outbounds) {
  normalizeOutbounds(o, [])
}

// 输出
$content = JSON.stringify(config, null, 2)

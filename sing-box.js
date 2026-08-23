const { type, name } = $arguments

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
  'TIKTOK-US': tag => MAIN_REGION.US.test(tag) || RE_TK_US.test(tag),
  'TIKTOK-VN': tag => MAIN_REGION.VN.test(tag) || RE_TK_VN.test(tag),
  'TIKTOK-JP': tag => MAIN_REGION.JP.test(tag) || RE_TK_JP.test(tag),
  'TIKTOK-SG': tag => MAIN_REGION.SG.test(tag) || RE_TK_SG.test(tag),
  'TIKTOK-TW': tag => MAIN_REGION.TW.test(tag) || RE_TK_TW.test(tag),
}

// AI / 平台正则
const AI_RULES = {
  OpenAI: /openai|chatgpt|gpt⁺/i,
  Gemini: /\b(gemini|gm)\b/i,
  Copilot: /\b(copilot|CP)\b/i,
  Youtube: /\b(youtube|yt)\b/i,
  // gm 加单词边界，避免误中 program / mgmt 等含 "gm" 子串的 tag
  'AI-plus': /^(?=.*gpt⁺)(?=.*\b(gemini|gm)\b)/i,
  // 裸字母 X 会匹配任意含 x 的 tag（MAX / EXPRESS / NETFLIX...），
  // 加上 \b 限定为独立的 "X" 词
  'CF优选': /^(?=.*gpt⁺)(?=.*(\bX\b|twitter))/i,
}

// 地区 AUTO 正则
const REGIONS = {
  'HK AUTO': /(?:^|[^-])\b(?:HK|港|Hong\s?Kong)\b/i,
  'TW AUTO': /(?:^|[^-])\b(?:TW|台|taiwan)\b/i,
  'JP AUTO': /(?:^|[^-])\b(?:JP|日|japan)\b/i,
  'SG AUTO': /(?:^|[^-])\b(?:SG|新|singapore)\b/i,
  'US AUTO': /(?:^|[^-])\b(?:US|美|american)\b/i,
}

// 统一分组规则
const GROUP_RULES = {
  'AUTO': null,
  ...REGIONS,
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

// 注入节点
config.outbounds.push(...proxies)

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
const proxiesSortedBySpeed = [...proxies].sort(
  (a, b) => parseSpeed(b.tag) - parseSpeed(a.tag)
)

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

// outbounds 归一化 & 智能填充

function normalizeOutbounds(o, tags) {
  // 不是 selector / urltest 的出站不处理
  if (o.type !== 'selector' && o.type !== 'urltest') return

  // 没有 outbounds 或不是数组，或空数组 → 视为 ["DIRECT"]
  if (!Array.isArray(o.outbounds) || o.outbounds.length === 0) {
    o.outbounds = ['DIRECT']
  }

  // 如果当前只有一个 DIRECT 且有真实节点 → 用真实节点替换 DIRECT
  if (o.outbounds.length === 1 && o.outbounds[0] === 'DIRECT' && tags.length > 0) {
    o.outbounds = tags.slice()
    return
  }

  // 否则正常追加 + 去重
  if (tags.length > 0) {
    o.outbounds.push(...tags)
    o.outbounds = [...new Set(o.outbounds)]
  }
}

function safePush(o, tags) {
  normalizeOutbounds(o, tags)
}

// 主逻辑：按 tag 分组填充

for (const o of config.outbounds) {
  if (!o.tag) continue
  if (o.type !== 'selector' && o.type !== 'urltest') continue

  const tag = o.tag

  // TikTok 严格匹配（所有地区）
  if (TIKTOK_MAIN[tag]) {
    safePush(o, getTikTokTagsStrict(proxiesSortedBySpeed, tag))
    continue
  }

  const rule = GROUP_RULES[tag]
  if (rule === undefined) continue

  safePush(o, getTags(proxiesSortedBySpeed, rule))
}

// 修复所有仍然异常的 selector/urltest
for (const o of config.outbounds) {
  if (o.type === 'selector' || o.type === 'urltest') {
    normalizeOutbounds(o, [])
  }
}

// 输出
$content = JSON.stringify(config, null, 2)
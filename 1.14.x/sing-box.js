const { type, name } = $arguments

let config = JSON.parse($files[0])

// 生成节点
let proxies = await produceArtifact({
  name,
  type: /^1$|col/i.test(type) ? 'collection' : 'subscription',
  platform: 'sing-box',
  produceType: 'internal',
})

// 注入节点
config.outbounds.push(...proxies)

// 分组映射（预编译正则，减少重复计算）
const groupMap = {
  'AUTO': null,
  'HK AUTO': /(?:^|[^-])\b(?:HK|港|Hong\s?Kong)\b/i,
  'TW AUTO': /(?:^|[^-])\b(?:TW|台|taiwan)\b/i,
  'JP AUTO': /(?:^|[^-])\b(?:JP|日|japan)\b/i,
  'SG AUTO': /(?:^|[^-])\b(?:SG|新|singapore)\b/i,
  'US AUTO': /(?:^|[^-])\b(?:US|美|american)\b/i,

  'TIKTOK-US': /^(?=.*TK|tiktok)(?=.*US)/i,
  'TIKTOK-VN': /^(?=.*TK|tiktok)(?=.*VN)/i,
  'TIKTOK-JP': /^(?=.*TK|tiktok)(?=.*JP)/i,
  'TIKTOK-SG': /^(?=.*TK|tiktok)(?=.*SG)/i,
  'TIKTOK-TW': /^(?=.*TK|tiktok)(?=.*TW)/i,

  'OpenAI': /openai|chatgpt|gpt⁺/i,
  'Gemini': /gemini|gm/i,
  'Copilot': /copilot|CP/i,
  'Youtube': /youtube|yt/i,

  'AI-plus': /^(?=.*gpt⁺)(?=.*gemini)/i,
  'CF优选': /^(?=.*gpt⁺)(?=.*(X|twitter))/i,
}

// 分组填充
for (const outbound of config.outbounds) {
  if (outbound.type !== 'selector' && outbound.type !== 'urltest') continue

  const regex = groupMap[outbound.tag]
  const tags = getTags(proxies, regex)

  safePush(outbound, tags)
}

// 最终统一兜底（确保所有 outbounds 都合法）
for (const outbound of config.outbounds) {
  normalizeOutbounds(outbound, [])
}

$content = JSON.stringify(config, null, 2)

// 工具函数：按速度排序
function getTags(proxies, regex) {
  let list = regex ? proxies.filter(p => regex.test(p.tag)) : proxies

  // 解析速度函数：从 tag 中提取 MB/s 数字
  function parseSpeed(tag) {
    const match = tag.match(/\|([\d.]+)MB\/s\|/)
    return match ? parseFloat(match[1]) : 0
  }

  list = list.sort((a, b) => parseSpeed(b.tag) - parseSpeed(a.tag))

  // 每个分组只取前 100 个
  list = list.slice(0, 100)

  return list.map(p => p.tag)
}

// 高性能 normalize：null → DIRECT，[] → DIRECT，DIRECT → 替换真实节点
function normalizeOutbounds(outbound, tags) {
  let o = outbound.outbounds

  // null → ["DIRECT"]
  if (!Array.isArray(o)) {
    outbound.outbounds = ["DIRECT"]
    o = outbound.outbounds
  }

  // [] → ["DIRECT"]
  if (o.length === 0) {
    outbound.outbounds = ["DIRECT"]
    o = outbound.outbounds
  }

  // ["DIRECT"] 且有真实节点 → 替换 DIRECT
  if (o.length === 1 && o[0] === "DIRECT" && tags.length > 0) {
    outbound.outbounds = tags
    return
  }

  // 正常追加
  if (tags.length > 0) {
    outbound.outbounds.push(...tags)
  }

  // 去重
  outbound.outbounds = [...new Set(outbound.outbounds)]
}

// 智能追加 tag
function safePush(outbound, tags) {
  normalizeOutbounds(outbound, tags)
}


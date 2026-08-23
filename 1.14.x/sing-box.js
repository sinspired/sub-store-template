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

// 只对 urltest 做分组填充，不动 selector
config.outbounds.forEach(i => {
  if (i.type !== 'urltest') return

  const tag = i.tag

  // AUTO 总分组
  if (tag === 'AUTO') {
    safePush(i, getTags(proxies))
  }

  // 地区分组
  if (tag === 'HK AUTO') {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:HK(?!⁻)|港|Hong\s?Kong)\b/gi))
  }
  if (tag === 'TW AUTO') {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:TW(?!⁻)|台|taiwan)\b/gi))
  }
  if (tag === 'JP AUTO') {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:JP(?!⁻)|日|japan)\b/gi))
  }
  if (tag === 'SG AUTO') {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:SG(?!⁻)|新|singapore)\b/gi))
  }
  if (tag === 'US AUTO') {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:US(?!⁻)|美|american)\b/gi))
  }

  // TikTok 分组
  if (tag === 'TIKTOK-US') {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])US|TK-US))/i))
  }
  if (tag === 'TIKTOK-VN') {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])VN|TK-VN))/i))
  }
  if (tag === 'TIKTOK-JP') {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])JP|TK-JP))/i))
  }
  if (tag === 'TIKTOK-SG') {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])SG|TK-SG))/i))
  }
  if (tag === 'TIKTOK-TW') {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])TW|TK-TW))/i))
  }

  // AI 分组
  if (tag === 'OpenAI') {
    safePush(i, getTags(proxies, /^(?=.*(\b(openai|chatgpt)\b|\bgpt⁺))/i))
  }
  if (tag === 'Gemini') {
    safePush(i, getTags(proxies, /^(?=.*\b(gemini|gm)\b)/i))
  }
  if (tag === 'Copilot') {
    safePush(i, getTags(proxies, /^(?=.*\b(copilot|CP)\b)/i))
  }
  if (tag === 'Youtube') {
    safePush(i, getTags(proxies, /^(?=.*\b(youtube|yt)\b)/i))
  }

  if (tag === 'AI-plus') {
    safePush(i, getTags(
      proxies,
      /^(?=.*gpt⁺)(?=.*(gemini|gm))/i
    ))
  }

  if (tag === 'CF优选') {
    safePush(i, getTags(
      proxies,
      /^(?=.*gpt⁺)(?=.*(X|twitter))/i
    ))
  }
})

// 输出最终配置
$content = JSON.stringify(config, null, 2)

// 工具函数：按速度排序并取前 100 个
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

// safePush：处理 null / [] / DIRECT 占位，并替换为真实节点
function safePush(i, tags) {
  // 如果 outbounds 不是数组（null 等），视为 ["DIRECT"] 占位
  if (!Array.isArray(i.outbounds)) {
    i.outbounds = ["DIRECT"]
  }

  // 如果是空数组，同样视为 ["DIRECT"] 占位
  if (i.outbounds.length === 0) {
    i.outbounds = ["DIRECT"]
  }

  // 如果当前只有一个 DIRECT 且有真实节点 → 用真实节点替换 DIRECT
  if (i.outbounds.length === 1 && i.outbounds[0] === "DIRECT" && tags.length > 0) {
    i.outbounds = tags
  } else if (tags.length > 0) {
    // 否则正常追加
    i.outbounds.push(...tags)
  }

  // 去重
  i.outbounds = [...new Set(i.outbounds)]
}

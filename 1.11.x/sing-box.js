const { type, name } = $arguments
const compatible_outbound = {
  tag: 'COMPATIBLE',
  type: 'direct',
}

let compatible
let config = JSON.parse($files[0])
let proxies = await produceArtifact({
  name,
  type: /^1$|col/i.test(type) ? 'collection' : 'subscription',
  platform: 'sing-box',
  produceType: 'internal',
})

// 过滤掉singbox-1.11无法识别的协议和字段
// proxies = proxies.filter(p => !('server_ports' in p))
proxies = proxies.filter(p => !(p.type == 'anytls'))

config.outbounds.push(...proxies)

config.outbounds.map(i => {
  if (['AUTO'].includes(i.tag)) {
    safePush(i, getTags(proxies))
  }

  // 地区分组
  if (['HK AUTO'].includes(i.tag)) {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:HK(?!⁻)|港|Hong\s?Kong)\b/gi))
  }
  if (['TW AUTO'].includes(i.tag)) {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:TW(?!⁻)|台|taiwan)\b/gi))
  }
  if (['JP AUTO'].includes(i.tag)) {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:JP(?!⁻)|日|japan)\b/gi))
  }
  if (['SG AUTO'].includes(i.tag)) {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:SG(?!⁻)|新|singapore)\b/gi))
  }
  if (['US AUTO'].includes(i.tag)) {
    safePush(i, getTags(proxies, /(?:^|[^-])\b(?:US(?!⁻)|美|american)\b/gi))
  }
  // TikTok
  if (['TIKTOK-US'].includes(i.tag)) {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])US|TK-US))/i))
  }
  if (['TIKTOK-VN'].includes(i.tag)) {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])VN|TK-VN))/i))
  }
  if (['TIKTOK-JP'].includes(i.tag)) {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])JP|TK-JP))/i))
  }
  if (['TIKTOK-SG'].includes(i.tag)) {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])SG|TK-SG))/i))
  }
  if (['TIKTOK-TW'].includes(i.tag)) {
    safePush(i, getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])TW|TK-TW))/i))
  }
  // AI
  if (['OpenAI'].includes(i.tag)) {
    safePush(i, getTags(proxies, /^(?=.*(\b(openai|chatgpt)\b|\bgpt⁺))/i))
  }
  if (['Gemini'].includes(i.tag)) {
    safePush(i, getTags(proxies, /^(?=.*\b(gemini|gm)\b)/i))
  }
  if (['Youtube'].includes(i.tag)) {
    safePush(i, getTags(proxies, /^(?=.*\b(youtube|yt)\b)/i))
  }
  if (['CF优选'].includes(i.tag)) {
    safePush(i, getTags(proxies, /^(?=.*\b(X|twitter)\b)/i))
  }

  if (['AI-plus'].includes(i.tag)) {
    safePush(i, getTags(
      proxies,
      /^(?=.*gpt⁺)(?=.*(gemini|gm))/i
    ))
  }

  if (['全部解锁'].includes(i.tag)) {
    safePush(i, getTags(
      proxies,
      /^(?=.*gpt⁺)(?=.*(gemini|gm))(?=.*(youtube|yt))(?=.*(X|twitter))/i
    ))
  }

})

config.outbounds.forEach(outbound => {
  if (Array.isArray(outbound.outbounds) && outbound.outbounds.length === 0) {
    if (!compatible) {
      config.outbounds.push(compatible_outbound)
      compatible = true
    }
    outbound.outbounds.push(compatible_outbound.tag);
  }
});

$content = JSON.stringify(config, null, 2)

function getTags(proxies, regex) {
  return (regex ? proxies.filter(p => regex.test(p.tag)) : proxies).map(p => p.tag)
}

function safePush(i, tags) {
  // 如果 outbounds 不是数组，或者是 null，初始化为空数组
  if (!Array.isArray(i.outbounds)) {
    i.outbounds = []
  }

  // 过滤掉数组中的 null 值
  i.outbounds = i.outbounds.filter(v => v !== null)

  if (i.outbounds.includes("")) {
    // 如果有空字符串，替换为第一个 tag
    if (tags.length > 0) {
      const idx = i.outbounds.indexOf("")
      i.outbounds[idx] = tags[0]
      // 如果还有剩余的 tag，继续追加
      if (tags.length > 1) {
        i.outbounds.push(...tags.slice(1))
      }
    }
  } else {
    // 如果没有 ""，直接追加
    i.outbounds.push(...tags)
  }

  // 如果最终还是空数组，确保转换为 []
  if (i.outbounds.length === 0) {
    i.outbounds = []
  }
}


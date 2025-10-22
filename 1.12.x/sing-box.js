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

config.outbounds.push(...proxies)

config.outbounds.map(i => {
  if (['AUTO'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies))
  }
  // 地区分组
  if (['HK AUTO'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /(?:^|[^-])\b(?:HK(?!⁻)|港|Hong\s?Kong)\b/gi))
  }
  if (['TW AUTO'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /(?:^|[^-])\b(?:TW(?!⁻)|台|taiwan)\b/gi))
  }
  if (['JP AUTO'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /(?:^|[^-])\b(?:JP(?!⁻)|日|japan)\b/gi))
  }
  if (['SG AUTO'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /(?:^|[^-])\b(?:SG(?!⁻)|新|singapore)\b/gi))
  }
  if (['US AUTO'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /(?:^|[^-])\b(?:US(?!⁻)|美|american)\b/gi))
  }
  if (['KR AUTO'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /(?:^|[^-])\b(?:KR(?!⁻)|韩|korea)\b/gi))
  }
  // TikTok
  if (['手动选择|TT'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /(tk|tiktok)/i));
  }
  if (['TIKTOK-US'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])US|TK-US))/i));
  }
  if (['TIKTOK-VN'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])VN|TK-VN))/i));
  }
  if (['TIKTOK-JP'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])JP|TK-JP))/i));
  }
  if (['TIKTOK-KR'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])KR|TK-KR))/i));
  }
  if (['TIKTOK-SG'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])SG|TK-SG))/i));
  }
  if (['TIKTOK-GB'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])GB|TK-GB))/i));
  }
  if (['TIKTOK-TW'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*TK|tiktok)(?=.*(?:(?:^|[^-])TW|TK-TW))/i));
  }
  // AI
  if (['OpenAI'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*\b(openai|chatgpt|gpt)\b)/i));
  }
  if (['Gemini'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*\b(gemini|gm)\b)/i));
  }
  if (['Youtube'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*\b(youtube|yt)\b)/i));
  }
  if (['OpenAI'].includes(i.tag)) {
    i.outbounds.push(...getTags(proxies, /^(?=.*\b(openai|chatgpt|gpt)\b)/i));
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

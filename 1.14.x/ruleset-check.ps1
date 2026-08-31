<#
  用法：
    .\ruleset-check.ps1 <sing-box.exe路径> <config.json路径> [-DnsServers @("223.5.5.5","8.8.8.8")]
#>

param(
    [string]$SingBoxBin = "sing-box",
    [string]$ConfigPath = "./config.json",
    [string]$RuleSetDir = "./ruleset-cache",
    [string]$HtmlReportPath = "./ruleset-report.html",
    [string[]]$DnsServers = @("223.5.5.5", "8.8.8.8", "1.1.1.1"),
    [switch]$SkipDownload,
    [switch]$OnlySizeReport
)

$ErrorActionPreference = "Stop"

#  已知 GFW 污染 IP 黑名单（不完全，仅供参考，可自行追加）
$PollutionBlacklist = @(
    "1.2.3.4", "0.0.0.0", "127.0.0.1",
    "4.36.66.178", "8.7.198.45", "37.61.54.158", "46.82.174.68",
    "59.24.3.173", "78.16.49.15", "93.46.8.89", "159.106.121.75",
    "203.98.7.65", "243.185.187.39", "202.106.1.2", "61.54.28.6",
    "65.104.202.252", "122.228.243.194", "111.175.221.58"
)

#  1. 解析配置 
if (-not (Test-Path $ConfigPath)) {
    throw "配置文件不存在：$ConfigPath"
}

$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json

$remoteRuleSets = $config.route.rule_set
if (-not $remoteRuleSets) {
    throw "配置中未找到 route.rule_set 段。"
}

#  2. 构造 tag -> URL 映射 
$RuleSets = [ordered]@{}

foreach ($item in $remoteRuleSets) {
    $tags = @()
    if ($item.tag -is [string]) {
        $tags += $item.tag
    }
    else {
        $tags += $item.tag
    }

    foreach ($tag in $tags) {
        $url = $item.url.Replace("{tag}", $tag)
        $RuleSets[$tag] = $url
    }
}

Write-Host "== 已解析规则集数量：$($RuleSets.Count) ==" -ForegroundColor Cyan

#  3. 准备目录 
if (-not (Test-Path $RuleSetDir)) {
    New-Item -ItemType Directory -Path $RuleSetDir | Out-Null
}

function Get-SafeTagName {
    param([string]$Tag)
    $Tag.Replace("/", "_").Replace("@!", "_").Replace("@", "_").Replace("!", "_")
}

#  4. 并行下载 
if (-not $SkipDownload) {
    Write-Host "`n== 并行下载规则集 ==" -ForegroundColor Cyan

    $jobs = @()

    foreach ($tag in $RuleSets.Keys) {
        $safeTag = Get-SafeTagName $tag
        $file = Join-Path $RuleSetDir "$safeTag.srs"

        if (Test-Path $file) {
            Write-Host "SKIP $tag（已存在）"
            continue
        }

        $url = $RuleSets[$tag]

        $jobs += Start-ThreadJob -ScriptBlock {
            param($tag, $url, $file)
            try {
                Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
                Write-Host ("OK   {0}" -f $tag)
            }
            catch {
                Write-Warning ("FAIL {0}: {1}" -f $tag, $_.Exception.Message)
            }
        } -ArgumentList $tag, $url, $file
    }

    if ($jobs.Count -gt 0) {
        Wait-Job $jobs | Out-Null
        Receive-Job $jobs | Out-Null
        Remove-Job $jobs
    }
}

#  5. 场景域名池（与 v3 一致）
$SceneDomains = @{
    "githubproxy"   = @(
        "ghproxy.net"
    )
    "AI"            = @(
        "openai.com", "chatgpt.com", "api.openai.com",
        "claude.ai", "anthropic.com",
        "gemini.google.com", "aistudio.google.com",
        "copilot.microsoft.com",
        "grok.com", "x.ai",
        "deepseek.com", "chat.deepseek.com", "api.deepseek.com",
        "huggingface.co", "kaggle.com"
    )
    "Google"        = @(
        "google.com", "www.google.com",
        "youtube.com", "www.youtube.com",
        "gstatic.com", "www.gstatic.com",
        "googleapis.com", "googleusercontent.com", "googlevideo.com",
        "ggpht.com", "withgoogle.com", "googletagservices.com",
        "2mdn.net", "google-analytics.com", "analytics.google.com"
    )
    "Social"        = @(
        "twitter.com", "x.com",
        "telegram.org", "web.telegram.org", "t.me", "telesco.pe", "tdesktop.com",
        "instagram.com", "facebook.com",
        "weibo.com",
        "qq.com", "weixin.qq.com",
        "xiaohongshu.com",
        "douyin.com",
        "tiktok.com", "www.tiktok.com"
    )
    "Video"         = @(
        "youtube.com", "www.youtube.com",
        "netflix.com", "www.netflix.com",
        "netflixgc.com", "www.netflixgc.com",
        "nflxvideo.net", "nflximg.net", "nflxso.net", "nflxext.com",
        "meijutt.cc", "www.meijutt.cc",
        "bilibili.com", "www.bilibili.com",
        "iqiyi.com", "www.iqiyi.com",
        "youku.com", "www.youku.com",
        "v.qq.com", "wetv.vip", "wetvinfo.com"
    )
    "Developer"     = @(
        "github.com", "gitlab.com",
        "go.dev", "golang.org",
        "wails.io",
        "stackoverflow.com",
        "npmjs.com",
        "pypi.org", "pythonhosted.org",
        "docker.com", "hub.docker.com",
        "jsdelivr.net", "cdn.jsdelivr.net",
        "cloudflare.com"
    )
    "Life"          = @(
        "meituan.com", "waimai.meituan.com",
        "amap.com", "gaode.com",
        "didiglobal.com", "didi.cn",
        "jd.com", "www.jd.com",
        "taobao.com", "www.taobao.com",
        "tmall.com", "pinduoduo.com",
        "alipay.com",
        "icbc.com.cn", "ccb.com", "abchina.com", "boc.cn",
        "cmbchina.com",
        "unionpay.com",
        "apple.com", "weather.apple.com",
        "quark.cn", "pan.quark.cn",
        "baidu.com", "sina.com.cn", "163.com", "sohu.com",
        "zhihu.com", "douban.com", "ctrip.com",
        "csdn.net", "bytedance.com",
        "xiaomi.com", "huawei.com", "oppo.com", "vivo.com"
    )
    "DomesticVideo" = @(
        "iqiyi.com", "www.iqiyi.com",
        "youku.com", "www.youku.com",
        "v.qq.com", "wetv.vip",
        "bilibili.com", "www.bilibili.com"
    )
    "CDN"           = @(
        "cloudflare.com", "cp.cloudflare.com",
        "akamai.com", "akamaized.net", "akamaihd.net",
        "edgekey.net", "edgesuite.net",
        "fastly.com",
        "jsdelivr.net", "cdn.jsdelivr.net",
        "azureedge.net", "cloudfront.net",
        "stackpathcdn.com", "bunnycdn.com", "keycdn.com",
        "workers.dev", "pages.dev", "cloudflareinsights.com",
        "cloudflarestream.com", "cf-ipfs.com"
    )
    "PORN"          = @(
        "pornhub.com", "91porn.com", "91porny.com", "jable.tv", "eporner.com", "bestjavporn.com", "missav.ws"
    )
    "Ads"           = @(
        "doubleclick.net",
        "googlesyndication.com",
        "googleadservices.com",
        "adservice.google.com",
        "pagead2.googlesyndication.com",
        "googletagmanager.com",
        "google-analytics.com",
        "adnxs.com",
        "criteo.com",
        "taboola.com",
        "outbrain.com",
        "media.net",
        "adroll.com",
        "scorecardresearch.com",
        "quantserve.com",
        "moatads.com",
        "rubiconproject.com",
        "pubmatic.com",
        "openx.net",
        "casalemedia.com",
        "contextweb.com",
        "bidswitch.net",
        "mathtag.com",
        "adsrvr.org",
        "smartadserver.com",
        "yieldmo.com",
        "amazon-adsystem.com",
        "hotjar.com",
        "mixpanel.com",
        "segment.io",
        "doubleverify.com",
        "2mdn.net"
    )
}

$TestDomains = $SceneDomains.Values | ForEach-Object { $_ } | Sort-Object -Unique
Write-Host "`n== 测试域名数量：$($TestDomains.Count) ==" -ForegroundColor Cyan

#  6. 规则集体积 
Write-Host "`n== 规则集体积 ==" -ForegroundColor Cyan

$sizeReport = foreach ($tag in $RuleSets.Keys) {
    $safeTag = Get-SafeTagName $tag
    $file = Join-Path $RuleSetDir "$safeTag.srs"
    if (Test-Path $file) {
        [PSCustomObject]@{
            Tag    = $tag
            SizeKB = [math]::Round((Get-Item $file).Length / 1KB, 1)
        }
    }
}

$sizeReport | Sort-Object SizeKB -Descending | Format-Table -AutoSize

if ($OnlySizeReport) {
    Write-Host "`n== 已启用 OnlySizeReport，跳过后续解析 ==" -ForegroundColor Yellow
    return
}

#  7. DNS 实际解析 + 污染过滤
Write-Host "`n== 并行 DNS 解析（依次尝试：$($DnsServers -join ', ')）==" -ForegroundColor Cyan

$resolveJobs = @()
foreach ($domain in $TestDomains) {
    $resolveJobs += Start-ThreadJob -ScriptBlock {
        param($domain, $servers, $blacklist)

        function Resolve-One {
            param($domain, $server)
            try {
                if (Get-Command Resolve-DnsName -ErrorAction SilentlyContinue) {
                    $rec = Resolve-DnsName -Name $domain -Type A -Server $server -DnsOnly -ErrorAction Stop |
                    Where-Object { $_.Type -eq 'A' } | Select-Object -First 1
                    if ($rec) { return $rec.IPAddress }
                    return $null
                }
                else {
                    $addrs = [System.Net.Dns]::GetHostAddresses($domain) |
                    Where-Object { $_.AddressFamily -eq 'InterNetwork' }
                    if ($addrs) { return $addrs[0].IPAddressToString }
                    return $null
                }
            }
            catch {
                return $null
            }
        }

        function Test-BogusIP {
            param([string]$IP, [string[]]$Blacklist)

            if (-not $IP) { return $true }
            if ($Blacklist -contains $IP) { return $true }

            $octets = $IP -split '\.'
            if ($octets.Count -ne 4) { return $true }

            try {
                $o1 = [int]$octets[0]; $o2 = [int]$octets[1]
            }
            catch {
                return $true
            }

            if ($o1 -eq 0) { return $true }
            if ($o1 -eq 10) { return $true }
            if ($o1 -eq 127) { return $true }
            if ($o1 -eq 169 -and $o2 -eq 254) { return $true }
            if ($o1 -eq 172 -and $o2 -ge 16 -and $o2 -le 31) { return $true }
            if ($o1 -eq 192 -and $o2 -eq 168) { return $true }

            return $false
        }

        $rawIp = $null
        $usedServer = $null
        foreach ($srv in $servers) {
            $rawIp = Resolve-One -domain $domain -server $srv
            if ($rawIp) { $usedServer = $srv; break }
        }

        $polluted = $false
        $cleanIp = $rawIp
        if ($rawIp -and (Test-BogusIP -IP $rawIp -Blacklist $blacklist)) {
            $polluted = $true
            $cleanIp = $null   # 判定为污染/异常，不参与后续 geoip 匹配
        }

        [PSCustomObject]@{
            Domain   = $domain
            IP       = $cleanIp
            RawIP    = $rawIp
            Server   = $usedServer
            Polluted = $polluted
        }
    } -ArgumentList $domain, $DnsServers, $PollutionBlacklist
}

Wait-Job $resolveJobs | Out-Null
$resolveResults = Receive-Job $resolveJobs | Sort-Object Domain
Remove-Job $resolveJobs

$resolveResults | Format-Table -AutoSize

$resolvedCount = ($resolveResults | Where-Object { $_.IP }).Count
$pollutedCount = ($resolveResults | Where-Object { $_.Polluted }).Count
Write-Host "解析成功且通过过滤：$resolvedCount / $($TestDomains.Count)" -ForegroundColor Yellow
Write-Host "判定为污染/异常并丢弃：$pollutedCount" -ForegroundColor Yellow
if ($pollutedCount -gt 0) {
    Write-Host "污染/异常明细：" -ForegroundColor Yellow
    $resolveResults | Where-Object { $_.Polluted } | Format-Table Domain, RawIP, Server -AutoSize
}

$ipLookup = @{}
foreach ($r in $resolveResults) {
    if ($r.IP) { $ipLookup[$r.Domain] = $r.IP }
}

#  8. 域名匹配（geosite 链路）
Write-Host "`n== 并行匹配（域名 -> geosite 链路）==" -ForegroundColor Cyan

$jobs = @()

foreach ($domain in $TestDomains) {
    $jobs += Start-ThreadJob -ScriptBlock {
        param($domain, $RuleSets, $RuleSetDir, $SingBoxBin)

        $firstMatch = $null
        $allMatches = @()

        foreach ($tag in $RuleSets.Keys) {
            $safeTag = $tag.Replace("/", "_").Replace("@!", "_").Replace("@", "_").Replace("!", "_")
            $file = Join-Path $RuleSetDir "$safeTag.srs"
            if (-not (Test-Path $file)) { continue }

            $rawOut = & $SingBoxBin rule-set match --format binary $file $domain 2>&1
            $outText = $rawOut | Out-String

            if ($outText -match 'match rules\.\[\d+\]:') {
                if (-not $firstMatch) { $firstMatch = $tag }
                $allMatches += $tag
            }
        }

        [PSCustomObject]@{
            Domain     = $domain
            FirstMatch = if ($firstMatch) { $firstMatch } else { "<无匹配>" }
            AllMatches = if ($allMatches.Count -gt 0) { ($allMatches -join ", ") } else { "<无匹配>" }
        }
    } -ArgumentList $domain, $RuleSets, $RuleSetDir, $SingBoxBin
}

Wait-Job $jobs | Out-Null
$results = Receive-Job $jobs | Sort-Object Domain
Remove-Job $jobs

$results | Format-Table -AutoSize

#  9. IP 匹配（geoip 链路，只用通过污染过滤的 IP）
Write-Host "`n== 并行匹配（解析后 IP -> geoip 链路，已排除污染/异常结果）==" -ForegroundColor Cyan

$ipJobs = @()
foreach ($domain in $TestDomains) {
    if (-not $ipLookup.ContainsKey($domain)) { continue }
    $ip = $ipLookup[$domain]

    $ipJobs += Start-ThreadJob -ScriptBlock {
        param($domain, $ip, $RuleSets, $RuleSetDir, $SingBoxBin)

        $firstMatch = $null
        $allMatches = @()

        foreach ($tag in $RuleSets.Keys) {
            $safeTag = $tag.Replace("/", "_").Replace("@!", "_").Replace("@", "_").Replace("!", "_")
            $file = Join-Path $RuleSetDir "$safeTag.srs"
            if (-not (Test-Path $file)) { continue }

            $rawOut = & $SingBoxBin rule-set match --format binary $file $ip 2>&1
            $outText = $rawOut | Out-String

            if ($outText -match 'match rules\.\[\d+\]:') {
                if (-not $firstMatch) { $firstMatch = $tag }
                $allMatches += $tag
            }
        }

        [PSCustomObject]@{
            Domain     = $domain
            IP         = $ip
            FirstMatch = if ($firstMatch) { $firstMatch } else { "<无匹配>" }
            AllMatches = if ($allMatches.Count -gt 0) { ($allMatches -join ", ") } else { "<无匹配>" }
        }
    } -ArgumentList $domain, $ip, $RuleSets, $RuleSetDir, $SingBoxBin
}

if ($ipJobs.Count -gt 0) {
    Wait-Job $ipJobs | Out-Null
    $ipResults = Receive-Job $ipJobs | Sort-Object Domain
    Remove-Job $ipJobs
}
else {
    $ipResults = @()
}

$ipResults | Format-Table -AutoSize

#  10. 命中次数汇总（域名/IP 分开）+ 命中密度 
Write-Host "`n== 命中次数汇总（域名链路 vs IP链路）+ 命中密度 ==" -ForegroundColor Cyan

$domainHitCount = @{}
$ipHitCount = @{}
foreach ($tag in $RuleSets.Keys) { $domainHitCount[$tag] = 0; $ipHitCount[$tag] = 0 }

foreach ($r in $results) {
    if ($RuleSets.Contains($r.FirstMatch)) { $domainHitCount[$r.FirstMatch]++ }
}
foreach ($r in $ipResults) {
    if ($RuleSets.Contains($r.FirstMatch)) { $ipHitCount[$r.FirstMatch]++ }
}

$sizeLookup = @{}
foreach ($row in $sizeReport) { $sizeLookup[$row.Tag] = $row.SizeKB }

$densityReport = foreach ($tag in $RuleSets.Keys) {
    $size = $sizeLookup[$tag]
    $dHits = $domainHitCount[$tag]
    $iHits = $ipHitCount[$tag]
    $totalHits = $dHits + $iHits
    $density = if ($size -and $size -gt 0) { [math]::Round($totalHits / $size, 3) } else { $null }
    [PSCustomObject]@{
        Tag        = $tag
        SizeKB     = $size
        DomainHits = $dHits
        IPHits     = $iHits
        TotalHits  = $totalHits
        Density    = $density
    }
}

$densityReport | Sort-Object SizeKB -Descending | Format-Table -AutoSize

#  11. 冲突报告（域名链路）
Write-Host "`n== 冲突报告（域名链路）==" -ForegroundColor Cyan

$conflicts = $results | Where-Object {
    $_.AllMatches -ne "<无匹配>" -and ($_.AllMatches -split ", ").Count -gt 1
}

if ($conflicts.Count -eq 0) {
    Write-Host "无冲突。" -ForegroundColor Green
}
else {
    $conflicts | Format-Table Domain, AllMatches -AutoSize
}

#  11b. 广告规则集重叠专项分析 
Write-Host "`n== 广告规则集重叠分析（anti_ad vs category-ads-all）==" -ForegroundColor Cyan

$adsResults = $results | Where-Object { $SceneDomains["Ads"] -contains $_.Domain }
$bothAdRules = $adsResults | Where-Object { $_.AllMatches -match "anti_ad" -and $_.AllMatches -match "category-ads-all" }
$onlyAntiAd = $adsResults | Where-Object { $_.AllMatches -match "anti_ad" -and $_.AllMatches -notmatch "category-ads-all" }
$onlyCategoryAds = $adsResults | Where-Object { $_.AllMatches -notmatch "anti_ad" -and $_.AllMatches -match "category-ads-all" }
$neitherAd = $adsResults | Where-Object { $_.AllMatches -notmatch "anti_ad" -and $_.AllMatches -notmatch "category-ads-all" }

Write-Host ("同时命中两者：{0} / 仅 anti_ad：{1} / 仅 category-ads-all：{2} / 都未命中：{3}" -f `
        $bothAdRules.Count, $onlyAntiAd.Count, $onlyCategoryAds.Count, $neitherAd.Count)

#  12. 覆盖树状图 
Write-Host "`n== 覆盖树状图 ==" -ForegroundColor Cyan

$coverageTree = [ordered]@{
    "geoip"   = @()
    "geosite" = @()
    "other"   = @()
}

foreach ($tag in $RuleSets.Keys) {
    if ($tag -like "geoip/*") { $coverageTree["geoip"] += $tag }
    elseif ($tag -like "geosite/*") { $coverageTree["geosite"] += $tag }
    else { $coverageTree["other"] += $tag }
}

foreach ($group in $coverageTree.Keys) {
    Write-Host "`n[$group]" -ForegroundColor Cyan
    foreach ($tag in $coverageTree[$group]) {
        Write-Host "  - $tag"
    }
}

#  13. 场景分析（域名 + IP 合并展示）
Write-Host "`n== 场景分析 ==" -ForegroundColor Cyan

$SceneResults = @()

foreach ($scene in $SceneDomains.Keys) {
    foreach ($domain in $SceneDomains[$scene]) {
        $dRow = $results | Where-Object { $_.Domain -eq $domain }
        $iRow = $ipResults | Where-Object { $_.Domain -eq $domain }
        $rRow = $resolveResults | Where-Object { $_.Domain -eq $domain }

        $SceneResults += [PSCustomObject]@{
            Scene       = $scene
            Domain      = $domain
            ResolvedIP  = if ($iRow) { $iRow.IP } else { "<解析失败或已过滤>" }
            Polluted    = if ($rRow) { $rRow.Polluted } else { $false }
            DomainMatch = if ($dRow) { $dRow.FirstMatch } else { "<未测试>" }
            IPMatch     = if ($iRow) { $iRow.FirstMatch } else { "<未解析/未测试>" }
        }
    }
}

$SceneResults | Sort-Object Scene, Domain | Format-Table -AutoSize

#  14. HTML 报告 
Write-Host "`n== 生成 HTML 报告 ==" -ForegroundColor Cyan

$html = @()
$html += "<html><head><meta charset='utf-8'><title>规则集审计报告</title>"
$html += "<style>body{font-family:Segoe UI;margin:20px;}table{border-collapse:collapse;margin-bottom:20px;}td,th{border:1px solid #ccc;padding:4px 8px;font-size:12px;}h2{margin-top:30px;}.warn{color:#a15c00;}.bad{color:#c0392b;}</style>"
$html += "</head><body>"
$html += "<h1>规则集审计报告</h1>"
$html += "<p class='warn'>DNS 解析结果污染/异常过滤（私有地址段 + 已知污染IP黑名单，命中即丢弃，不参与 geoip 匹配统计）。</p>"
$html += "<p class='warn'>域名池 $($TestDomains.Count) 个，解析成功且通过过滤：$resolvedCount 个，判定为污染/异常并丢弃：<span class='bad'>$pollutedCount</span> 个。</p>"

$html += "<h2>规则集体积 + 命中次数（域名/IP分开）+ 命中密度</h2><table><tr><th>Tag</th><th>SizeKB</th><th>DomainHits</th><th>IPHits</th><th>TotalHits</th><th>Density</th></tr>"
foreach ($row in ($densityReport | Sort-Object SizeKB -Descending)) {
    $html += "<tr><td>$($row.Tag)</td><td>$($row.SizeKB)</td><td>$($row.DomainHits)</td><td>$($row.IPHits)</td><td>$($row.TotalHits)</td><td>$($row.Density)</td></tr>"
}
$html += "</table>"

$html += "<h2>DNS 解析结果（含污染标记）</h2><table><tr><th>Domain</th><th>清洗后IP</th><th>原始解析值</th><th>使用的解析服务器</th><th>是否污染/异常</th></tr>"
foreach ($row in $resolveResults) {
    $pollutedLabel = if ($row.Polluted) { "<span class='bad'>是</span>" } else { "否" }
    $html += "<tr><td>$($row.Domain)</td><td>$($row.IP)</td><td>$($row.RawIP)</td><td>$($row.Server)</td><td>$pollutedLabel</td></tr>"
}
$html += "</table>"

$html += "<h2>域名匹配（geosite 链路）</h2><table><tr><th>Domain</th><th>FirstMatch</th><th>AllMatches</th></tr>"
foreach ($row in $results) {
    $html += "<tr><td>$($row.Domain)</td><td>$($row.FirstMatch)</td><td>$($row.AllMatches)</td></tr>"
}
$html += "</table>"

$html += "<h2>IP 匹配（geoip 链路，已排除污染/异常）</h2><table><tr><th>Domain</th><th>IP</th><th>FirstMatch</th><th>AllMatches</th></tr>"
foreach ($row in $ipResults) {
    $html += "<tr><td>$($row.Domain)</td><td>$($row.IP)</td><td>$($row.FirstMatch)</td><td>$($row.AllMatches)</td></tr>"
}
$html += "</table>"

$html += "<h2>冲突报告（域名链路）</h2>"
if ($conflicts.Count -eq 0) {
    $html += "<p>无冲突。</p>"
}
else {
    $html += "<table><tr><th>Domain</th><th>AllMatches</th></tr>"
    foreach ($row in $conflicts) {
        $html += "<tr><td>$($row.Domain)</td><td>$($row.AllMatches)</td></tr>"
    }
    $html += "</table>"
}

$html += "<h2>广告规则集重叠分析</h2>"
$html += "<p>同时命中两者：$($bothAdRules.Count) / 仅 anti_ad：$($onlyAntiAd.Count) / 仅 category-ads-all：$($onlyCategoryAds.Count) / 都未命中：$($neitherAd.Count)</p>"

$html += "<h2>覆盖树状图</h2>"
foreach ($group in $coverageTree.Keys) {
    $html += "<h3>$group</h3><ul>"
    foreach ($tag in $coverageTree[$group]) {
        $html += "<li>$tag</li>"
    }
    $html += "</ul>"
}

$html += "<h2>场景分析报告（域名 + IP 合并）</h2>"
foreach ($scene in $SceneDomains.Keys) {
    $html += "<h3>$scene 场景</h3>"
    $html += "<table><tr><th>Domain</th><th>ResolvedIP</th><th>Polluted</th><th>DomainMatch</th><th>IPMatch</th></tr>"
    foreach ($row in ($SceneResults | Where-Object { $_.Scene -eq $scene } | Sort-Object Domain)) {
        $pollutedLabel = if ($row.Polluted) { "<span class='bad'>是</span>" } else { "否" }
        $html += "<tr><td>$($row.Domain)</td><td>$($row.ResolvedIP)</td><td>$pollutedLabel</td><td>$($row.DomainMatch)</td><td>$($row.IPMatch)</td></tr>"
    }
    $html += "</table>"
}

$html += "</body></html>"

Set-Content -Path $HtmlReportPath -Value ($html -join "`n") -Encoding UTF8

Write-Host "HTML 报告已生成：$HtmlReportPath" -ForegroundColor Green
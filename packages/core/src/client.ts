import ipaddr from "ipaddr.js";

/**
 * Display-only client description. Decisions never depend on it (they use detectClient);
 * it exists so humans can tell a phone app from a scanner at a glance.
 */
export const clientKinds = [
  "proxy",
  "browser",
  "system",
  "tool",
  "preview",
  "crawler",
  "scanner",
  "unknown",
] as const;
export type ClientKind = (typeof clientKinds)[number];
export type ClientInfo = {
  kind: ClientKind;
  name: string;
  version: string | null;
  os: string | null;
  osVersion: string | null;
  device: string | null;
  label: string;
};

type Rule = { kind: ClientKind; name: string; pattern: RegExp };
const token = (name: string) => new RegExp(`(?:^|[\\s(;,])${name}(?:/([\\w.+-]+))?`, "i");

// Order matters: bots and scanners often embed browser tokens, so they are matched first.
const scanners: Rule[] = [
  { kind: "scanner", name: "Censys", pattern: /censys(?:inspect)?(?:\/([\w.]+))?/i },
  { kind: "scanner", name: "Palo Alto Expanse", pattern: /expanse|palo alto networks|paloalto/i },
  { kind: "scanner", name: "LeakIX", pattern: /l9scan(?:\/([\w.]+))?|leakix/i },
  { kind: "scanner", name: "TLM Audit Scanner", pattern: /tlm-audit-scanner(?:\/([\w.]+))?/i },
  { kind: "scanner", name: "zgrab", pattern: /zgrab(?:\/([\w.]+))?/i },
  { kind: "scanner", name: "Nmap", pattern: /nmap/i },
  { kind: "scanner", name: "masscan", pattern: /masscan(?:\/([\w.]+))?/i },
  { kind: "scanner", name: "Nuclei", pattern: /nuclei(?:\/([\w.]+))?/i },
  { kind: "scanner", name: "Shodan", pattern: /shodan/i },
  { kind: "scanner", name: "Netcraft", pattern: /netcraft/i },
  {
    kind: "scanner",
    name: "InternetMeasurement",
    pattern: /internet-?measurement(?:\/([\w.]+))?/i,
  },
  { kind: "scanner", name: "ModatScanner", pattern: /modatscanner(?:\/([\w.]+))?/i },
];
const crawlers: Rule[] = [
  { kind: "crawler", name: "GPTBot", pattern: token("GPTBot") },
  { kind: "crawler", name: "OAI-SearchBot", pattern: token("OAI-SearchBot") },
  { kind: "crawler", name: "ChatGPT-User", pattern: token("ChatGPT-User") },
  { kind: "crawler", name: "ClaudeBot", pattern: token("ClaudeBot") },
  { kind: "crawler", name: "Claude-User", pattern: token("Claude-User") },
  { kind: "crawler", name: "PerplexityBot", pattern: token("PerplexityBot") },
  { kind: "crawler", name: "Bytespider", pattern: token("Bytespider") },
  { kind: "crawler", name: "Googlebot", pattern: token("Googlebot") },
  { kind: "crawler", name: "bingbot", pattern: token("bingbot") },
  { kind: "crawler", name: "Baiduspider", pattern: token("Baiduspider") },
  { kind: "crawler", name: "YandexBot", pattern: token("YandexBot") },
  { kind: "crawler", name: "Applebot", pattern: token("Applebot") },
  { kind: "crawler", name: "AhrefsBot", pattern: token("AhrefsBot") },
  { kind: "crawler", name: "SemrushBot", pattern: token("SemrushBot") },
  { kind: "crawler", name: "PetalBot", pattern: token("PetalBot") },
  { kind: "crawler", name: "DotBot", pattern: token("DotBot") },
  { kind: "crawler", name: "MJ12bot", pattern: token("MJ12bot") },
  { kind: "crawler", name: "Sogou", pattern: /sogou [\w ]*spider(?:\/([\w.]+))?/i },
];
const previews: Rule[] = [
  { kind: "preview", name: "TelegramBot", pattern: /telegrambot/i },
  { kind: "preview", name: "Slackbot", pattern: token("Slackbot(?:-LinkExpanding)?") },
  { kind: "preview", name: "Discordbot", pattern: token("Discordbot") },
  { kind: "preview", name: "WhatsApp", pattern: token("WhatsApp") },
  { kind: "preview", name: "LinkedInBot", pattern: token("LinkedInBot") },
  { kind: "preview", name: "SkypeUriPreview", pattern: /skypeuripreview/i },
  { kind: "preview", name: "redditbot", pattern: token("redditbot") },
  { kind: "preview", name: "Iframely", pattern: token("Iframely") },
  // Apple Messages and several chat apps fetch previews with this combined identity.
  { kind: "preview", name: "facebookexternalhit", pattern: token("facebookexternalhit") },
  { kind: "preview", name: "Twitterbot", pattern: token("Twitterbot") },
];
const proxies: Rule[] = [
  { kind: "proxy", name: "Clash Verge", pattern: /clash[- ]verge(?:[- ]rev)?\/v?([\w.+-]+)?/i },
  { kind: "proxy", name: "Clash Nyanpasu", pattern: /clash[- ]nyanpasu\/v?([\w.+-]+)?/i },
  { kind: "proxy", name: "FlClash", pattern: /flclash\/v?([\w.+-]+)?/i },
  { kind: "proxy", name: "ClashX Pro", pattern: /clashx ?pro\/v?([\w.+-]+)?/i },
  { kind: "proxy", name: "ClashX Meta", pattern: /clashx ?meta\/v?([\w.+-]+)?/i },
  { kind: "proxy", name: "ClashX", pattern: /clashx\/v?([\w.+-]+)?/i },
  { kind: "proxy", name: "Stash", pattern: /stash\/([\w.+-]+)?/i },
  {
    kind: "proxy",
    name: "mihomo",
    pattern: /mihomo\/v?([\w.+-]+)?|clash\.meta(?:\/v?([\w.+-]+))?/i,
  },
  { kind: "proxy", name: "Hiddify", pattern: /hiddify(?:next)?\/v?([\w.+-]+)?/i },
  { kind: "proxy", name: "Karing", pattern: /karing\/v?([\w.+-]+)?/i },
  { kind: "proxy", name: "NekoBox", pattern: /nekobox(?:forandroid)?\/v?([\w.+-]+)?/i },
  { kind: "proxy", name: "sing-box", pattern: /sing-box\/v?([\w.+-]+)?|\bSF[IAMT]\/([\w.+-]+)/i },
  { kind: "proxy", name: "Surge", pattern: /surge(?: (?:mac|ios|ipados|tvos))?\/([\w.+-]+)?/i },
  { kind: "proxy", name: "Shadowrocket", pattern: /shadowrocket\/([\w.+-]+)?/i },
  { kind: "proxy", name: "Quantumult X", pattern: /quantumult(?:%20| )x\/([\w.+-]+)?/i },
  { kind: "proxy", name: "Loon", pattern: /\bloon\/([\w.+-]+)?/i },
  { kind: "proxy", name: "Egern", pattern: /egern\/([\w.+-]+)?/i },
  { kind: "proxy", name: "Surfboard", pattern: /surfboard\/([\w.+-]+)?/i },
  { kind: "proxy", name: "v2rayNG", pattern: /v2rayng\/([\w.+-]+)?/i },
  { kind: "proxy", name: "v2rayN", pattern: /v2rayn\/([\w.+-]+)?/i },
  { kind: "proxy", name: "Clash", pattern: /^clash(?:\/v?([\w.+-]+))?$|\bclash\/v?([\w.+-]+)/i },
];
const tools: Rule[] = [
  { kind: "tool", name: "curl", pattern: /^curl\/([\w.+-]+)/i },
  { kind: "tool", name: "Wget", pattern: /^wget\/([\w.+-]+)/i },
  { kind: "tool", name: "python-requests", pattern: /python-requests\/([\w.+-]+)/i },
  { kind: "tool", name: "python-httpx", pattern: /python-httpx\/([\w.+-]+)/i },
  { kind: "tool", name: "aiohttp", pattern: /aiohttp\/([\w.+-]+)/i },
  { kind: "tool", name: "Python-urllib", pattern: /python-urllib\/([\w.+-]+)/i },
  { kind: "tool", name: "Go-http-client", pattern: /go-http-client\/([\w.+-]+)/i },
  { kind: "tool", name: "okhttp", pattern: /okhttp\/([\w.+-]+)/i },
  { kind: "tool", name: "axios", pattern: /axios\/([\w.+-]+)/i },
  { kind: "tool", name: "node-fetch", pattern: /node-fetch\/([\w.+-]+)|^node$|undici/i },
  { kind: "tool", name: "PostmanRuntime", pattern: /postmanruntime\/([\w.+-]+)/i },
  { kind: "tool", name: "HTTPie", pattern: /httpie\/([\w.+-]+)/i },
  { kind: "tool", name: "PowerShell", pattern: /powershell\/([\w.+-]+)/i },
  { kind: "tool", name: "Java", pattern: /^java\/([\w.+-]+)/i },
  { kind: "tool", name: "libwww-perl", pattern: /libwww-perl\/([\w.+-]+)/i },
  { kind: "tool", name: "WordPress", pattern: /^wordpress\/([\w.+-]+)/i },
  { kind: "tool", name: "Headless Chrome", pattern: /headlesschrome\/([\w.+-]+)/i },
];

const firstGroup = (m: RegExpExecArray) => m.slice(1).find((g) => g !== undefined) ?? null;

function appleContext(ua: string) {
  const darwin = /darwin\/([\d.]+)/i.exec(ua)?.[1] ?? null;
  const macos = /macos\/([\d.]+)/i.exec(ua)?.[1] ?? null;
  const device =
    /\b(iPhone\d+,\d+|iPad\d+,\d+|iPod\d+,\d+|Mac\d+,\d+|MacBook\w*\d+,\d+|AppleTV\d+,\d+|Watch\d+,\d+)\b/.exec(
      ua,
    )?.[1] ?? null;
  const mobile =
    /iphone|ipad|ipod|\bios\b|ipados/i.test(ua) || /^(iPhone|iPad|iPod)/.test(device ?? "");
  const mac = /\bmac\b|macintosh|macos|mac os/i.test(ua) || /^Mac/.test(device ?? "");
  let os: string | null = null;
  let osVersion: string | null = null;
  if (macos) {
    os = "macOS";
    osVersion = macos;
  } else if (mobile) os = /ipad/i.test(ua) ? "iPadOS" : "iOS";
  else if (mac) os = "macOS";
  // Darwin kernel numbers do not map 1:1 to marketing versions; show them verbatim.
  if (!osVersion && darwin) osVersion = `Darwin ${darwin}`;
  if (!os && darwin) os = "Apple";
  return { os, osVersion, device };
}

function browserOs(ua: string): {
  os: string | null;
  osVersion: string | null;
  device: string | null;
} {
  let m = /windows nt ([\d.]+)/i.exec(ua);
  if (m) {
    const nt: Record<string, string> = {
      "10.0": "10/11",
      "6.3": "8.1",
      "6.2": "8",
      "6.1": "7",
      "6.0": "Vista",
      "5.1": "XP",
    };
    return { os: "Windows", osVersion: nt[m[1] ?? ""] ?? m[1] ?? null, device: null };
  }
  m = /(?:iphone|cpu) os ([\d_]+)/i.exec(ua);
  if (m) {
    const device = /\b(iPhone|iPad|iPod)\b/.exec(ua)?.[1] ?? null;
    return {
      os: device === "iPad" ? "iPadOS" : "iOS",
      osVersion: (m[1] ?? "").replace(/_/g, "."),
      device,
    };
  }
  m = /android ([\d.]+)(?:;\s*([^;)]+?))?(?:\s+build\/[^;)]*)?[;)]/i.exec(ua);
  if (m) {
    const model = m[2] && !/^(k|wv|linux|mobile|u)$/i.test(m[2].trim()) ? m[2].trim() : null;
    return { os: "Android", osVersion: m[1] ?? null, device: model };
  }
  m = /mac os x ([\d_.]+)/i.exec(ua);
  if (m) return { os: "macOS", osVersion: (m[1] ?? "").replace(/_/g, "."), device: null };
  if (/cros/i.test(ua)) return { os: "ChromeOS", osVersion: null, device: null };
  if (/linux/i.test(ua)) return { os: "Linux", osVersion: null, device: null };
  return { os: null, osVersion: null, device: null };
}

function browser(ua: string): { name: string; version: string | null } | null {
  const pairs: [string, RegExp][] = [
    ["Edge", /edg(?:e|a|ios)?\/([\d.]+)/i],
    ["Opera", /(?:opr|opera)\/([\d.]+)/i],
    ["Samsung Internet", /samsungbrowser\/([\d.]+)/i],
    ["WeChat", /micromessenger\/([\d.]+)/i],
    ["Firefox", /(?:firefox|fxios)\/([\d.]+)/i],
    ["Chrome", /(?:chrome|crios)\/([\d.]+)/i],
    ["Safari", /version\/([\d.]+).*safari/i],
    ["Internet Explorer", /msie ([\d.]+)|trident\/.*rv:([\d.]+)/i],
  ];
  for (const [name, pattern] of pairs) {
    const m = pattern.exec(ua);
    if (m) return { name, version: firstGroup(m) };
  }
  return null;
}

function compose(info: Omit<ClientInfo, "label">): ClientInfo {
  const parts = [
    [info.name, info.version].filter(Boolean).join(" "),
    info.os && info.osVersion?.startsWith("Darwin ")
      ? `${info.os} (${info.osVersion})`
      : [info.os, info.osVersion].filter(Boolean).join(" "),
    info.device,
  ].filter((p): p is string => Boolean(p));
  return { ...info, label: parts.join(" · ") };
}

export function describeUserAgent(raw: string): ClientInfo {
  const ua = raw.trim().slice(0, 1024);
  const empty = { version: null, os: null, osVersion: null, device: null };
  if (!ua || ua === "-") return compose({ kind: "unknown", name: "Empty user agent", ...empty });
  for (const rule of [...scanners, ...crawlers, ...previews]) {
    const m = rule.pattern.exec(ua);
    if (m) return compose({ kind: rule.kind, name: rule.name, ...empty, version: firstGroup(m) });
  }
  for (const rule of [...proxies, ...tools]) {
    const m = rule.pattern.exec(ua);
    if (!m) continue;
    const apple = /cfnetwork|darwin\/|macos\/|iphone|ipad/i.test(ua) ? appleContext(ua) : null;
    let os = apple?.os ?? null;
    if (rule.name === "Surge")
      os = /surge mac/i.test(ua) ? "macOS" : /surge (ios|ipados)/i.test(ua) ? "iOS" : os;
    if (rule.name === "sing-box" && /\bSFI\//.test(ua)) os ??= "iOS";
    if (rule.name === "sing-box" && /\bSFA\//.test(ua)) os ??= "Android";
    if (rule.name === "sing-box" && /\bSFM\//.test(ua)) os ??= "macOS";
    return compose({
      kind: rule.kind,
      name: rule.name,
      version: firstGroup(m),
      os,
      osVersion: apple?.osVersion ?? null,
      device: apple?.device ?? null,
    });
  }
  const webkitNet = /com\.apple\.webkit\.networking\/([\w.]+)/i.exec(ua);
  if (webkitNet) {
    const apple = appleContext(ua);
    return compose({
      kind: "system",
      name: "Apple WebKit Networking",
      version: webkitNet[1] ?? null,
      ...apple,
    });
  }
  if (/mozilla\//i.test(ua)) {
    const b = browser(ua);
    if (b) return compose({ kind: "browser", ...b, ...browserOs(ua) });
  }
  if (/cfnetwork\//i.test(ua)) {
    const app = /^([^/\s]+)\/([\w.]+)/.exec(ua);
    return compose({
      kind: "system",
      name: app ? decodeURIComponent(app[1] ?? "").replace(/%20/g, " ") : "CFNetwork",
      version: app?.[2] ?? null,
      ...appleContext(ua),
    });
  }
  const product = /^([A-Za-z][\w .-]{0,40}?)\/([\w.+-]+)/.exec(ua);
  if (product)
    return compose({
      kind: "unknown",
      name: product[1] ?? ua,
      ...empty,
      version: product[2] ?? null,
    });
  return compose({ kind: "unknown", name: ua.slice(0, 60), ...empty });
}

export const ipScopes = [
  "public",
  "private",
  "loopback",
  "cgnat",
  "link_local",
  "reserved",
  "invalid",
] as const;
export type IpScope = (typeof ipScopes)[number];
const tailnetV6 = ipaddr.parseCIDR("fd7a:115c:a1e0::/48");

/** Coarse address class used to skip geo lookups and to label non-routable sources. */
export function ipScope(value: string): IpScope {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(value.trim());
  } catch {
    return "invalid";
  }
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).match(tailnetV6)) return "cgnat";
  switch (addr.range()) {
    case "unicast":
      return "public";
    case "private":
    case "uniqueLocal":
      return "private";
    case "loopback":
      return "loopback";
    case "carrierGradeNat":
      return "cgnat";
    case "linkLocal":
      return "link_local";
    default:
      return "reserved";
  }
}

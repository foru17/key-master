import { describe, expect, it } from "vitest";
import { type ClientInfo, describeUserAgent, ipScope } from "./client.js";

type Want = Partial<Omit<ClientInfo, "label">>;
describe("describeUserAgent", () => {
  const cases: [string, Want][] = [
    ["", { kind: "unknown", name: "Empty user agent" }],
    ["-", { kind: "unknown", name: "Empty user agent" }],
    // proxy clients
    ["clash.meta/v1.19.20", { kind: "proxy", name: "mihomo", version: "1.19.20" }],
    ["clash.meta/alpha-g99e68e9", { kind: "proxy", name: "mihomo", version: "alpha-g99e68e9" }],
    ["clash.meta", { kind: "proxy", name: "mihomo", version: null }],
    ["mihomo/1.19.23", { kind: "proxy", name: "mihomo", version: "1.19.23" }],
    ["clash-verge/v2.4.0", { kind: "proxy", name: "Clash Verge", version: "2.4.0" }],
    ["Clash", { kind: "proxy", name: "Clash", version: null }],
    ["ClashX Pro/1.118.0", { kind: "proxy", name: "ClashX Pro", version: "1.118.0" }],
    ["Stash/2.4.6 Clash/1.9.0", { kind: "proxy", name: "Stash", version: "2.4.6" }],
    ["Surge Mac/7400", { kind: "proxy", name: "Surge", version: "7400", os: "macOS" }],
    ["Surge iOS/3095", { kind: "proxy", name: "Surge", version: "3095", os: "iOS" }],
    [
      "Shadowrocket/3378 CFNetwork/3886.100.1 Darwin/27.0.0 iPhone18,3",
      {
        kind: "proxy",
        name: "Shadowrocket",
        version: "3378",
        os: "iOS",
        osVersion: "Darwin 27.0.0",
        device: "iPhone18,3",
      },
    ],
    [
      "Quantumult%20X/1.5.0 (iPhone15,2; iOS 17.2)",
      { kind: "proxy", name: "Quantumult X", version: "1.5.0" },
    ],
    ["Loon/760 CFNetwork/1494 Darwin/23.4.0", { kind: "proxy", name: "Loon", version: "760" }],
    [
      "SFI/1.10.3 (Build 1; sing-box 1.10.3)",
      { kind: "proxy", name: "sing-box", version: "1.10.3", os: "iOS" },
    ],
    ["v2rayNG/1.9.16", { kind: "proxy", name: "v2rayNG", version: "1.9.16" }],
    ["v2rayN/7.0", { kind: "proxy", name: "v2rayN", version: "7.0" }],
    [
      "FlClash/v0.8.80 clash-verge Platform/android",
      { kind: "proxy", name: "FlClash", version: "0.8.80" },
    ],
    // tools
    ["curl/8.7.1", { kind: "tool", name: "curl", version: "8.7.1" }],
    ["python-requests/2.28.1", { kind: "tool", name: "python-requests", version: "2.28.1" }],
    ["python-httpx/0.28.1", { kind: "tool", name: "python-httpx", version: "0.28.1" }],
    ["Go-http-client/1.1", { kind: "tool", name: "Go-http-client", version: "1.1" }],
    ["WordPress/6.4.3; https://example.com", { kind: "tool", name: "WordPress", version: "6.4.3" }],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
      { kind: "tool", name: "Headless Chrome", version: "120.0.0.0" },
    ],
    // Apple system networking
    [
      "com.apple.WebKit.Networking/21623.2.7.111.2 Network/5569.81.5 macOS/26.3.1",
      { kind: "system", name: "Apple WebKit Networking", os: "macOS", osVersion: "26.3.1" },
    ],
    [
      "com.apple.WebKit.Networking/21623.2.7.111.2 CFNetwork/3860.400.51 Darwin/25.3.0",
      { kind: "system", name: "Apple WebKit Networking", osVersion: "Darwin 25.3.0" },
    ],
    ["MyApp/12 CFNetwork/1494 Darwin/23.4.0", { kind: "system", name: "MyApp", version: "12" }],
    // previews, crawlers, scanners (checked before browsers because they embed browser tokens)
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.1",
      { kind: "preview", name: "facebookexternalhit", version: "1.1" },
    ],
    ["TelegramBot (like TwitterBot)", { kind: "preview", name: "TelegramBot" }],
    [
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      { kind: "preview", name: "Slackbot" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://example.com/gptbot)",
      { kind: "crawler", name: "GPTBot", version: "1.2" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.3",
      { kind: "crawler", name: "OAI-SearchBot", version: "1.3" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0",
      { kind: "crawler", name: "ClaudeBot", version: "1.0" },
    ],
    [
      "Mozilla/5.0 (compatible; Bytespider; spider-feedback@example.com)",
      { kind: "crawler", name: "Bytespider" },
    ],
    [
      "Mozilla/5.0 (compatible; CensysInspect/1.1; +https://example.com/)",
      { kind: "scanner", name: "Censys", version: "1.1" },
    ],
    [
      "Hello from Palo Alto Networks, find out more about our scans",
      { kind: "scanner", name: "Palo Alto Expanse" },
    ],
    [
      "Mozilla/5.0 (l9scan/2.0.33e27393e; +https://example.com)",
      { kind: "scanner", name: "LeakIX" },
    ],
    ["TLM-Audit-Scanner/1.0", { kind: "scanner", name: "TLM Audit Scanner", version: "1.0" }],
    // browsers
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      { kind: "browser", name: "Chrome", version: "131.0.0.0", os: "Windows", osVersion: "10/11" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      { kind: "browser", name: "Safari", version: "18.1", os: "macOS", osVersion: "10.15.7" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      { kind: "browser", name: "Safari", os: "iOS", osVersion: "18.1", device: "iPhone" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.84 Mobile Safari/537.36",
      { kind: "browser", name: "Chrome", os: "Android", osVersion: "5.0", device: "SM-G900P" },
    ],
    [
      "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:47.0) Gecko/20100101 Firefox/47.0",
      { kind: "browser", name: "Firefox", version: "47.0", os: "Windows", osVersion: "7" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      { kind: "browser", name: "Edge", version: "131.0.0.0" },
    ],
    [
      "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)",
      { kind: "browser", name: "Internet Explorer", version: "9.0", os: "Windows" },
    ],
    // fallbacks
    [
      "SomeAgent/3.2 (+https://example.com)",
      { kind: "unknown", name: "SomeAgent", version: "3.2" },
    ],
    ["weird agent without version", { kind: "unknown", name: "weird agent without version" }],
  ];
  it.each(cases)("%s", (ua, want) => expect(describeUserAgent(ua)).toMatchObject(want));
  it("builds a compact label", () =>
    expect(
      describeUserAgent("Shadowrocket/3378 CFNetwork/3886.100.1 Darwin/27.0.0 iPhone18,3").label,
    ).toBe("Shadowrocket 3378 · iOS (Darwin 27.0.0) · iPhone18,3"));
  it("never throws on long or binary input", () =>
    expect(() => describeUserAgent(`\u0000${"x".repeat(5000)}`)).not.toThrow());
});
describe("ipScope", () => {
  it.each([
    ["203.0.113.10", "reserved"],
    ["8.8.8.8", "public"],
    ["10.1.2.3", "private"],
    ["192.168.1.2", "private"],
    ["172.18.0.5", "private"],
    ["127.0.0.1", "loopback"],
    ["::1", "loopback"],
    ["100.100.1.1", "cgnat"],
    ["fd7a:115c:a1e0::1", "cgnat"],
    ["fd00::1", "private"],
    ["fe80::1", "link_local"],
    ["2400:cb00::1", "public"],
    ["::ffff:8.8.8.8", "public"],
    ["not-an-ip", "invalid"],
  ])("%s → %s", (ip, scope) => expect(ipScope(ip)).toBe(scope));
});

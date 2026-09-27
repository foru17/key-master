import { inCidrs, normalizeIp } from "@key-master/core";
export function clientIp(peer: string, headers: Headers, trustedProxies: string[]): string {
  const direct = normalizeIp(peer) ?? "unknown";
  if (!inCidrs(direct, trustedProxies)) return direct;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded.split(",").map((value) => normalizeIp(value.trim()));
    if (chain.length > 32 || chain.some((value) => value === null)) return direct;
    let current = direct;
    for (const hop of chain.reverse()) {
      if (!inCidrs(current, trustedProxies)) break;
      current = hop ?? direct;
    }
    return current;
  }
  return normalizeIp(headers.get("x-real-ip") ?? "") ?? direct;
}

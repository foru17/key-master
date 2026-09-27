import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export type AllowlistEntry = {
  id: string;
  value: string;
  kind: "ip" | "cidr" | "host";
  scope: string[];
  revokedAt: number | null;
  resolved: string[];
};

/** Validate and canonicalize an owner-supplied network or DNS name. */
export function parseAllowlistValue(
  raw: string,
): { value: string; kind: AllowlistEntry["kind"] } | null {
  const value = raw.trim();
  if (isIP(value)) return { value: ipaddr.process(value).toString(), kind: "ip" };
  if (value.includes("/")) {
    const [address, prefixText] = value.split("/");
    if (!address || !isIP(address) || !/^\d+$/.test(prefixText ?? "")) return null;
    try {
      const [network, prefix] = ipaddr.parseCIDR(value);
      if (network.kind() === "ipv6" && (network as ipaddr.IPv6).isIPv4MappedAddress()) return null;
      if (prefix < (network.kind() === "ipv4" ? 24 : 48)) return null;
      return { value: networkAddress(network, prefix), kind: "cidr" };
    } catch {
      return null;
    }
  }
  const host = value.toLowerCase().replace(/\.$/, "");
  if (host.length > 253 || !host.includes(".") || /^[\d.]+$/.test(host)) return null;
  if (!host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
    return null;
  return { value: host, kind: "host" };
}

function networkAddress(address: ipaddr.IPv4 | ipaddr.IPv6, prefix: number): string {
  const bytes = address
    .toByteArray()
    .map((byte, i) => byte & (255 << Math.max(0, Math.min(8, (i + 1) * 8 - prefix))));
  return `${ipaddr.fromByteArray(bytes).toString()}/${prefix}`;
}

/** Quick approvals share an IPv6 /64; explicit IP entries remain exact. */
export function allowlistValueForIp(ip: string): string | null {
  if (!isIP(ip)) return null;
  const address = ipaddr.process(ip);
  return address.kind() === "ipv6" ? networkAddress(address, 64) : address.toString();
}

export function matchesAllowlist(entry: AllowlistEntry, ip: string, slug: string): boolean {
  if (entry.revokedAt !== null || (!entry.scope.includes("*") && !entry.scope.includes(slug)))
    return false;
  if (!isIP(ip)) return false;
  const address = ipaddr.process(ip);
  const candidates = entry.kind === "host" ? entry.resolved : [entry.value];
  return candidates.some((value) => {
    try {
      if (entry.kind === "cidr") {
        const [network, prefix] = ipaddr.parseCIDR(value);
        return address.kind() === network.kind() && address.match(network, prefix);
      }
      if (!isIP(value)) return false;
      const target = ipaddr.process(value);
      return (
        address.kind() === target.kind() &&
        address.match(
          target,
          entry.kind === "host" && target.kind() === "ipv6"
            ? 64
            : target.kind() === "ipv6"
              ? 128
              : 32,
        )
      );
    } catch {
      return false;
    }
  });
}

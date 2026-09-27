import { expect, it } from "vitest";
import { formatTimestamp } from "./time.js";

it.each([
  [0, "en", "UTC", "01/01/1970, 00:00:00"],
  [Date.parse("2026-01-01T12:00:00Z"), "en", "America/New_York", "01/01/2026, 07:00:00"],
  [Date.parse("2026-07-01T12:00:00Z"), "en", "America/New_York", "07/01/2026, 08:00:00"],
  [Date.parse("2026-09-27T23:22:09Z"), "zh", "Asia/Singapore", "2026/09/28 07:22:09"],
] as const)("formats %s in %s / %s", (value, language, zone, expected) => {
  expect(formatTimestamp(value, language, zone)).toBe(expected);
});

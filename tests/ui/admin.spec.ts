import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";

const serverRequire = createRequire(`${process.cwd()}/apps/server/package.json`);
const Database = serverRequire("better-sqlite3");
function resetLimits() {
  const db = new Database(".verification/ui.db");
  db.prepare("DELETE FROM auth_limits").run();
  db.close();
}
async function login(page: Page) {
  resetLimits();
  await page.goto("/admin/overview");
  await page.getByRole("button", { name: "Send code to Telegram", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your Telegram" })).toBeVisible();
  const code = readFileSync(".verification/telegram-code.txt", "utf8");
  await page.getByRole("textbox", { name: "Verification code 1", exact: true }).fill(code);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
}
async function checkLayout(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const clippedActions = await page
    .locator(".approval-item .td.actions > button, .request-actions > button")
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => {
          const box = button.getBoundingClientRect();
          return box.width > 0 && (box.left < 0 || box.right > innerWidth);
        })
        .map((button) => button.textContent),
    );
  expect(clippedActions).toEqual([]);
  const dialog = page.locator("dialog[open]");
  if (await dialog.count()) {
    const box = await dialog.last().boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (page.viewportSize()?.width ?? 0) + 1,
    );
  }
}
async function contrast(page: Page) {
  return page.evaluate(() => {
    const parse = (s: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return [0, 0, 0];
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const lum = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((n) => {
          const v = n / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((a, v, i) => a + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
    const failures: { text: string; ratio: number; color: string; background: string }[] = [];
    for (const e of document.querySelectorAll("body *")) {
      if (
        !(e instanceof HTMLElement) ||
        e.closest("[inert]") ||
        !e.checkVisibility() ||
        !(
          e instanceof HTMLInputElement ||
          e instanceof HTMLSelectElement ||
          e instanceof HTMLTextAreaElement ||
          Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim())
        )
      )
        continue;
      const style = getComputedStyle(e);
      let parent: HTMLElement | null = e;
      let background = "rgb(255, 255, 255)";
      while (parent) {
        const bg = getComputedStyle(parent).backgroundColor;
        if ((parse(bg)[3] ?? 0) > 0) {
          background = bg;
          break;
        }
        parent = parent.parentElement;
      }
      const a = lum(parse(style.color)),
        b = lum(parse(background));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5)
        failures.push({
          text: (e.textContent ?? "").trim().slice(0, 50),
          ratio,
          color: style.color,
          background,
        });
    }
    return failures;
  });
}
for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`screenshots ${width} ${theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((theme) => {
        localStorage.setItem("km_theme", theme);
        localStorage.setItem("km_language", "en");
      }, theme);
      const suffix = `${width}-${theme}`;
      const output = "docs/screenshots";
      const gate = ".ui-acceptance/phase-two";
      mkdirSync(gate, { recursive: true });
      const reports: Record<string, unknown> = {};
      async function shot(name: string) {
        await checkLayout(page);
        reports[name] = await contrast(page);
        const path = `${output}/${name}-${suffix}.png`;
        await page.screenshot({ path, fullPage: !(await page.locator("dialog[open]").count()) });
        copyFileSync(path, `${gate}/${name}-${suffix}.png`);
      }
      await page.goto("/admin/overview");
      await expect(page.getByRole("heading", { name: "Welcome to key-master" })).toBeVisible();
      await shot("login");
      await login(page);
      await expect(page.locator(".stat").first()).toBeVisible();
      await expect(page.locator(".chart-labels time:visible")).toHaveCount(width === 390 ? 3 : 6);
      await shot("overview");
      await page.goto("/admin/requests");
      await expect(page.locator(".skeleton")).toHaveCount(0);
      await shot("requests");
      await page.goto("/admin/requests?q=EXAMPLE_PENDING_REQUEST");
      const row =
        width === 1440 ? page.locator(".audit-row").first() : page.locator(".audit-card").first();
      await row.click();
      await expect(page.getByRole("heading", { name: "Request details" })).toBeVisible();
      await shot("requests-drawer");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.goto("/admin/tokens");
      await page.getByRole("button", { name: "Issue token", exact: true }).first().click();
      await shot("tokens-issue");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.goto("/admin/settings");
      await expect(page.getByText("Live notice preview")).toBeVisible();
      await shot("settings-preview");
      for (const name of ["approvals", "grants", "resources"]) {
        await page.goto(`/admin/${name}`);
        await expect(page.locator(".content h1")).toBeVisible();
        await expect(page.locator(".skeleton")).toHaveCount(0);
        await shot(name);
      }
      await page.goto("/example-rules");
      await expect(page.locator("h1")).toContainText("approval");
      await shot("denied");
      writeFileSync(`.verification/contrast-${suffix}.json`, JSON.stringify(reports, null, 2));
      expect(errors).toEqual([]);
      expect(
        Object.entries(reports).flatMap(([name, items]) =>
          (items as unknown[]).map((item) => ({ name, item })),
        ),
      ).toEqual([]);
    });
test("real admin workflows, rollback, bilingual themes and keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("heading", { name: "Quick navigation" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search anything…" }).fill("203.0.113.42");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=203/);
  await expect(page.locator(".audit-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("button", { name: "System", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(10, 10, 10)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(250, 250, 250)");
  await page.getByRole("button", { name: "中", exact: true }).click();
  await expect(page.locator(".content h1")).toHaveText("请求记录");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.goto("/admin/tokens");
  await page.getByRole("button", { name: "Issue token", exact: true }).first().click();
  await page.getByLabel("Label", { exact: true }).fill("Example browser token");
  await page.locator("dialog").getByRole("button", { name: "Issue token", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Save your token" })).toBeVisible();
  const secret = await page.locator(".secret code").first().textContent();
  expect(secret?.length).toBeGreaterThan(32);
  await page.locator("dialog").getByRole("button", { name: "Close", exact: true }).first().click();
  expect(await page.content()).not.toContain(secret);
  const tokenRow = page.locator(".management-row").filter({ hasText: "Example browser token" });
  await tokenRow.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.locator(":popover-open").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(tokenRow.getByText("Revoked", { exact: true })).toBeVisible();
  await page.goto("/admin/grants");
  await page.getByRole("button", { name: "Create grant", exact: true }).first().click();
  await page.getByLabel("Subject", { exact: true }).fill("203.0.113.99");
  await page.locator("dialog").getByRole("button", { name: "Save changes" }).click();
  const grant = page.locator(".management-row").filter({ hasText: "203.0.113.99" });
  await expect(grant).toBeVisible();
  await grant.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Duration (seconds)", { exact: true }).fill("3600");
  await page.locator("dialog").getByRole("button", { name: "Save changes" }).click();
  await expect(grant.getByText("60 min left")).toBeVisible();
  await grant.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.locator(":popover-open").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(grant.getByText("Active", { exact: true })).toBeVisible();
  await grant.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.locator(":popover-open").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(grant.getByText("Revoked", { exact: true })).toBeVisible();
  await page.goto("/admin/resources");
  await page.getByRole("button", { name: "Create resource", exact: true }).first().click();
  await page.getByLabel("Path", { exact: true }).fill("/example-browser");
  await page.getByLabel("Source / content", { exact: true }).fill("Example content");
  await page.locator("dialog").getByRole("button", { name: "Save changes" }).click();
  const resource = page.locator(".resource-row").filter({ hasText: "/example-browser" });
  await expect(resource).toBeVisible();
  await resource.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Source / content", { exact: true }).fill("Edited example content");
  await page.locator("dialog").getByRole("button", { name: "Save changes" }).click();
  await resource.getByRole("switch", { name: "Disable", exact: true }).click();
  await page.locator(":popover-open").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(resource.getByText("Disabled", { exact: true })).toBeVisible();
  await resource.getByRole("switch", { name: "Enable", exact: true }).click();
  await expect(resource.getByText("Enabled", { exact: true })).toBeVisible();
  await resource.getByRole("button", { name: "More actions", exact: true }).click();
  await page.locator(":popover-open").getByRole("button", { name: "Delete", exact: true }).click();
  await page.locator(":popover-open").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(resource).toHaveCount(0);
  await page.goto("/admin/settings");
  await page.getByLabel("Contact text", { exact: true }).fill("Example updated administrator");
  await expect(page.locator(".notice-preview").first()).toContainText(
    "Example updated administrator",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await page.reload();
  await expect(page.getByLabel("Contact text", { exact: true })).toHaveValue(
    "Example updated administrator",
  );
  await page.route("**/api/admin/settings", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Example save failure" }),
        })
      : route.continue(),
  );
  await page.getByRole("switch", { name: "Observe mode" }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator(":popover-open").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Example save failure");
  await expect(page.locator(".observe-chip")).toHaveCount(0);
  await page.unroute("**/api/admin/settings");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator(":popover-open").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator(".observe-chip")).toBeVisible();
  expect((await page.request.get("/example-rules")).status()).toBe(200);
  await page.getByRole("switch", { name: "Observe mode" }).uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".observe-chip")).toHaveCount(0);
  expect((await page.request.get("/example-rules")).status()).toBe(403);
  await page.goto("/admin/approvals");
  await page
    .locator(".approval-item")
    .first()
    .getByRole("button", { name: "Allow 10m", exact: true })
    .click();
  await expect(page.locator(".approval-item")).toHaveCount(2);
  await page
    .locator(".approval-item")
    .first()
    .getByRole("button", { name: "Device token", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Save your token" })).toBeVisible();
  await page.locator("dialog").getByRole("button", { name: "Close", exact: true }).first().click();
  await page
    .locator(".approval-item")
    .first()
    .getByRole("button", { name: "Deny", exact: true })
    .click();
  await page.locator(":popover-open").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("You’re all caught up")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.locator("dialog").getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.locator(".content h1")).toHaveText("Overview");
  await checkLayout(page);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome to key-master" })).toBeVisible();
});

for (const theme of ["light", "dark"] as const)
  test(`sidebar covers the viewport while scrolling ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    await page.addInitScript((value) => localStorage.setItem("km_theme", value), theme);
    await login(page);
    const sidebar = page.locator(".sidebar");
    await expect(sidebar).toHaveCSS("position", "sticky");
    await expect(page.locator("#root")).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(250, 250, 250)" : "rgb(10, 10, 10)",
    );
    await expect(sidebar).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(250, 250, 250)" : "rgb(10, 10, 10)",
    );
    for (const end of [false, true]) {
      await page.evaluate((end) => window.scrollTo(0, end ? document.body.scrollHeight : 0), end);
      expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(
        true,
      );
      if (end) expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
      const box = await sidebar.boundingBox();
      // Sub-pixel layout heights can leave the sticky sidebar a fraction of a pixel off after scrolling.
      expect(Math.abs(box?.y ?? Number.POSITIVE_INFINITY)).toBeLessThan(1);
      expect(box?.height).toBe(600);
      await expect(page.locator(".sidebar-footer")).toBeInViewport();
    }
  });

test("brand has no decorative slash on desktop and mobile", async ({ page }) => {
  await login(page);
  await expect(page.locator(".sidebar .brand")).toHaveText("key-master");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(page.locator(".mobile-nav .brand")).toHaveText("key-master");
});

for (const timezoneId of ["Asia/Singapore", "America/New_York"])
  test(`timestamps follow browser timezone and language: ${timezoneId}`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId });
    const page = await context.newPage();
    await login(page);
    await page.goto("/admin/requests?q=EXAMPLE_PENDING_REQUEST");
    const stamp = page.locator(".audit-row time").first();
    await expect(stamp).toBeVisible();
    const iso = await stamp.getAttribute("datetime");
    if (!iso) throw new Error("Missing ISO timestamp");
    const expected = async (language: string) =>
      page.evaluate(
        ({ iso, language }) =>
          new Intl.DateTimeFormat(language, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
          }).format(new Date(iso)),
        { iso, language },
      );
    await expect(stamp).toHaveText(await expected("en"));
    await expect(stamp).toHaveAttribute("title", iso);
    await page.locator(".audit-row").first().click();
    await expect(page.locator("dialog time")).toHaveText(await expected("en"));
    await expect(page.locator("dialog time")).toHaveAttribute("title", iso);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "中", exact: true }).click();
    await expect(stamp).toHaveText(await expected("zh"));
    await context.close();
  });

for (const [width, theme] of [
  [1440, "light"],
  [390, "light"],
  [1440, "dark"],
] as const)
  test(`allowlist workflow ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((theme) => {
      localStorage.setItem("km_theme", theme);
      localStorage.setItem("km_language", "en");
    }, theme);
    await login(page);
    const output = ".ui-acceptance/2026-09-28";
    mkdirSync(output, { recursive: true });
    const suffix = width === 390 ? "mobile" : theme === "dark" ? "dark" : "desktop";
    const shot = async (name: string) => {
      await checkLayout(page);
      expect(await contrast(page)).toEqual([]);
      await page.screenshot({
        path: `${output}/${name}-${suffix}.png`,
        fullPage: !(await page.locator("dialog[open]").count()),
      });
    };
    await page.goto("/admin/grants");
    await page.getByRole("button", { name: "Add network", exact: true }).click();
    await page.getByLabel("IP, CIDR or hostname").fill("203.0.113.0/23");
    await page.getByLabel("Label", { exact: true }).fill(`Example home ${suffix}`);
    await page
      .getByLabel("Scope (comma-separated paths or *)", { exact: true })
      .fill("/example-feed");
    await page.locator("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("dialog").getByText("Invalid input / 输入无效")).toBeVisible();
    await page.getByLabel("IP, CIDR or hostname").fill("home.example.com");
    await shot("allowlist-dialog");
    await page.locator("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const row = page.locator(".t-allowlist .tr").filter({ hasText: `Example home ${suffix}` });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Hostname");
    await expect(row).toContainText("/example-feed");
    // DNS is tested with an injected resolver in server tests; seed its display snapshot here.
    const db = new Database(".verification/ui.db");
    db.prepare(
      "UPDATE allowlist SET resolved = ?, resolved_at = ?, last_matched_at = ? WHERE label = ?",
    ).run(
      JSON.stringify(["203.0.113.7", "2001:db8:1:2:abcd:1234:5678:9abc"]),
      Date.now(),
      Date.now() - 60000,
      `Example home ${suffix}`,
    );
    db.close();
    await page.reload();
    await expect(row).toContainText("2001:db8:1:2:abcd:1234:5678:9abc");
    await shot("grants");
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await shot("allowlist-remove");
    await page
      .locator(":popover-open")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await page
      .locator(":popover-open")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "中", exact: true }).click();
    await expect(page.getByRole("heading", { name: "长期白名单", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新增网络", exact: true }).click();
    await expect(page.getByLabel("IP、CIDR 或主机名")).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "EN", exact: true }).click();

    // Each viewport gets a unique, auditable pending request.
    const fixture = new Database(".verification/ui.db");
    const requestId = `EXAMPLE_ALLOWLIST_${suffix}`;
    const ip = "2001:db8:1:2::1234";
    fixture
      .prepare(
        "INSERT INTO requests (id,ts,ip,ua,client_family,method,path,resource_slug,decision,status,bytes,latency_ms,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        requestId,
        Date.now(),
        ip,
        "curl/8",
        "curl",
        "GET",
        "/example-feed",
        "/example-feed",
        "deny_pending",
        403,
        0,
        0,
        "app",
      );
    fixture
      .prepare(
        "INSERT INTO pending (id,subject,request_id,slugs,expires_at,messages) VALUES (?,?,?,?,?,?)",
      )
      .run(
        requestId,
        `${ip}|curl`,
        requestId,
        '["/example-feed"]',
        Date.now() + 2 * 86400000,
        "[]",
      );
    fixture.close();
    await page.goto("/admin/overview");
    const pending = page.locator(".approval-item").filter({ hasText: ip });
    await expect(pending).toBeVisible();
    await shot("overview");
    await pending.getByRole("button", { name: "Always allow this IP", exact: true }).click();
    await expect(pending).toHaveCount(0);
    const listed = await (await page.request.get("/api/admin/allowlist")).json();
    expect(listed.some((item: { value: string }) => item.value === "2001:db8:1:2::/64")).toBe(true);
    await page.goto(`/admin/requests?q=${requestId}`);
    await (width === 390
      ? page.locator(".audit-card").first()
      : page.locator(".audit-row").first()
    ).click();
    await page.getByRole("button", { name: "Always allow this IP", exact: true }).click();
    await expect(
      page.getByText("This network is now always allowed", { exact: true }),
    ).toBeVisible();
    await shot("requests-drawer");
    await page.locator("dialog[open]").getByRole("button", { name: "Close", exact: true }).click();
    // Match a real gateway request through an explicit loopback entry.
    const added = await page.request.post("/api/admin/allowlist", {
      data: { value: "127.0.0.1", label: `Example local ${suffix}` },
    });
    expect(added.status()).toBe(201);
    expect((await page.request.get("/example-feed")).status()).toBe(200);
    await page.goto("/admin/requests");
    await page
      .getByRole("combobox", { name: "Decision", exact: true })
      .selectOption("allow_allowlist");
    await expect(page.locator(width === 390 ? ".audit-card" : ".audit-row").first()).toContainText(
      "Allowlist",
    );
    await shot("requests");
    await page
      .locator(width === 390 ? ".audit-card" : ".audit-row")
      .first()
      .click();
    await expect(page.locator(".detail-list").first()).toContainText(`Example local ${suffix}`);
    await expect(page.locator(".drawer-summary .pill")).toHaveClass(/allow/);
    await shot("matched-drawer");
    const { id } = await added.json();
    expect((await page.request.delete(`/api/admin/allowlist/${id}`, { data: {} })).status()).toBe(
      200,
    );
    await page.locator("dialog[open]").getByRole("button", { name: "Close", exact: true }).click();
    await page.goto("/admin/approvals");
    await expect(page.locator(".skeleton")).toHaveCount(0);
    await shot("approvals");
  });

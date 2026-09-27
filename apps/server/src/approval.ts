import { and, eq, gt, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type { PendingRequest } from "./app.js";
import type { Config, Secrets } from "./config.js";
import { issueToken, type Store } from "./db.js";
import * as schema from "./schema.js";

export function recordPending(store: Store, config: Config, request: PendingRequest) {
  return store.db.transaction((tx) => {
    const subject = `${request.ip}|${request.family}`;
    const existing = tx
      .select()
      .from(schema.pending)
      .where(and(eq(schema.pending.subject, subject), gt(schema.pending.expiresAt, request.now)))
      .get();
    if (existing) {
      if (existing.resolvedAt === null && !existing.slugs.includes(request.slug))
        tx.update(schema.pending)
          .set({ slugs: [...existing.slugs, request.slug] })
          .where(eq(schema.pending.id, existing.id))
          .run();
      return null;
    }
    const value = {
      id: ulid(),
      subject,
      requestId: request.requestId,
      slugs: [request.slug],
      expiresAt: request.now + config.durations.pending * 1000,
      messages: [] as { chatId: string; messageId: number }[],
    };
    tx.insert(schema.pending).values(value).run();
    return value;
  });
}

export function resolveApproval(
  store: Store,
  secrets: Secrets,
  input: {
    id: string;
    action: "allow" | "deny" | "device_token";
    duration: number;
    actor: string;
    messageId?: number;
  },
  now: number,
) {
  return store.db.transaction((tx) => {
    const pending = tx
      .select()
      .from(schema.pending)
      .where(
        and(
          eq(schema.pending.id, input.id),
          isNull(schema.pending.resolvedAt),
          gt(schema.pending.expiresAt, now),
        ),
      )
      .get();
    if (!pending) return null;
    tx.update(schema.pending)
      .set({ resolvedAt: now })
      .where(eq(schema.pending.id, pending.id))
      .run();
    let token: { id: string; secret: string } | undefined;
    if (input.action === "device_token")
      token = issueToken(
        store,
        { kind: "device", label: pending.subject, scope: pending.slugs },
        secrets.tokenPepper,
        now,
      );
    else if (input.action === "deny") {
      tx.insert(schema.blocks)
        .values({
          subject: pending.subject,
          until: now + input.duration * 1000,
          reason: input.actor,
        })
        .onConflictDoUpdate({
          target: schema.blocks.subject,
          set: { until: now + input.duration * 1000, reason: input.actor },
        })
        .run();
    } else
      tx.insert(schema.grants)
        .values({
          id: ulid(),
          subjectKind: "ip_client",
          subject: pending.subject,
          scope: pending.slugs,
          grantedBy: input.actor,
          expiresAt: now + input.duration * 1000,
          createdAt: now,
        })
        .run();
    tx.insert(schema.approvals)
      .values({
        id: ulid(),
        requestId: pending.requestId,
        subject: pending.subject,
        tgMessageId: input.messageId ?? null,
        action: input.action,
        actor: input.actor,
        durationS: input.action === "device_token" ? 0 : input.duration,
        ts: now,
      })
      .run();
    return { pending, token };
  });
}

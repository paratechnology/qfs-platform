import "server-only";

import { prisma } from "../db";
import { logger } from "../logger";
import { randomBytes } from "crypto";

/** In-app notification for a user. */
export async function notify(
  userId: string,
  title: string,
  body?: string,
  link?: string
): Promise<void> {
  await prisma.notification.create({ data: { userId, title, body, link } });
}

/** Immutable audit trail for admin actions. */
export async function auditLog(
  actorId: string,
  actorRole: string,
  action: string,
  targetType: string,
  targetId?: string | null,
  meta?: unknown,
  ip?: string | null
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId,
      actorRole,
      action,
      targetType,
      targetId: targetId ?? undefined,
      meta: meta === undefined ? undefined : JSON.stringify(meta),
      ip: ip ?? undefined,
    },
  });
}

export function newReference(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return s?.value ?? fallback;
}

export async function getSettingInt(key: string, fallback = 0): Promise<number> {
  const raw = await getSetting(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function logError(action: string, err: unknown): void {
  logger.error(`service:${action}`, err instanceof Error ? err.message : err);
}
import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { listSettings, upsertSetting } from "@/lib/services/admin";
import { settingUpsertSchema } from "@/lib/validators";
import { auditLog } from "@/lib/services/admin-log";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    await requireAdmin();
    return listSettings();
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const body = await parseJson(req);

    const parsed = settingUpsertSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid setting data");
    }

    const setting = await upsertSetting(parsed.data.key, parsed.data.value);
    await auditLog(admin.id, "ADMIN", "SETTING.UPSERT", "Setting", setting.id, { key: setting.key });
    return setting;
  });
}
import { Router, type IRouter } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

async function getOrCreateSettings() {
  const [existing] = await db.select().from(appSettingsTable).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(appSettingsTable).values({
    longcatApiKey: "ak_23V6tb6f04Vq4m030D2SA74N0EW1a",
    longcatModel: "LongCat-Flash-Chat",
    pollinationsEnabled: true,
    pollinationsApiKey: "",
    defaultLanguage: "english",
    defaultWordCount: 800,
    concurrentGenerations: 5,
    customApis: [],
  }).returning();
  return created;
}

function serializeSettings(settings: any) {
  return {
    longcatApiKey: settings.longcatApiKey,
    longcatModel: settings.longcatModel,
    pollinationsEnabled: settings.pollinationsEnabled,
    pollinationsApiKey: settings.pollinationsApiKey ?? "",
    defaultLanguage: settings.defaultLanguage,
    defaultWordCount: settings.defaultWordCount,
    concurrentGenerations: settings.concurrentGenerations,
    customApis: settings.customApis as any[],
  };
}

router.get("/settings", requireAdmin, async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(serializeSettings(settings));
});

router.patch("/settings", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body;

  const existing = await getOrCreateSettings();
  const updateData: any = {};
  if (body.longcatApiKey != null) updateData.longcatApiKey = body.longcatApiKey;
  if (body.longcatModel != null) updateData.longcatModel = body.longcatModel;
  if (body.pollinationsEnabled != null) updateData.pollinationsEnabled = body.pollinationsEnabled;
  if (body.pollinationsApiKey != null) updateData.pollinationsApiKey = body.pollinationsApiKey;
  if (body.defaultLanguage != null) updateData.defaultLanguage = body.defaultLanguage;
  if (body.defaultWordCount != null) updateData.defaultWordCount = body.defaultWordCount;
  if (body.concurrentGenerations != null) updateData.concurrentGenerations = body.concurrentGenerations;
  if (body.customApis != null) updateData.customApis = body.customApis;

  if (Object.keys(updateData).length === 0) {
    res.json(serializeSettings(existing));
    return;
  }

  await db.update(appSettingsTable)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(appSettingsTable.id, existing.id));

  const [settings] = await db.select().from(appSettingsTable).limit(1);
  res.json(serializeSettings(settings));
});

export default router;

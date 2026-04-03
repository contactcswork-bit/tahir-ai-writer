import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  longcatApiKey: text("longcat_api_key").notNull().default("ak_23V6tb6f04Vq4m030D2SA74N0EW1a"),
  longcatModel: text("longcat_model").notNull().default("LongCat-Flash-Chat"),
  pollinationsEnabled: boolean("pollinations_enabled").notNull().default(true),
  pollinationsApiKey: text("pollinations_api_key").notNull().default(""),
  defaultLanguage: text("default_language").notNull().default("english"),
  defaultWordCount: integer("default_word_count").notNull().default(800),
  concurrentGenerations: integer("concurrent_generations").notNull().default(5),
  customApis: jsonb("custom_apis").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAppSettingsSchema = createInsertSchema(appSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettingsTable.$inferSelect;

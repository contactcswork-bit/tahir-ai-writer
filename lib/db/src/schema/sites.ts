import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const foldersTable = pgTable("folders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFolderSchema = createInsertSchema(foldersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type Folder = typeof foldersTable.$inferSelect;

export const sitesTable = pgTable("sites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  folderId: integer("folder_id"),
  name: text("name").notNull(),
  url: text("url").notNull(),
  username: text("username").notNull(),
  applicationPassword: text("application_password").notNull(),
  status: text("status").notNull().default("pending"),
  isPinned: boolean("is_pinned").notNull().default(false),
  category: text("category").notNull().default("General"),
  lastTested: timestamp("last_tested", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSiteSchema = createInsertSchema(sitesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Site = typeof sitesTable.$inferSelect;

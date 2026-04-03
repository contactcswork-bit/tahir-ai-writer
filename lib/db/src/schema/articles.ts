import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  siteId: integer("site_id"),
  keyword: text("keyword").notNull(),
  title: text("title"),
  content: text("content"),
  language: text("language").notNull().default("english"),
  wordCount: integer("word_count"),
  status: text("status").notNull().default("queued"),
  publishedUrl: text("published_url"),
  featuredImageUrl: text("featured_image_url"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  model: text("model"),
  imageSource: text("image_source").default("pollinations"),
  publishNow: integer("publish_now").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertArticleSchema = createInsertSchema(articlesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;

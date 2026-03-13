import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  status: text("status").notNull().default("draft"),
  videoType: text("video_type").notNull().default("longform"),
  visualStyle: text("visual_style").notNull().default("cinematic"),
  duration: text("duration").notNull().default("10min"),
  tone: text("tone").notNull().default("calm"),
  referenceUrl: text("reference_url"),
  scriptJson: jsonb("script_json"),
  thumbnailUrl: text("thumbnail_url"),
  videoUrl: text("video_url"),
  progress: integer("progress").notNull().default(0),
  progressMessage: text("progress_message"),
  errorMessage: text("error_message"),
  costEstimate: integer("cost_estimate"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  progress: true,
  progressMessage: true,
  errorMessage: true,
  videoUrl: true,
  thumbnailUrl: true,
  scriptJson: true,
  costEstimate: true,
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  real,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("user_role", ["admin", "editor"]);
export const clipStatusEnum = pgEnum("clip_status", [
  "uploading",
  "processing",
  "ready",
  "error",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: roleEnum("role").notNull().default("editor"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  driveFolderId: varchar("drive_folder_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clips = pgTable("clips", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 500 }), // AI-generated short title
  description: text("description"), // AI-generated detailed scene description for search
  originalFilename: varchar("original_filename", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  fileSize: integer("file_size").notNull(), // bytes
  duration: real("duration"), // seconds
  width: integer("width"),
  height: integer("height"),
  codec: varchar("codec", { length: 50 }),
  fps: real("fps"),
  status: clipStatusEnum("status").notNull().default("uploading"),
  thumbnailPath: text("thumbnail_path"),
  spriteSheetPath: text("sprite_sheet_path"),
  webvttPath: text("webvtt_path"),
  originalPath: text("original_path").notNull(),
  shotType: varchar("shot_type", { length: 50 }), // AI-classified camera framing
  tags: jsonb("tags").$type<string[]>(), // AI-generated tags for filtering (JSON array)
  driveFileId: varchar("drive_file_id", { length: 255 }),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

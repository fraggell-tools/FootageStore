import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  boolean,
  timestamp,
  real,
  pgEnum,
  jsonb,
  primaryKey,
  uniqueIndex,
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
  displayName: varchar("display_name", { length: 255 }),
  driveFolderId: varchar("drive_folder_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clips = pgTable("clips", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 12 }), // short, unique, shareable clip identifier
  name: varchar("name", { length: 500 }), // AI-generated short title
  description: text("description"), // AI-generated detailed scene description for search
  originalFilename: varchar("original_filename", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  fileSize: bigint("file_size", { mode: "number" }).notNull(), // bytes — bigint: video files can exceed int4 max (~2.14GB)
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
  productSkus: jsonb("product_skus").$type<string[]>(), // Manually assigned product SKUs
  transcript: text("transcript"), // Whisper-generated speech transcript
  hasSpeech: boolean("has_speech"), // True if words/sec exceeds talking-to-camera threshold
  driveFileId: varchar("drive_file_id", { length: 255 }),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("clips_code_unique").on(t.code)]);

export const collections = pgTable("collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const collectionClips = pgTable(
  "collection_clips",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clips.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.clipId] })]
);

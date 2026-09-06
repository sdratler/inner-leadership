import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";
const control = pgSchema("ls_control");
/** Infrastructure metadata only. Workspace/account/case schemas belong to LS-010. */
export const foundationMetadata = control.table("foundation_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

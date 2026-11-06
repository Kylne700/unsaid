import { runMigrations } from "@agent-native/core/db";
import { MIGRATIONS, MIGRATIONS_TABLE } from "../db/migrations";

export default runMigrations(MIGRATIONS, { table: MIGRATIONS_TABLE });

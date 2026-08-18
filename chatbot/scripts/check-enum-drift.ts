/**
 * Proactive schema-drift scan -- checks EVERY enum declared in
 * schema.prisma against the real Postgres enum's actual labels, and
 * flags any that don't match exactly. Written after finding two real,
 * separate live crashes this same shape (attendance_status_enum missing
 * 'on_duty', bonafide_status_enum missing 'faculty_approved') -- rather
 * than wait for the NEXT one to surface as a client-facing 500, this
 * checks all of them at once. A missing value in the DB-but-not-schema
 * direction is the dangerous one (causes a P2023 crash the moment a real
 * row has that value); the reverse (schema-but-not-DB) is comparatively
 * harmless (an enum value nothing has ever needed yet).
 *
 * Usage: npx tsx scripts/check-enum-drift.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/utils/prisma';

const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');

function parseSchemaEnums(): Map<string, string[]> {
  const text = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  const enums = new Map<string, string[]>();
  const enumBlockPattern = /enum\s+(\w+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = enumBlockPattern.exec(text))) {
    const [, name, body] = match;
    const values = body
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => line.length > 0 && !line.startsWith('/*'));
    enums.set(name, values);
  }
  return enums;
}

async function main() {
  const schemaEnums = parseSchemaEnums();
  console.log(`Found ${schemaEnums.size} enums in schema.prisma. Checking against the real DB...\n`);

  let anyDrift = false;
  for (const [name, schemaValues] of schemaEnums) {
    const rows: Array<{ enumlabel: string }> = await prisma.$queryRawUnsafe(`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = $1
      ORDER BY e.enumsortorder;
    `, name);

    if (rows.length === 0) {
      console.log(`⚠  ${name}: not found in the DB at all (typename mismatch? check manually).`);
      continue;
    }

    const dbValues = rows.map((r) => r.enumlabel);
    const schemaSet = new Set(schemaValues);
    const dbSet = new Set(dbValues);

    const missingFromSchema = dbValues.filter((v) => !schemaSet.has(v)); // DANGEROUS -- causes P2023 crashes
    const missingFromDb = schemaValues.filter((v) => !dbSet.has(v)); // harmless, just unused

    if (missingFromSchema.length > 0) {
      anyDrift = true;
      console.log(`🔴 ${name}: DB has values Prisma doesn't know about -- ${JSON.stringify(missingFromSchema)}`);
      console.log(`   This WILL crash (P2023) the moment a real row uses one of these.`);
    }
    if (missingFromDb.length > 0) {
      console.log(`ℹ️  ${name}: schema declares values the DB has never used -- ${JSON.stringify(missingFromDb)} (harmless).`);
    }
  }

  console.log(anyDrift ? '\n🔴 Real drift found -- see above.' : '\n✔ No dangerous drift found -- every DB enum value is known to Prisma.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});

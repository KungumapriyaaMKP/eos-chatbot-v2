import { prisma } from '../src/utils/prisma';

async function main() {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'exam_subject_mapping' ORDER BY ordinal_position`
  );
  console.log(rows);
  await prisma.$disconnect();
}
main();

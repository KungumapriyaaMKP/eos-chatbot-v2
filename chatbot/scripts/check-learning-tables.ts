import { prisma } from '../src/utils/prisma';

async function main() {
  const rows: any = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('query_logs', 'training_examples', 'model_performance')`,
  );
  console.log('Tables that actually exist in the live DB:', JSON.stringify(rows));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});

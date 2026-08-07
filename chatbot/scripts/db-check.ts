import { prisma } from '../src/utils/prisma';

async function main() {
  const modelNames = Object.keys(prisma).filter(
    (key) => !key.startsWith('$') && !key.startsWith('_') && typeof (prisma as any)[key]?.count === 'function',
  );

  const results: Array<{ model: string; count: number | string }> = [];

  for (const name of modelNames) {
    try {
      const count = await (prisma as any)[name].count();
      results.push({ model: name, count });
    } catch (e: any) {
      results.push({ model: name, count: `ERROR: ${e.message.split('\n')[0]}` });
    }
  }

  results.sort((a, b) => a.model.localeCompare(b.model));
  for (const r of results) {
    console.log(`${r.model.padEnd(35)} ${r.count}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

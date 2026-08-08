import { prisma } from '../src/utils/prisma';

async function main() {
  const user = await prisma.users.findUnique({
    where: { email: 'arun.p@sece.ac.in' },
    select: { id: true, faculty: { select: { id: true } } },
  });
  console.log('user.id:', user?.id, ' faculty.id:', user?.faculty?.id, ' equal?', user?.id === user?.faculty?.id);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});

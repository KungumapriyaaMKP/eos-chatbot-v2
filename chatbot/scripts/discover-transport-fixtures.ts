import { prisma } from '../src/utils/prisma';

async function main() {
  const [mapping, bus, faculty] = await Promise.all([
    prisma.student_transport_mapping.findFirst({
      select: { students: { select: { student_id_no: true, soa_applications: { select: { first_name: true, last_name: true } } } }, transport_routes: { select: { name: true } } },
    }),
    prisma.buses.findFirst({ select: { bus_no: true, vehicle_number: true, route_id: true } }),
    prisma.faculty.findFirst({ where: { status: 'active' }, select: { first_name: true, last_name: true } }),
  ]);
  console.log('student_transport_mapping sample:', JSON.stringify(mapping));
  console.log('buses sample:', JSON.stringify(bus));
  console.log('a real faculty name:', JSON.stringify(faculty));
  console.log('counts:', JSON.stringify({
    mappings: await prisma.student_transport_mapping.count(),
    buses: await prisma.buses.count(),
    locations: await prisma.bus_live_locations.count(),
    stages: await prisma.transport_stages.count(),
  }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error('name:', e.name, 'code:', e.code); console.error(e); process.exit(1); });

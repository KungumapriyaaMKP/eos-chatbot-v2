import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { formatCurrency, endSentence, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * Transport module — student (own subscription) / admin (any student's, by
 * name/ID, same free-text lookup as get_marks/get_attendance/...). Reuses
 * resolveTargetStudent exactly like every other "get_*" handler; parent/
 * faculty/hod/coe aren't in these three intents' roles at all, so RBAC
 * already blocks them before a handler ever runs.
 *
 * A student is mapped to a ROUTE + a boarding/destination STAGE
 * (student_transport_mapping) — never directly to a bus. A route can have
 * more than one bus assigned (buses.route_id), so "my bus" means "the
 * bus(es) currently running my route", not a fixed 1:1 assignment.
 */

async function resolveTransportMapping(studentId: number) {
  return prisma.student_transport_mapping.findUnique({
    where: { student_id: studentId },
    select: {
      transport_routes: { select: { id: true, name: true } },
      transport_stages_student_transport_mapping_boarding_stage_idTotransport_stages: {
        select: { stage_name: true, fee_amount: true },
      },
      transport_stages_student_transport_mapping_destination_stage_idTotransport_stages: {
        select: { stage_name: true },
      },
    },
  });
}

/** get_my_bus — route, bus(es), boarding stage, and stage fee for the target student's transport subscription. */
export async function getMyBus({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  if (result.forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_my_bus', confidence: 1 };
  }
  if (!result.student) {
    return { reply: notFoundReply(user, result, 'their bus/route details', 'get_my_bus'), intent: 'get_my_bus', confidence: 1 };
  }

  const mapping = await resolveTransportMapping(result.student.id);
  if (!mapping) {
    return {
      reply: endSentence(`${possessive(user, result.student)} account isn't mapped to a bus route`),
      intent: 'get_my_bus',
      confidence: 1,
    };
  }

  const buses = await prisma.buses.findMany({
    where: { route_id: mapping.transport_routes.id },
    select: { bus_no: true, vehicle_number: true, driver_name: true },
  });

  const boarding = mapping.transport_stages_student_transport_mapping_boarding_stage_idTotransport_stages;
  const destination = mapping.transport_stages_student_transport_mapping_destination_stage_idTotransport_stages;
  const busSection =
    buses.length > 0
      ? markdownTable(
          ['Bus No', 'Vehicle', 'Driver'],
          buses.map((b) => [b.bus_no, b.vehicle_number, b.driver_name ?? '—']),
        )
      : 'No bus is currently assigned to this route.';

  const who = possessive(user, result.student);
  const reply =
    `${who} transport details:\n\n` +
    `Route: ${mapping.transport_routes.name}\n` +
    `Boarding: ${boarding.stage_name} → Destination: ${destination.stage_name}\n` +
    `Stage fee: ${formatCurrency(Number(boarding.fee_amount))}\n\n${busSection}`;

  return { reply, intent: 'get_my_bus', confidence: 1, data: { mapping, buses } };
}

/** get_bus_location — latest GPS ping for the bus(es) on the target student's route. */
export async function getBusLocation({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  if (result.forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_bus_location', confidence: 1 };
  }
  if (!result.student) {
    return { reply: notFoundReply(user, result, "their bus's live location", 'get_bus_location'), intent: 'get_bus_location', confidence: 1 };
  }

  const mapping = await resolveTransportMapping(result.student.id);
  if (!mapping) {
    return {
      reply: endSentence(`${possessive(user, result.student)} account isn't mapped to a bus route`),
      intent: 'get_bus_location',
      confidence: 1,
    };
  }

  const buses = await prisma.buses.findMany({
    where: { route_id: mapping.transport_routes.id },
    select: {
      bus_no: true,
      bus_live_locations: { orderBy: { updated_at: 'desc' }, take: 1, select: { latitude: true, longitude: true, updated_at: true } },
    },
  });

  if (buses.length === 0) {
    return {
      reply: endSentence(`No bus is currently assigned to ${mapping.transport_routes.name}`),
      intent: 'get_bus_location',
      confidence: 1,
    };
  }

  const table = markdownTable(
    ['Bus No', 'Location', 'As of'],
    buses.map((b) => {
      const ping = b.bus_live_locations[0];
      return [b.bus_no, ping ? `${ping.latitude}, ${ping.longitude}` : 'no location data yet', ping ? ping.updated_at.toISOString() : '—'];
    }),
  );

  const who = possessive(user, result.student);
  return { reply: `${who} bus location:\n\n${table}`, intent: 'get_bus_location', confidence: 1, data: buses };
}

/** get_route_stops — every stage on the target student's route, in order, with fees; their own boarding/destination stage marked. */
export async function getRouteStops({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  if (result.forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_route_stops', confidence: 1 };
  }
  if (!result.student) {
    return { reply: notFoundReply(user, result, 'their route stops', 'get_route_stops'), intent: 'get_route_stops', confidence: 1 };
  }

  const mapping = await resolveTransportMapping(result.student.id);
  if (!mapping) {
    return {
      reply: endSentence(`${possessive(user, result.student)} account isn't mapped to a bus route`),
      intent: 'get_route_stops',
      confidence: 1,
    };
  }

  const stages = await prisma.transport_stages.findMany({
    where: { route_id: mapping.transport_routes.id },
    orderBy: { sequence_no: 'asc' },
    select: { stage_name: true, fee_amount: true },
  });

  const boardingName = mapping.transport_stages_student_transport_mapping_boarding_stage_idTotransport_stages.stage_name;
  const table = markdownTable(
    ['Stage', 'Fee', ''],
    stages.map((s) => [s.stage_name, formatCurrency(Number(s.fee_amount)), s.stage_name === boardingName ? 'boarding point' : '']),
  );

  const who = possessive(user, result.student);
  return {
    reply: `${who} route (${mapping.transport_routes.name}) stops:\n\n${table}`,
    intent: 'get_route_stops',
    confidence: 1,
    data: stages,
  };
}

import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply } from './student-lookup.util';
import { fuzzyFindBest } from '../utils/fuzzy';
import { toDateOnly, formatCurrency, markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

const ID_LIKE_PATTERN = /\b[A-Za-z]{0,4}[0-9][A-Za-z0-9]{3,14}\b/g;

/** admin_admission_status — admin: soa_applications status, matched by applicant name (fuzzy) or a mentioned reference number. */
export async function getAdminAdmissionStatus({ message }: HandlerContext): Promise<ChatReply> {
  const applications = await prisma.soa_applications.findMany({
    select: { id: true, first_name: true, last_name: true, status: true, created_at: true, cutoff_physics: true, cutoff_chemistry: true, cutoff_maths: true },
  });

  const idTokens: string[] = message.match(ID_LIKE_PATTERN) ?? [];
  const byId = applications.find((a) => idTokens.includes(String(a.id)));
  const match = byId ?? fuzzyFindBest(message, applications, (a) => ({ name: [a.first_name, a.last_name].filter(Boolean).join(' ') }));

  if (!match) {
    return {
      reply: "Which applicant did you mean? Please include their name or application ID.",
      intent: 'admin_admission_status',
      confidence: 1,
    };
  }

  const name = [match.first_name, match.last_name].filter(Boolean).join(' ');
  const cutoffs = [match.cutoff_physics, match.cutoff_chemistry, match.cutoff_maths].filter((c) => c !== null);
  const cutoffLine = cutoffs.length > 0 ? ` Cutoff marks on file: Physics ${match.cutoff_physics ?? '—'}, Chemistry ${match.cutoff_chemistry ?? '—'}, Maths ${match.cutoff_maths ?? '—'}.` : '';

  return {
    reply: `${name}'s admission application (submitted ${toDateOnly(match.created_at)}): ${match.status}.${cutoffLine}`,
    intent: 'admin_admission_status',
    confidence: 1,
    data: match,
  };
}

/** admin_dd_lookup — admin/finance: education_loan_dd, looked up by DD reference number mentioned in the message. */
export async function getAdminDDLookup({ message }: HandlerContext): Promise<ChatReply> {
  const tokens = message.match(ID_LIKE_PATTERN) ?? [];
  if (tokens.length === 0) {
    return { reply: 'Please include the DD reference number you want to look up.', intent: 'admin_dd_lookup', confidence: 1 };
  }

  for (const token of tokens) {
    const dd = await prisma.education_loan_dd.findFirst({
      where: { dd_reference_number: { equals: token, mode: 'insensitive' } },
      select: {
        dd_reference_number: true,
        bank_name: true,
        amount: true,
        status: true,
        created_at: true,
        student_fee_demand_mapping: { select: { students: { select: { student_id_no: true, soa_applications: { select: { first_name: true, last_name: true } } } } } },
      },
    });
    if (dd) {
      const student = dd.student_fee_demand_mapping.students;
      const name = student.soa_applications ? [student.soa_applications.first_name, student.soa_applications.last_name].filter(Boolean).join(' ') : student.student_id_no;
      return {
        reply: `DD ${dd.dd_reference_number} (${dd.bank_name}, ${formatCurrency(Number(dd.amount))}) for ${name}, received ${toDateOnly(dd.created_at)}: ${dd.status}.`,
        intent: 'admin_dd_lookup',
        confidence: 1,
        data: dd,
      };
    }
  }

  return { reply: `No demand draft found matching "${tokens[0]}".`, intent: 'admin_dd_lookup', confidence: 1 };
}

/** admin_drive_pipeline — admin/placement: applicant counts by status across active drives. */
export async function getAdminDrivePipeline(_ctx: HandlerContext): Promise<ChatReply> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const drives = await prisma.placement_drives.findMany({
    where: { status: { not: 'cancelled' } },
    orderBy: { scheduled_date: 'desc' },
    take: 10,
    select: {
      scheduled_date: true,
      status: true,
      companies: { select: { name: true } },
      student_drive_applications: { select: { status: true } },
    },
  });

  if (drives.length === 0) {
    return { reply: 'No placement drives are on record.', intent: 'admin_drive_pipeline', confidence: 1 };
  }

  const rows = drives.map((d) => {
    const counts: Record<string, number> = {};
    for (const a of d.student_drive_applications) counts[a.status] = (counts[a.status] ?? 0) + 1;
    const placed = counts.placed ?? 0;
    const summary = Object.entries(counts).map(([status, n]) => `${status}: ${n}`).join(', ') || 'no applicants yet';
    return [d.companies.name, toDateOnly(d.scheduled_date), d.student_drive_applications.length, placed, summary];
  });

  const table = markdownTable(['Company', 'Date', 'Applicants', 'Placed', 'Pipeline'], rows);
  return { reply: `Recruitment pipeline (most recent ${drives.length} drives):\n\n${table}`, intent: 'admin_drive_pipeline', confidence: 1, data: drives };
}

/** admin_gate_log — admin/security: main_gate_in_out_ledger entries for a student named/looked-up in the message. */
export async function getAdminGateLog({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  if (result.forbidden) {
    return { reply: "Sorry, you don't have permission to access this information.", intent: 'admin_gate_log', confidence: 1 };
  }
  if (!result.student) {
    return { reply: notFoundReply(user, result, 'their gate entry/exit log', 'admin_gate_log'), intent: 'admin_gate_log', confidence: 1 };
  }

  const entries = await prisma.main_gate_in_out_ledger.findMany({
    where: { student_id: result.student.id },
    orderBy: { recorded_at: 'desc' },
    take: 10,
    select: { entry_type: true, recorded_at: true },
  });

  if (entries.length === 0) {
    return { reply: `No gate log entries found for ${result.student.name}.`, intent: 'admin_gate_log', confidence: 1 };
  }

  const table = markdownTable(['Type', 'Time'], entries.map((e) => [e.entry_type, e.recorded_at.toISOString()]));
  return { reply: `${result.student.name}'s recent gate log:\n\n${table}`, intent: 'admin_gate_log', confidence: 1, data: entries };
}

function formatPOStatus(proposalStatus: string, hasOrder: boolean, sentToVendor: boolean): string {
  if (hasOrder) return sentToVendor ? 'Order placed & sent to vendor' : 'Order approved, not yet sent';
  return proposalStatus === 'pending' ? 'Awaiting review' : proposalStatus;
}

/** admin_po_status — admin/purchase: status through the indent → proposal → PO chain, matched by PO number or item name. */
export async function getAdminPOStatus({ message }: HandlerContext): Promise<ChatReply> {
  const tokens = message.match(ID_LIKE_PATTERN) ?? [];

  for (const token of tokens) {
    const po = await prisma.purchase_orders.findFirst({
      where: { po_number: { equals: token, mode: 'insensitive' } },
      select: {
        po_number: true,
        sent_to_vendor_at: true,
        created_at: true,
        purchase_order_proposals: { select: { status: true, purchase_indents: { select: { item_name: true, quantity: true } } } },
      },
    });
    if (po) {
      const indent = po.purchase_order_proposals.purchase_indents;
      return {
        reply: `PO ${po.po_number} (${indent.item_name} x${indent.quantity}), created ${toDateOnly(po.created_at)}: ${formatPOStatus(po.purchase_order_proposals.status, true, po.sent_to_vendor_at !== null)}.`,
        intent: 'admin_po_status',
        confidence: 1,
        data: po,
      };
    }
  }

  const indents = await prisma.purchase_indents.findMany({
    select: {
      item_name: true,
      quantity: true,
      status: true,
      created_at: true,
      purchase_order_proposals: { select: { status: true, purchase_orders: { select: { po_number: true, sent_to_vendor_at: true } } }, take: 1, orderBy: { id: 'desc' } },
    },
  });
  const match = fuzzyFindBest(message, indents, (i) => ({ name: i.item_name }));
  if (!match) {
    return { reply: "Which purchase order or item did you mean? Please include the PO number or item name.", intent: 'admin_po_status', confidence: 1 };
  }

  const proposal = match.purchase_order_proposals[0];
  const status = !proposal
    ? 'Indent submitted, no proposal yet'
    : formatPOStatus(proposal.status, proposal.purchase_orders !== null, proposal.purchase_orders?.sent_to_vendor_at != null);

  return {
    reply: `${match.item_name} (qty ${match.quantity}), requested ${toDateOnly(match.created_at)}: ${status}.`,
    intent: 'admin_po_status',
    confidence: 1,
    data: match,
  };
}

/** admin_venue_availability — admin/staff: a named venue's upcoming bookings, so availability can be read off directly rather than guessed at from a parsed time range. */
export async function getAdminVenueAvailability({ message }: HandlerContext): Promise<ChatReply> {
  const venues = await prisma.venues.findMany({ select: { id: true, name: true, capacity: true } });
  const venue = fuzzyFindBest(message, venues, (v) => ({ name: v.name }));

  if (!venue) {
    const list = venues.map((v) => v.name).join(', ');
    return { reply: `Which venue did you mean? Available venues: ${list || 'none on record'}.`, intent: 'admin_venue_availability', confidence: 1 };
  }

  const now = new Date();
  const bookings = await prisma.venue_bookings.findMany({
    where: { venue_id: venue.id, to_datetime: { gte: now }, status: { not: 'rejected' } },
    orderBy: { from_datetime: 'asc' },
    take: 10,
    select: { from_datetime: true, to_datetime: true, purpose: true, status: true },
  });

  if (bookings.length === 0) {
    return { reply: `${venue.name} has no upcoming bookings on record — it's free for the foreseeable future.`, intent: 'admin_venue_availability', confidence: 1 };
  }

  const table = markdownTable(
    ['From', 'To', 'Purpose', 'Status'],
    bookings.map((b) => [b.from_datetime.toISOString(), b.to_datetime.toISOString(), b.purpose, b.status]),
  );
  return { reply: `${venue.name}'s upcoming bookings:\n\n${table}`, intent: 'admin_venue_availability', confidence: 1, data: bookings };
}

/** admin_visitor_log — admin/security: recent visitor_logs entries; "currently inside" means exit_time is still null. */
export async function getAdminVisitorLog({ message }: HandlerContext): Promise<ChatReply> {
  const currentlyInside = /\b(inside|currently|right now|still (here|in))\b/i.test(message);

  const entries = await prisma.visitor_logs.findMany({
    where: currentlyInside ? { exit_time: null } : undefined,
    orderBy: { entry_time: 'desc' },
    take: 10,
    select: { visitor_name: true, reason: true, entry_time: true, exit_time: true },
  });

  if (entries.length === 0) {
    return {
      reply: currentlyInside ? 'No visitors are currently marked as inside.' : 'No visitor log entries found.',
      intent: 'admin_visitor_log',
      confidence: 1,
    };
  }

  const table = markdownTable(
    ['Visitor', 'Reason', 'Entered', 'Exited'],
    entries.map((e) => [e.visitor_name ?? 'Unknown', e.reason ?? '—', e.entry_time.toISOString(), e.exit_time ? e.exit_time.toISOString() : 'still inside']),
  );
  const heading = currentlyInside ? 'Visitors currently inside' : 'Recent visitor log';
  return { reply: `${heading}:\n\n${table}`, intent: 'admin_visitor_log', confidence: 1, data: entries };
}

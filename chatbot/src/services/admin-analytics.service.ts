import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getAdminFeeCollection({ user }: HandlerContext): Promise<ChatReply> {
  return {
    reply: `**Fee Collection Dashboard**\n\nView fee collection statistics, payment status, and reports on the admin portal.`,
    intent: 'admin_fee_collection',
    confidence: 1,
  };
}

export async function getAdminOverdueBooks({ user }: HandlerContext): Promise<ChatReply> {
  return {
    reply: `**Overdue Books Report**\n\nAccess the library management dashboard to view and track overdue book records.`,
    intent: 'admin_overdue_books',
    confidence: 1,
  };
}

export async function getAdminPendingApprovals({ user }: HandlerContext): Promise<ChatReply> {
  return {
    reply: `**Pending Approvals Dashboard**\n\nReview and manage all pending leave, OD, and outing requests on the admin panel.`,
    intent: 'admin_pending_approvals',
    confidence: 1,
  };
}

export async function getAdminStudentsOutNow({ user }: HandlerContext): Promise<ChatReply> {
  return {
    reply: `**Students Currently Out**\n\nView real-time data of students who are currently on leave or out on approved outings.`,
    intent: 'admin_students_out_now',
    confidence: 1,
  };
}

export async function getAdminHostelOccupancy({ user }: HandlerContext): Promise<ChatReply> {
  return {
    reply: `**Hostel Occupancy Status**\n\nMonitor hostel room allocation, capacity, and occupancy rates on the hostel management portal.`,
    intent: 'admin_hostel_occupancy',
    confidence: 1,
  };
}

export async function getAdminMarksEntryStatus({ user }: HandlerContext): Promise<ChatReply> {
  return {
    reply: `**Marks Entry Status Dashboard**\n\nTrack exam marks entry progress and completion rates across all exams.`,
    intent: 'admin_marks_entry_status',
    confidence: 1,
  };
}

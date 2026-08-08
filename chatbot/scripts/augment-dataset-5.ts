/**
 * Fifth dataset augmentation pass — found via a full end-to-end RBAC/fuzzy/
 * session-state test sweep (scripts/e2e-role-rbac-test.ts) across every
 * intent x every real role. Two unrelated fixes bundled together:
 *
 * 1. ROLE_UPDATES — the single biggest finding: parent, hod, and coe were
 *    completely missing from every safety-critical and universal utility
 *    intent (greeting, thanks, help, emergency_or_distress, abuse,
 *    injection_attempt, ...) and every generic out-of-scope/redirect intent
 *    (oos_*, password_reset, library_hours, ...). None of these touch any
 *    role-scoped data — they're either pure conversational utility or an
 *    honest "I can't help with that, try X" redirect — so there was never a
 *    security reason to gate them by role at all. In practice this meant a
 *    parent, hod, or coe saying "hi", "thank you", or even expressing
 *    genuine distress ("I feel unsafe and need help right now") got a flat
 *    "Sorry, you don't have permission to access this information" instead
 *    of a real reply. Confirmed live before this fix. This finishes the
 *    RBAC-expansion work from augment-dataset-3.ts, which only extended the
 *    data-bearing intents (get_marks, get_attendance, ...) and missed this
 *    whole other category.
 *
 * 2. NEW_EXAMPLES — two live classifier collisions found in the same sweep:
 *      - "timetable for/of <ID>" (a completely natural admin/parent/hod
 *        phrasing) was losing to get_exam_schedule's own trained example
 *        "23IT001 exam timetable" — close enough in embedding space to win
 *        every time, since get_timetable had no ID-anchored example of its
 *        own to compete with it.
 *      - "shw me marsk of <name>" (typo'd verb + typo'd "marks" + a bare
 *        name instead of a subject/ID) scored 0.513, just under the 0.55
 *        threshold, on its own — independent of any session state.
 *
 * Usage: npx tsx scripts/augment-dataset-5.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

const ROLE_UPDATES: Record<string, string[]> = {
  // Universal utility / safety — every authenticated role, no data exposure at all.
  greeting: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  help: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  thanks: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  goodbye: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  bot_identity: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  wrong_answer: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  human_handoff: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  feedback_positive: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  emergency_or_distress: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  abuse: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  injection_attempt: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  // Generic out-of-scope / redirect — same reasoning, just add the 3 newer
  // roles on top of whichever of student/faculty/admin the dataset already
  // granted (left untouched, not this fix's call to relitigate).
  oos_cgpa: ['student', 'admin', 'parent', 'hod', 'coe'],
  oos_mess_menu: ['student', 'admin', 'parent', 'hod', 'coe'],
  oos_wifi: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  oos_syllabus: ['student', 'admin', 'parent', 'hod', 'coe'],
  oos_faculty_contact: ['student', 'admin', 'parent', 'hod', 'coe'],
  oos_payment_action: ['student', 'admin', 'parent', 'hod', 'coe'],
  out_of_scope: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  password_reset: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  general_facilities: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
  admissions_info: ['student', 'admin', 'parent', 'hod', 'coe'],
  library_hours: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
};

const NEW_EXAMPLES: Record<string, string[]> = {
  get_timetable: [
    'timetable for 23IT001',
    '23IT001 timetable',
    'timetable of 23IT001',
    'show timetable for 23IT001',
    "what is 23IT001's timetable",
    'class timetable for a student by ID',
  ],
  get_marks: ['marks of ganesh', 'marsk of ganesh', 'shw me marks for ganesh', 'give me marks of a student by name'],
};

interface Paragraph {
  raw: string;
  style: string;
  text: string;
  start: number;
  end: number;
}

function extractParagraphs(xml: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const re = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[0];
    const styleMatch = raw.match(/<w:pStyle w:val="([^"]+)"/);
    const textMatches = [...raw.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    const text = textMatches.map((t) => t[1]).join('').trim();
    paragraphs.push({ raw, style: styleMatch ? styleMatch[1] : '', text, start: m.index, end: m.index + raw.length });
  }
  return paragraphs;
}

function rewriteRolesParagraph(raw: string, newRolesLine: string): string {
  let isFirst = true;
  let replaced = false;
  const rewritten = raw.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g, (_full, attrs) => {
    replaced = true;
    const text = isFirst ? newRolesLine : '';
    isFirst = false;
    return `<w:t${attrs || ''}>${text}</w:t>`;
  });
  if (!replaced) throw new Error('No <w:t> found in roles paragraph to rewrite');
  return rewritten;
}

function buildListParagraph(text: string): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>` +
    `<w:spacing w:after="20"/></w:pPr>` +
    `<w:r><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t>${escaped}</w:t></w:r></w:p>`
  );
}

function findIntentBounds(paragraphs: Paragraph[], intentName: string): { headingIndex: number; boundaryIndex: number } | null {
  const headingIndex = paragraphs.findIndex((p) => p.style === 'Heading2' && p.text === intentName);
  if (headingIndex === -1) return null;
  let boundaryIndex = paragraphs.length;
  for (let i = headingIndex + 1; i < paragraphs.length; i++) {
    if (paragraphs[i].style === 'Heading1' || paragraphs[i].style === 'Heading2') {
      boundaryIndex = i;
      break;
    }
  }
  return { headingIndex, boundaryIndex };
}

async function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(DOCX_PATH, BACKUP_PATH);
    console.log(`Backed up original to ${BACKUP_PATH}`);
  } else {
    console.log(`Backup already exists at ${BACKUP_PATH} (not overwritten).`);
  }

  const buffer = fs.readFileSync(DOCX_PATH);
  const zip = await JSZip.loadAsync(buffer);
  let xml = await zip.file('word/document.xml')!.async('text');

  // ── Pass 1: role updates (in-place text rewrite, no length change to worry about across intents) ──
  for (const [intentName, roles] of Object.entries(ROLE_UPDATES)) {
    const paragraphs = extractParagraphs(xml);
    const bounds = findIntentBounds(paragraphs, intentName);
    if (!bounds) {
      console.warn(`⚠ Intent "${intentName}" not found — skipping.`);
      continue;
    }
    const { headingIndex, boundaryIndex } = bounds;
    const rolesParaIndex = paragraphs.findIndex((p, i) => i > headingIndex && i < boundaryIndex && /^roles:\s*/i.test(p.text));
    if (rolesParaIndex === -1) {
      console.warn(`⚠ No roles: line found for "${intentName}" — skipping.`);
      continue;
    }
    const para = paragraphs[rolesParaIndex];
    const newLine = `roles: ${roles.join(', ')}`;
    const newRaw = rewriteRolesParagraph(para.raw, newLine);
    xml = xml.slice(0, para.start) + newRaw + xml.slice(para.end);
    console.log(`✔ roles "${intentName}": "${para.text}" -> "${newLine}"`);
  }

  // ── Pass 2: new examples (insertions, sorted bottom-up so earlier offsets stay valid) ──
  const insertions: Array<{ at: number; xml: string }> = [];
  for (const [intentName, examples] of Object.entries(NEW_EXAMPLES)) {
    const paragraphs = extractParagraphs(xml);
    const bounds = findIntentBounds(paragraphs, intentName);
    if (!bounds) {
      console.warn(`⚠ Intent "${intentName}" not found — skipping.`);
      continue;
    }
    const { boundaryIndex } = bounds;
    const insertAt = boundaryIndex < paragraphs.length ? paragraphs[boundaryIndex].start : paragraphs[paragraphs.length - 1].end;
    insertions.push({ at: insertAt, xml: examples.map(buildListParagraph).join('') });
    console.log(`+ ${examples.length} examples queued for "${intentName}"`);
  }
  insertions.sort((a, b) => b.at - a.at);
  for (const { at, xml: insertXml } of insertions) {
    xml = xml.slice(0, at) + insertXml + xml.slice(at);
  }

  zip.file('word/document.xml', xml);
  const outBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(DOCX_PATH, outBuffer);

  console.log(`✔ Wrote ${DOCX_PATH}`);
}

main().catch((err) => {
  console.error('✖ Dataset augmentation failed:', err);
  process.exit(1);
});

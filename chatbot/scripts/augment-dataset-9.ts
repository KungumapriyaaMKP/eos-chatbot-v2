/**
 * Ninth dataset augmentation pass — found via a full classifier
 * self-consistency audit (scripts/audit-classifier-consistency.ts):
 * classify every example with itself excluded from the candidate pool,
 * see if it still lands on its own intent. 126 misclassifications found;
 * this pass fixes the HIGH-PRIORITY subset — cases where a wired,
 * broadly-permissioned intent's phrasing drifts toward an unwired intent
 * (real data replaced by "not connected yet") or a role-restricted intent
 * (real risk of a wrong permission denial — the exact bug pattern behind
 * two live fixes already this session: faculty_my_classes vs
 * faculty_class_attendance, get_leave_status vs faculty_leave_status).
 *
 * Lower-priority collisions (both intents wired and broadly accessible,
 * so the caller gets SOME real answer either way; or both intents already
 * role-restricted the same way) are intentionally left alone — chasing
 * every one of the 126 risks overfitting the dataset to this one audit
 * script rather than real usage.
 *
 * Usage: npx tsx scripts/augment-dataset-9.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

const NEW_EXAMPLES: Record<string, string[]> = {
  // vs faculty_leave_status (unwired, faculty-only) — residual drift beyond
  // the 7 examples already added in augment-dataset-8.ts.
  get_leave_status: [
    'status of my leave request',
    'has my leave been approved',
    'did my leave get approved yet',
    'checking on my leave application status',
  ],
  // vs faculty_low_attendance / faculty_class_attendance / get_subject_notes
  // (all faculty-only or unwired) — a student's own attendance question.
  get_attendance: [
    'attandance percentage',
    'do i have attendance shortage',
    'am i short of attendance',
    'how is my attendance in java',
    'how many periods have i missed in java',
    'am i below 75 percent attendance',
  ],
  // vs admin_list_faculty / section_students / faculty_my_classes /
  // get_semester_dates (role-restricted or unwired) — self-profile
  // questions from any role about their own basic details.
  get_profile: [
    'what is my designation',
    'what department do i belong to',
    'show my student details',
    'show my details',
    'which class am i in',
    'what year and semester am i in',
  ],
  // vs faculty_my_classes / get_exam_seat (role-restricted / unwired).
  get_timetable: [
    'what classes do i have tomorrow',
    'what classes do i have tmrw',
    'do i have classes today',
    'do i have any classes today',
  ],
  // vs get_fee_breakup (unwired) — common fee-status phrasings.
  get_fees: [
    'outstanding fees',
    'outstanding fees pls',
    'how much fees do i owe',
    'is my fee fully paid',
  ],
  // vs section_performance (unwired) / injection_attempt — personal exam
  // score phrasing, and a couple more typo'd "marsk" variants.
  get_marks: [
    'what is my CIA 2 mark',
    'tell me my exam score in database management system',
    'my marks in computer networks cia 1',
    'can you tell me my cia 2 score',
    'marsk for end sem',
    'marsk in physics exam',
  ],
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

  const insertions: Array<{ at: number; xml: string }> = [];

  for (const [intentName, examples] of Object.entries(NEW_EXAMPLES)) {
    const paragraphs = extractParagraphs(xml);
    const headingIndex = paragraphs.findIndex((p) => p.style === 'Heading2' && p.text === intentName);
    if (headingIndex === -1) {
      console.warn(`⚠ Intent "${intentName}" not found — skipping.`);
      continue;
    }
    let boundaryIndex = paragraphs.length;
    for (let i = headingIndex + 1; i < paragraphs.length; i++) {
      if (paragraphs[i].style === 'Heading1' || paragraphs[i].style === 'Heading2') {
        boundaryIndex = i;
        break;
      }
    }
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

/**
 * Third dataset augmentation pass — extends RBAC coverage beyond
 * student/faculty/admin to three more real roles found in the live
 * database: parent (7,201 real accounts), hod (15, each with their own
 * linked faculty record), and coe (1, no faculty record — a pure
 * exam-authority role). Rewrites each affected intent's "roles: ..." line
 * in place (does NOT add new example utterances — this pass is purely
 * about who's allowed, not new phrasing).
 *
 * Usage: npx tsx scripts/augment-dataset-3.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

const ROLE_UPDATES: Record<string, string[]> = {
  get_attendance: ['student', 'admin', 'parent'],
  get_marks: ['student', 'admin', 'parent'],
  get_fees: ['student', 'admin', 'parent'],
  get_timetable: ['student', 'faculty', 'admin', 'parent', 'hod'],
  get_exam_schedule: ['student', 'admin', 'parent', 'coe'],
  get_my_subjects: ['student', 'admin', 'parent'],
  get_mentor: ['student', 'admin', 'parent'],
  get_announcements: ['student', 'faculty', 'admin', 'parent', 'hod'],
  get_holidays: ['student', 'faculty', 'admin', 'parent', 'hod'],
  admin_list_students: ['admin', 'hod'],
  admin_list_faculty: ['admin', 'hod'],
  faculty_my_classes: ['faculty', 'hod'],
  faculty_class_attendance: ['faculty', 'admin', 'hod'],
  section_students: ['faculty', 'admin', 'hod'],
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

/**
 * Replaces the roles paragraph's text in-place. A paragraph can hold
 * MULTIPLE <w:t> runs (Word splits text across runs for its own reasons —
 * spell-check boundaries, etc.), and the parser concatenates all of them
 * per paragraph — so replacing only the first <w:t> and leaving the rest
 * untouched corrupts the result (old text from later runs gets appended
 * after the new text). Puts the full new line in the first run and empties
 * every subsequent one in the same paragraph.
 */
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

  for (const [intentName, roles] of Object.entries(ROLE_UPDATES)) {
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

    const rolesParaIndex = paragraphs.findIndex(
      (p, i) => i > headingIndex && i < boundaryIndex && /^roles:\s*/i.test(p.text),
    );
    if (rolesParaIndex === -1) {
      console.warn(`⚠ No roles: line found for "${intentName}" — skipping.`);
      continue;
    }

    const para = paragraphs[rolesParaIndex];
    const newLine = `roles: ${roles.join(', ')}`;
    const newRaw = rewriteRolesParagraph(para.raw, newLine);

    xml = xml.slice(0, para.start) + newRaw + xml.slice(para.end);
    console.log(`✔ "${intentName}": "${para.text}" -> "${newLine}"`);
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

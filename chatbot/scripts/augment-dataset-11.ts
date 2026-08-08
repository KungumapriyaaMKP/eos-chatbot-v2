/**
 * Eleventh dataset augmentation pass — remaining confirmed high-risk
 * collisions from the classifier audit (scripts/audit-classifier-consistency.ts),
 * after verifying which flagged items were already fixed (audit noise from
 * its stricter exclude-self methodology) vs genuinely still broken in
 * production classification.
 *
 * Usage: npx tsx scripts/augment-dataset-11.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

const NEW_EXAMPLES: Record<string, string[]> = {
  // vs get_profile — register-number-phrased marks query. (The "marsk"
  // typo variants vs injection_attempt were already fixed in
  // augment-dataset-9.ts — verified still correct in production, not
  // re-added here.)
  get_marks: ['marks for my register number'],
  // vs get_profile — register-number-phrased fee queries.
  get_fees: ['fees for my register number'],
  // vs get_my_subjects (student/admin/parent — NOT faculty) — a faculty
  // member's own teaching load, phrased as "subjects"/"teaching" rather
  // than "classes".
  faculty_my_classes: [
    'show my assigned subjects',
    'what am i teaching this semester',
    'what subjects am i handling',
  ],
  // vs admin_students_out_now (admin-only — excludes hod, who IS allowed
  // on admin_list_students) — a hosteller-scoped student list is still
  // just a filtered student list, not an "out right now" query.
  admin_list_students: ['hosteller students list', 'list of hostel students'],
  // vs admin_admission_status (admin-only) — admissions_info is meant for
  // ANY role asking a general admissions question, not an admin checking
  // a specific existing application's status.
  admissions_info: [
    'how do i apply for admission',
    'admission deadline',
    'when is the last date to apply',
    'what is the admission process',
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

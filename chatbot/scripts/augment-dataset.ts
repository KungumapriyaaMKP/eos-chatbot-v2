/**
 * One-time dataset augmentation: adds ID/roll-number-centric example
 * phrasings ("marks of 23IT001", "23IT001 attendance", ...) to the five
 * "get_*" intents that had thin coverage for that phrasing style — see the
 * chatbot's live testing that surfaced this gap.
 *
 * Deliberately does NOT touch injection_attempt: the exact same phrase
 * ("marks of 23IT001") is legitimate coming from admin and suspicious
 * coming from a student, and SBERT has no notion of caller role — that
 * distinction is enforced in code (src/services/student-lookup.util.ts's
 * `forbidden` check), not in the training data. Teaching the classifier to
 * recognize "marks of <ID>" as get_marks is correct; the RBAC layer is what
 * decides whether THIS caller may see THAT id's marks.
 *
 * Edits a real .docx (a zip of OOXML) in place: parses word/document.xml,
 * clones the exact <w:p> structure Word already uses for this document's
 * bullet lists, and splices in new paragraphs right before each target
 * intent's next heading. A .bak copy of the original is written first.
 *
 * Usage: npx tsx scripts/augment-dataset.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

/**
 * Second pass: "show my marks" (a very ordinary, short first-person
 * request) was landing on `injection_attempt` instead of `get_marks` —
 * its nearest neighbour turned out to be that intent's own
 * "show me another student's marks" example, since both start with "show"
 * and end with "marks" and no bare, subject-less "show my marks" example
 * existed in get_marks to anchor the short phrasing decisively. Confirmed
 * (via grep) that "another student" phrasing in injection_attempt ONLY
 * mentions marks, not attendance/fees/timetable/subjects, so this
 * collision risk is specific to get_marks — no other intent needs it.
 */
const NEW_EXAMPLES: Record<string, string[]> = {
  get_marks: [
    'marks of 23IT001',
    '23IT001 marks',
    'marks for student 23IT001',
    'show marks for roll number 23IT001',
    'maths mark of 23IT001',
    'what are the marks of 23IT001',
    'give me marks for register number 722822111001',
    'check marks for 23IT001',
    "23IT001's marks",
    'marks of roll no 23IT001',
    'show my marks',
    'my marks',
    'what are my marks',
    'give me my marks',
    'check my marks',
  ],
  get_attendance: [
    'attendance of 23IT001',
    '23IT001 attendance',
    'attendance for student 23IT001',
    'what is the attendance of 23IT001',
    'show attendance for roll number 23IT001',
    'check attendance for 23IT001',
    "23IT001's attendance",
    'attendance for register number 722822111001',
  ],
  get_fees: [
    'fee status of 23IT001',
    '23IT001 fees',
    'fees for student 23IT001',
    'what is the fee status of 23IT001',
    'show fee details for roll number 23IT001',
    'check fees for 23IT001',
    "23IT001's fee status",
    'fees for register number 722822111001',
  ],
  get_exam_schedule: [
    'exam schedule of 23IT001',
    '23IT001 exam timetable',
    'exam schedule for student 23IT001',
    'what is the exam schedule for 23IT001',
    'show exam timetable for roll number 23IT001',
    'check exam schedule for 23IT001',
    "23IT001's exam schedule",
  ],
  get_my_subjects: [
    'subjects of 23IT001',
    '23IT001 subjects',
    'subjects for student 23IT001',
    'what subjects does 23IT001 have',
    'show subjects for roll number 23IT001',
    'check subjects for 23IT001',
    "23IT001's subjects",
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

  // Apply insertions back-to-front by document position so earlier offsets
  // in the string stay valid as we splice later ones.
  const insertions: Array<{ at: number; xml: string }> = [];

  for (const [intentName, examples] of Object.entries(NEW_EXAMPLES)) {
    const paragraphs = extractParagraphs(xml);
    const headingIndex = paragraphs.findIndex((p) => p.style === 'Heading2' && p.text === intentName);
    if (headingIndex === -1) {
      console.warn(`⚠ Intent "${intentName}" not found — skipping.`);
      continue;
    }

    let boundaryIndex = paragraphs.length; // default: end of document
    for (let i = headingIndex + 1; i < paragraphs.length; i++) {
      if (paragraphs[i].style === 'Heading1' || paragraphs[i].style === 'Heading2') {
        boundaryIndex = i;
        break;
      }
    }

    const insertAt = boundaryIndex < paragraphs.length ? paragraphs[boundaryIndex].start : paragraphs[paragraphs.length - 1].end;
    const newXml = examples.map(buildListParagraph).join('');
    insertions.push({ at: insertAt, xml: newXml });
    console.log(`+ ${examples.length} examples queued for "${intentName}" (inserting at offset ${insertAt})`);
  }

  insertions.sort((a, b) => b.at - a.at);
  for (const { at, xml: insertXml } of insertions) {
    xml = xml.slice(0, at) + insertXml + xml.slice(at);
  }

  zip.file('word/document.xml', xml);
  // DEFLATE explicitly — JSZip defaults to STORE (no compression), which
  // would balloon this file from ~80KB to well over 1MB.
  const outBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(DOCX_PATH, outBuffer);

  console.log(`✔ Wrote ${DOCX_PATH}`);
  const totalAdded = Object.values(NEW_EXAMPLES).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`✔ Added ${totalAdded} examples across ${Object.keys(NEW_EXAMPLES).length} intents.`);
}

main().catch((err) => {
  console.error('✖ Dataset augmentation failed:', err);
  process.exit(1);
});

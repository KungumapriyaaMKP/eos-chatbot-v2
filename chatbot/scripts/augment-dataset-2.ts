/**
 * Second dataset augmentation pass — incorporates a user-supplied generic
 * university-chatbot pattern sheet:
 *   - Patterns that duplicate existing EOS intents are merged in as more
 *     training examples (course_schedule→get_timetable, fees→get_fees,
 *     exam→get_exam_schedule, results→get_marks, gpa→oos_cgpa,
 *     it_support→oos_wifi, advisor→get_mentor, holiday→get_holidays).
 *   - Genuinely new concepts become brand-new intents, appended under a
 *     new "General" Heading1 section: password_reset, general_facilities,
 *     admissions_info, library_hours.
 *
 * Usage: npx tsx scripts/augment-dataset-2.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

const MERGE_INTO_EXISTING: Record<string, string[]> = {
  get_timetable: ['Show me my course schedule', 'What classes do I have tomorrow?', 'My timetable please'],
  get_fees: ['How much is my tuition fee?', 'Show my fee details', 'What do I owe?'],
  get_exam_schedule: ['When is my next exam?', 'Show exam schedule', 'Do I have exams next week?'],
  get_marks: ['When will results be published?', 'Show my exam results', 'How do I check my grades?'],
  oos_cgpa: ['What is my GPA?', 'Show my GPA', 'How am I doing academically?'],
  oos_wifi: ['WiFi is not working', 'I cannot log in to portal', 'How to connect to campus WiFi?'],
  get_mentor: ['Who is my academic advisor?', 'Show advisor info', 'Advisor details please'],
  get_holidays: ['When is the next holiday?', 'Show holiday list', 'Do we have classes tomorrow?'],
};

interface NewIntent {
  name: string;
  roles: string[];
  description: string;
  examples: string[];
}

const NEW_INTENTS: NewIntent[] = [
  {
    name: 'password_reset',
    roles: ['student', 'faculty', 'admin'],
    description: 'Account/password reset requests: no self-service reset exists; redirect to IT/admin.',
    examples: [
      'How do I reset my password?',
      'I forgot my password',
      'Reset my login',
      "I can't remember my password",
      'Forgot my login credentials',
      'Need to reset my account password',
    ],
  },
  {
    name: 'general_facilities',
    roles: ['student', 'faculty', 'admin'],
    description: 'Campus facility locations (cafeteria, admin office, buildings): not stored in this DB.',
    examples: [
      'Where is the cafeteria?',
      'Show campus map',
      'Where is admin office?',
      'Where is the admin office located?',
      'How do I get to the library building?',
      'Where can I find the hostel office?',
    ],
  },
  {
    name: 'admissions_info',
    roles: ['student', 'admin'],
    description: 'General admissions FAQ (how to apply, documents, deadlines) — distinct from admin_admission_status (checking an existing application); not data-backed, redirect to admissions office.',
    examples: [
      'How do I apply for admission?',
      'What documents are required for admission?',
      'Admission deadline',
      'What is the last date to apply?',
      'How can I submit my application?',
      'What are the eligibility criteria for admission?',
    ],
  },
  {
    name: 'library_hours',
    roles: ['student', 'faculty', 'admin'],
    description: 'Library counter opening/closing time — reads library_settings.',
    examples: [
      'When is the library open?',
      'Library hours',
      'Is the library open today?',
      'What time does the library open?',
      'What time does the library close?',
      'Library timings please',
    ],
  },
];

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

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paraId(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function buildListParagraph(text: string): string {
  return (
    `<w:p w14:paraId="${paraId()}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>` +
    `<w:spacing w:after="20"/></w:pPr>` +
    `<w:r><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function buildPlainParagraph(text: string, bold = false): string {
  const rPr = bold ? '<w:rPr><w:b/><w:bCs/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>' : '<w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>';
  return (
    `<w:p w14:paraId="${paraId()}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:spacing w:after="80"/></w:pPr>` +
    `<w:r>${rPr}<w:t>${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function buildHeading1(text: string): string {
  return (
    `<w:p w14:paraId="${paraId()}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
    `<w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function buildHeading2(text: string): string {
  return (
    `<w:p w14:paraId="${paraId()}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function buildIntentSection(intent: NewIntent): string {
  const parts = [
    buildHeading2(intent.name),
    buildPlainParagraph(`roles: ${intent.roles.join(', ')}`),
    buildPlainParagraph(intent.description),
    buildPlainParagraph(`examples (${intent.examples.length}):`, true),
    ...intent.examples.map(buildListParagraph),
  ];
  return parts.join('');
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

  // --- Part 1: merge examples into existing intents ---
  const insertions: Array<{ at: number; xml: string }> = [];

  for (const [intentName, examples] of Object.entries(MERGE_INTO_EXISTING)) {
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
    console.log(`+ ${examples.length} examples queued for existing intent "${intentName}"`);
  }

  // --- Part 2: append brand-new intents under a new "General" Heading1, right before </w:body>'s sectPr ---
  const bodyEndMatch = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const appendAt = bodyEndMatch ? xml.indexOf(bodyEndMatch[0]) : xml.indexOf('</w:body>');
  const newSectionXml = buildHeading1('General') + NEW_INTENTS.map(buildIntentSection).join('');
  insertions.push({ at: appendAt, xml: newSectionXml });
  console.log(`+ ${NEW_INTENTS.length} new intents queued: ${NEW_INTENTS.map((i) => i.name).join(', ')}`);

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

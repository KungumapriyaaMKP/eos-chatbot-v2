/**
 * Twelfth dataset augmentation pass — adds a brand NEW intent, unlike every
 * prior augment-dataset-*.ts script which only added examples/roles to
 * intents that already existed. get_exam_eligibility didn't exist in the
 * original dataset at all: "am I eligible for the semester exam" /
 * "if I attend all my remaining classes will I be eligible" — a what-if
 * attendance-eligibility calculator, requested directly.
 *
 * Inserted as a new Heading2 block inside the existing "Student - exams"
 * Heading1 module, right before get_exam_schedule, cloning the exact
 * paragraph structures (Heading2 / roles line / description / examples
 * marker / ListParagraph bullets) Word already uses for every other
 * intent in that section — see parse-dataset.ts for what structure the
 * parser actually expects.
 *
 * Usage: npx tsx scripts/augment-dataset-12.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

const NEW_INTENT = {
  name: 'get_exam_eligibility',
  insertBeforeIntent: 'get_exam_schedule', // same "Student - exams" module
  roles: ['student', 'admin'],
  description:
    "Whether the student currently meets the standard attendance requirement to sit the semester exam, including a what-if projection for remaining classes.",
  examples: [
    'am I eligible for the semester exam',
    'am i eligible to write my exams',
    'will i be allowed to sit for the exam',
    'can i write my semester exam',
    'am i eligible for exams',
    'do i meet the attendance requirement for exams',
    'if i attend all my remaining classes will i be eligible',
    'what do i need to do to be eligible for exams',
    'how many more classes do i need to attend to be eligible',
    'exam eligibility status',
    'check my exam eligibility',
    'will my attendance shortage stop me from writing exams',
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

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function newParaId(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function buildHeading2(name: string): string {
  return (
    `<w:p w14:paraId="${newParaId()}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:pStyle w:val="Heading2"/><w:spacing w:before="260" w:after="40"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:eastAsia="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:color w:val="2E5C9E"/></w:rPr><w:t>${escapeXml(name)}</w:t></w:r>` +
    `</w:p>`
  );
}

function buildRolesLine(roles: string[]): string {
  return (
    `<w:p w14:paraId="${newParaId()}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:spacing w:after="40"/></w:pPr>` +
    `<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t xml:space="preserve">roles: ${escapeXml(roles.join(', '))}</w:t></w:r>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:eastAsia="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t></w:t></w:r>` +
    `</w:p>`
  );
}

function buildDescription(text: string): string {
  return (
    `<w:p w14:paraId="${newParaId()}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:spacing w:after="100"/></w:pPr>` +
    `<w:r><w:rPr><w:i/><w:iCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r>` +
    `</w:p>`
  );
}

function buildExamplesMarker(count: number): string {
  return (
    `<w:p w14:paraId="${newParaId()}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:spacing w:after="60"/></w:pPr>` +
    `<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t>examples (${count}):</w:t></w:r>` +
    `</w:p>`
  );
}

function buildListParagraph(text: string): string {
  const escaped = escapeXml(text);
  return (
    `<w:p w14:paraId="${newParaId()}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
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

  const paragraphs = extractParagraphs(xml);
  const existing = paragraphs.find((p) => p.style === 'Heading2' && p.text === NEW_INTENT.name);
  if (existing) {
    console.log(`Intent "${NEW_INTENT.name}" already exists — skipping (not adding a duplicate).`);
    return;
  }

  const insertAtHeading = paragraphs.find((p) => p.style === 'Heading2' && p.text === NEW_INTENT.insertBeforeIntent);
  if (!insertAtHeading) {
    throw new Error(`Could not find "${NEW_INTENT.insertBeforeIntent}" to insert before.`);
  }

  const block =
    buildHeading2(NEW_INTENT.name) +
    buildRolesLine(NEW_INTENT.roles) +
    buildDescription(NEW_INTENT.description) +
    buildExamplesMarker(NEW_INTENT.examples.length) +
    NEW_INTENT.examples.map(buildListParagraph).join('');

  xml = xml.slice(0, insertAtHeading.start) + block + xml.slice(insertAtHeading.start);

  zip.file('word/document.xml', xml);
  const outBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(DOCX_PATH, outBuffer);

  console.log(`✔ Added new intent "${NEW_INTENT.name}" with ${NEW_INTENT.examples.length} examples.`);
  console.log(`✔ Wrote ${DOCX_PATH}`);
}

main().catch((err) => {
  console.error('✖ Dataset augmentation failed:', err);
  process.exit(1);
});

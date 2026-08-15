/**
 * Sixteenth dataset augmentation pass — adds 9 brand NEW intents that a
 * teammate's recent commit wired up handlers + registry entries for, but
 * never actually added to the training dataset itself — meaning
 * classifyIntent() could never produce these names no matter what a real
 * user typed; the handlers (even now that they're fixed to use real data)
 * were 100% dead code. Confirmed via node_modules/intents.json lookup
 * before writing this script — see the commit fixing the fabricated
 * responses for the full list of what else was wrong with that commit.
 *
 * (get_faculty_by_subject, the 10th untrained intent from that commit, is
 * deliberately NOT added here — mentor.service.ts's "which faculty
 * teaches me <subject>" branch, added earlier this session, already
 * covers that exact need under get_mentor; adding a second competing
 * intent for the same question would just reintroduce the kind of
 * classifier collision this whole session has been fixing.)
 *
 * Usage: npx tsx scripts/augment-dataset-16.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const BACKUP_PATH = `${DOCX_PATH}.bak`;

interface NewIntent {
  name: string;
  insertBeforeIntent: string;
  roles: string[];
  description: string;
  examples: string[];
}

const NEW_INTENTS: NewIntent[] = [
  {
    name: 'alumni_network_search',
    insertBeforeIntent: 'get_company_info',
    roles: ['student', 'faculty', 'admin'],
    description: 'Search the alumni network by company or batch.',
    examples: [
      'find alumni working at a specific company',
      'search the alumni network',
      'which alumni work at tcs',
      'alumni from my batch',
      'connect me with alumni in software companies',
      'show me alumni network contacts',
    ],
  },
  {
    name: 'get_result_publication_status',
    insertBeforeIntent: 'get_exam_schedule',
    roles: ['student', 'admin', 'parent'],
    description: 'Whether the student class exam results have been published yet.',
    examples: [
      'has my result been published',
      'are my exam results out yet',
      'when will results be declared',
      'is the internal result published',
      'check result publication status',
      'has the semester result come out',
    ],
  },
  {
    name: 'view_department_achievements',
    insertBeforeIntent: 'get_announcements',
    roles: ['student', 'faculty', 'admin', 'parent', 'hod', 'coe'],
    description: 'Awards, recognitions, and accomplishments posted for a department.',
    examples: [
      'show department achievements',
      'what awards has my department won',
      'recent accomplishments of my department',
      'any recognitions for our department',
      'department achievement list',
    ],
  },
  {
    name: 'get_my_projects',
    insertBeforeIntent: 'get_mentor',
    roles: ['student', 'admin', 'parent'],
    description: "The student's own academic projects and their mentor.",
    examples: [
      'what projects am i working on',
      'show my project list',
      'who is my project mentor',
      'my current academic projects',
      'list the projects i am part of',
    ],
  },
  {
    name: 'project_join_requests_status',
    insertBeforeIntent: 'get_mentor',
    roles: ['student'],
    description: "Status of the student's own requests to join a project team.",
    examples: [
      'did my project team request get approved',
      'status of my project join request',
      'was i accepted into the project team',
      'check my team join application',
      'has my request to join the project been reviewed',
    ],
  },
  {
    name: 'submit_feedback_form',
    insertBeforeIntent: 'get_holidays',
    roles: ['student'],
    description: 'Submitting a course feedback or evaluation form (an action, not a query — redirected to the real portal).',
    examples: [
      'i want to submit my feedback',
      'let me fill the course evaluation form',
      'submit my survey response',
      'i want to give feedback for my professor',
      'fill out the feedback form',
    ],
  },
  {
    name: 'get_active_surveys',
    insertBeforeIntent: 'get_holidays',
    roles: ['student'],
    description: 'Surveys or feedback forms currently awaiting the student response.',
    examples: [
      'any surveys pending for me',
      'do i have a feedback form to fill',
      'what evaluations are open right now',
      'list active surveys',
      'is there a course feedback form open',
    ],
  },
  {
    name: 'get_wallet_balance',
    insertBeforeIntent: 'get_fees',
    roles: ['student', 'admin', 'parent'],
    description: "The student's campus wallet balance and recent transactions.",
    examples: [
      'what is my wallet balance',
      'how much money is in my campus wallet',
      'check my prepaid wallet',
      'campus card balance',
      'my wallet transaction history',
    ],
  },
  {
    name: 'wallet_recharge',
    insertBeforeIntent: 'get_fees',
    roles: ['student'],
    description: 'Recharging the campus wallet (an action, not a query — redirected to the real payment portal).',
    examples: [
      'recharge my wallet',
      'add money to my campus wallet',
      'top up my wallet balance',
      'i want to recharge my campus card',
      'load money into my wallet',
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

  // Insert in reverse document order so earlier insertions don't shift the
  // offsets later ones depend on — resolve every anchor position up front,
  // then splice from the end backwards.
  const insertions: Array<{ at: number; xml: string; name: string }> = [];

  for (const intent of NEW_INTENTS) {
    const paragraphs = extractParagraphs(xml);
    const existing = paragraphs.find((p) => p.style === 'Heading2' && p.text === intent.name);
    if (existing) {
      console.log(`Intent "${intent.name}" already exists — skipping.`);
      continue;
    }
    const anchor = paragraphs.find((p) => p.style === 'Heading2' && p.text === intent.insertBeforeIntent);
    if (!anchor) {
      console.warn(`⚠ Could not find anchor "${intent.insertBeforeIntent}" for "${intent.name}" — skipping.`);
      continue;
    }
    const block =
      buildHeading2(intent.name) +
      buildRolesLine(intent.roles) +
      buildDescription(intent.description) +
      buildExamplesMarker(intent.examples.length) +
      intent.examples.map(buildListParagraph).join('');
    insertions.push({ at: anchor.start, xml: block, name: intent.name });
  }

  insertions.sort((a, b) => b.at - a.at);
  for (const { at, xml: block, name } of insertions) {
    xml = xml.slice(0, at) + block + xml.slice(at);
    console.log(`✔ Added "${name}"`);
  }

  zip.file('word/document.xml', xml);
  const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(DOCX_PATH, outBuffer);

  console.log(`✔ Wrote ${DOCX_PATH}`);
}

main().catch((err) => {
  console.error('✖ Dataset augmentation failed:', err);
  process.exit(1);
});

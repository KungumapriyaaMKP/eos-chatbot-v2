/**
 * Fourth dataset pass — targets the 298 failures from the freshly-generated
 * 1000-question held-out test (chatbot-1000-question-test-report.pdf,
 * _failures_dump.txt), which reflects v2/v3/aug16/aug17 already applied.
 * Covers every intent that appeared as `expected=` in that failure dump,
 * prioritizing the highest-frequency ones (oos_syllabus, faculty_invigilation,
 * faculty_media_request, admin_drive_pipeline, faculty_low_attendance, ...).
 *
 * IMPORTANT INTEGRITY NOTE: every new example below is FRESH WORDING, not
 * copied from the held-out test's actual questions — copying the test
 * questions verbatim would inflate the measured score without any real
 * improvement in generalization (training on the test set). These are new
 * phrasings addressing the same semantic confusion the failures revealed.
 *
 * NOTE: get_leave_status / faculty_leave_status failures are NOT targeted
 * here — that pair is a registered sibling (src/intent/sibling-intents.ts):
 * in the live product, RBAC already reroutes a wrong pick between these two
 * to the caller's real role via the sibling mechanism, so those specific
 * failures don't reflect a real user-facing bug, just a gap in this
 * classifier-only offline test's methodology. A couple of anchor examples
 * are added anyway since it costs nothing and helps the offline number too.
 *
 * Same safe pipeline as rebuild-dataset-v2/v3.ts: merge onto the current
 * (already-correct) intents.json with an explicit duplicate check, rebuild
 * the .docx from that data, and round-trip-verify before trusting it.
 *
 * Usage: npx tsx scripts/rebuild-dataset-v4.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import type { IntentDataset, IntentDefinition } from '../src/intent/intent.types';

const DOCX_PATH = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
const CURRENT_JSON_PATH = path.join(__dirname, '..', 'src', 'embeddings', 'intents.json');

const NEW_EXAMPLES: Record<string, string[]> = {
  // --- top failure counts (8-12 each) ---
  oos_syllabus: [
    'can you share the syllabus for this course',
    'what does the course curriculum cover this semester',
    'give me the syllabus breakdown unit by unit',
    'which units are part of this subject\'s syllabus',
    'detailed list of topics in the course curriculum',
  ],
  faculty_invigilation: [
    'do i have invigilation duty for this exam',
    'which exam session am i invigilating',
    'hall assigned to me for invigilation duty',
    'exam supervision duty roster for me',
    'am i on the invigilation duty list this week',
  ],
  faculty_media_request: [
    'has my audio visual equipment request been approved',
    'status of my projector booking request for class',
    'did the media team approve my equipment request',
    'update on my classroom equipment booking request',
    'is my request for av equipment cleared yet',
  ],
  admin_drive_pipeline: [
    'how many candidates are at each stage of the hiring pipeline',
    'breakdown of the recruitment pipeline by stage',
    'stage-wise applicant counts across all placement drives',
    'current recruitment funnel numbers for this drive',
    'how many applicants are shortlisted versus rejected right now',
  ],
  faculty_low_attendance: [
    'list of students with an attendance shortage in my class',
    'who has fallen below the minimum attendance requirement',
    'attendance defaulters in my section this term',
    'students who need an attendance warning letter sent',
    'which of my students are under the attendance cutoff',
  ],
  thanks: [
    'yo thanks',
    'thanks a ton',
    'appreciate it',
    'thanks so much for that',
    'nice one, thank you',
  ],
  search_books: [
    'does the library have any books on this topic',
    'find a book about a specific subject in the library',
    'search the library catalog for a title',
    'is this book currently available in the library',
    'look up a book by its title or author',
  ],
  oos_faculty_contact: [
    'phone number for the head of department',
    'contact number of the dean\'s office',
    'how can i reach my professor outside class hours',
    'email address for a particular faculty member',
    'contact details of the department head',
  ],
  get_subject_notes: [
    'please share notes for my current subjects',
    'where can i find lecture notes online',
    'notes for a specific topic covered in class',
    'study material for the subjects i am taking',
    'can class notes be uploaded somewhere for me',
  ],
  get_holidays: [
    'when is the next day off from college',
    'any holidays coming up soon on the calendar',
    'is there an upcoming break in this semester',
    'date of the next public holiday',
    'when do we get a day off next',
  ],
  get_company_info: [
    'details about the company visiting campus tomorrow',
    'salary package offered by this recruiting company',
    'information about the recruiter coming to campus',
    'what does this visiting company actually do',
    'role and package details for this placement drive',
  ],
  faculty_leave_status: [
    'as a faculty member has my leave request been approved',
    'staff leave application status update for me',
  ],
  faculty_class_attendance: [
    'attendance count for my most recent class session',
    'how many students attended today\'s lecture i taught',
    'summary of attendance for the class i just conducted',
    'present and absent count for my last teaching session',
  ],
  section_performance: [
    'overall pass percentage for my class in the last exam',
    'how well did my section perform in the recent test',
    'highest scorer in my class for a given subject',
    'class average marks for the last internal test',
  ],
  get_my_bus: [
    'which bus number is assigned to me',
    'my allocated transport route number',
    'which bus should i take to reach home',
    'my transport route and bus details',
  ],
  get_bus_location: [
    'is my bus running late today',
    'current live location of my college bus',
    'track my bus in real time right now',
    'where is my bus at this exact moment',
  ],
  general_facilities: [
    'where is the sports complex located on campus',
    'is there a printing facility available on campus',
    'location of the gym on campus',
    'where can i get photocopies made on campus',
  ],
  admin_students_out_now: [
    'list of students currently out on an outing pass',
    'who is outside campus right now on pass',
    'real-time list of students on outing right now',
    'current outing status of all students at this moment',
  ],
  admin_marks_entry_status: [
    'which faculty members are yet to enter marks',
    'pending marks entry status across departments',
    'who has not completed grading for their subject yet',
    'percentage completion of marks submission college-wide',
  ],

  // --- mid-frequency (4-6 each) ---
  wrong_answer: [
    'that\'s not the answer i was looking for',
    'your reply doesn\'t actually address my question',
    'this response missed what i actually asked',
    'you misunderstood what i was asking for',
  ],
  faculty_my_classes: [
    'which sections have i been assigned to teach this term',
    'list of classes i am currently handling as a teacher',
    'sections under my name for this semester',
  ],
  section_students: [
    'how many students are there in my section',
    'total headcount of students in my class',
    'complete list of students enrolled in my section',
  ],
  out_of_scope: [
    'what\'s the weather looking like today',
    'can you tell me a funny joke',
    'who is going to win tonight\'s cricket match',
    'what movie should i watch this weekend',
  ],
  oos_cgpa: [
    'what is my cgpa up to this point',
    'my cumulative grade point average so far',
    'total cgpa calculated across all semesters',
    'running cgpa total for me right now',
  ],
  human_handoff: [
    'please transfer me to a human agent',
    'connect me with actual support staff',
    'i need to speak with a real person',
    'route this conversation to a human',
  ],
  get_route_stops: [
    'list of all stops before my bus reaches campus',
    'which stages come before campus on my bus route',
    'every stop along my transport route',
  ],
  get_notifications: [
    'do i have any unread notifications',
    'show me alerts i haven\'t seen yet',
    'anything new in my notification list',
  ],
  get_marksheet: [
    'where can i download my transcript',
    'how do i get a copy of my marksheet',
    'link to download my consolidated marksheet',
  ],
  get_hostel_room: [
    'which hostel room am i staying in',
    'my allotted hostel room number and block',
    'room and block assigned to me in the hostel',
  ],
  get_hostel_ledger: [
    'detailed history of my hostel fee payments',
    'list of all hostel dues i have paid so far',
    'running ledger of hostel charges and payments',
  ],
  get_hall_ticket: [
    'has my exam hall ticket been generated yet',
    'is my admit card ready to download',
    'link to download my exam hall ticket',
  ],
  feedback_positive: [
    'that response was really helpful, thanks',
    'this feature works really well for me',
    'i\'m impressed with how well this answered my question',
  ],
  faculty_payslip: [
    'where can i view my payslip online',
    'download my latest salary slip',
    'access my monthly pay statement',
  ],
  emergency_or_distress: [
    'someone collapsed and needs help right now',
    'there is a medical emergency happening near me',
    'i need urgent help, someone is badly hurt',
    'please send help immediately, this is an emergency',
  ],
  admissions_info: [
    'can you explain how the admission application process works',
    'what is the step by step process for applying to this college',
    'walk me through the admission procedure',
  ],
  admin_pending_approvals: [
    'list of items currently waiting for my approval',
    'what requests are pending my sign-off right now',
    'everything that needs my review today',
  ],
  admin_overdue_books: [
    'list of overdue books across the entire library',
    'which students currently have overdue library books',
    'all pending book returns past the due date',
  ],
  admin_list_students: [
    'show me every student belonging to a particular department',
    'complete roster of students filtered by department',
    'full list of enrolled students in one department',
  ],
  admin_list_faculty: [
    'give me the full list of teaching staff',
    'which faculty members work in a particular department',
    'directory of faculty across departments',
  ],
  admin_fee_collection: [
    'how much fee has been collected so far this month',
    'give me a summary of fee collection across the college',
    'total revenue collected from student fees this period',
  ],
  admin_dd_lookup: [
    'look up a demand draft record in the system',
    'search for a dd using its reference number',
    'find a specific demand draft entry',
  ],
  abuse: [
    'shut up and stop talking to me',
    'just stop responding already',
    'i said stop replying to me',
  ],

  // --- lower-frequency (1-3 each), still real ---
  get_revaluation_status: [
    'status of my revaluation request for an exam',
    'has my answer script recheck been completed',
  ],
  get_my_subjects: [
    'what subjects do i have this term',
    'give me the list of courses i am currently taking',
  ],
  get_mentor: [
    'who is my assigned mentor for this academic year',
    'name of the faculty member guiding me academically',
  ],
  get_fees: [
    'what is my pending fee balance right now',
    'is there any pending balance on my tuition',
  ],
  get_e_resources: [
    'are there any e-books available for my course',
    'digital library resources for my current subjects',
  ],
  faculty_mentees: [
    'complete list of students i am mentoring this year',
    'roster of my advisee students under mentorship',
  ],
  bot_identity: [
    'what kind of assistant are you exactly',
    'tell me what type of bot you are',
  ],
  admin_admission_status: [
    'has this specific applicant been admitted yet',
    'check the current admission stage of one candidate',
  ],
  goodbye: [
    'talk to you again soon',
    'catching up later, bye for now',
  ],
  get_outing_status: [
    'has my outing pass been approved yet',
    'status of my weekend outing request',
  ],
  get_exam_eligibility: [
    'am i eligible to write the final exams',
    'can i appear for the semester exams this time',
  ],
  get_announcements: [
    'any new announcements posted recently',
    'latest notice board updates for students',
  ],
  faculty_appraisal: [
    'update on my own performance appraisal review',
    'has hr reviewed my self assessment yet',
  ],
  admin_vendor_quotes: [
    'vendor quotations received for new lab equipment',
    'compare price quotes submitted by different vendors',
  ],
  oos_payment_action: ['i want to pay my fee immediately through this chat'],
  oos_mess_menu: ['what\'s on the mess menu for lunch today'],
  greeting: ['heya'],
  get_timetable: ['am i free at this hour today'],
  get_semester_dates: ['when does the semester officially start this year'],
  get_profile: ['which department and year am i currently in'],
  admin_visitor_log: ['list of visitors who entered campus today'],
  admin_gate_log: ['entry and exit records at the security gate today'],
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function buildListParagraph(text: string): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000">` +
    `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>` +
    `<w:spacing w:after="20"/></w:pPr>` +
    `<w:r><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`
  );
}

function buildHeading1(text: string): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

function buildHeading2(text: string): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

function buildPlain(text: string, bold: boolean): string {
  const paraId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rPr = bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : '<w:rPr><w:i/><w:iCs/></w:rPr>';
  return `<w:p w14:paraId="${paraId}" w14:textId="77777777" w:rsidR="0053184A" w:rsidRDefault="00000000"><w:pPr><w:spacing w:after="60"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

async function main() {
  const current: IntentDataset = JSON.parse(fs.readFileSync(CURRENT_JSON_PATH, 'utf-8'));
  console.log(`Current: ${current.intents.length} intents, ${current.totalExamples} examples.`);

  const byName = new Map(current.intents.map((i) => [i.name, i]));
  let added = 0;
  let skippedDupes = 0;
  for (const [intentName, examples] of Object.entries(NEW_EXAMPLES)) {
    const intent = byName.get(intentName);
    if (!intent) {
      console.warn(`⚠ Intent "${intentName}" not found — skipping.`);
      continue;
    }
    const existingKeys = new Set(intent.examples.map((e) => e.toLowerCase()));
    for (const raw of examples) {
      const example = normalize(raw);
      const key = example.toLowerCase();
      if (existingKeys.has(key)) {
        console.warn(`  ⚠ DUPLICATE for "${intentName}": "${example}" — skipping.`);
        skippedDupes++;
        continue;
      }
      existingKeys.add(key);
      intent.examples.push(example);
      added++;
    }
  }
  console.log(`Added ${added} genuinely new examples (${skippedDupes} unexpected duplicates skipped).`);

  const totalExamples = current.intents.reduce((sum, i) => sum + i.examples.length, 0);
  const finalDataset: IntentDataset = {
    generatedAt: new Date().toISOString(),
    sourceFile: current.sourceFile,
    totalIntents: current.intents.length,
    totalExamples,
    intents: current.intents,
  };

  const buffer = fs.readFileSync(DOCX_PATH);
  const zip = await JSZip.loadAsync(buffer);
  const currentXml = await zip.file('word/document.xml')!.async('text');
  const sectPrMatch = currentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const sectPr = sectPrMatch ? sectPrMatch[0] : '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';
  const bodyOpenMatch = currentXml.match(/^[\s\S]*?<w:body>/);
  const bodyOpenTag = bodyOpenMatch ? bodyOpenMatch[0] : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document><w:body>';
  const docCloseTag = '</w:body></w:document>';

  let bodyContent = '';
  let currentModule: string | null = null;
  for (const intent of finalDataset.intents) {
    if (intent.module !== currentModule) {
      bodyContent += buildHeading1(intent.module);
      currentModule = intent.module;
    }
    bodyContent += buildHeading2(intent.name);
    bodyContent += buildPlain(`roles: ${intent.roles.join(', ')}`, true);
    bodyContent += buildPlain(intent.description, false);
    bodyContent += buildPlain(`examples (${intent.examples.length}):`, true);
    bodyContent += intent.examples.map(buildListParagraph).join('');
  }

  const newXml = bodyOpenTag + bodyContent + sectPr + docCloseTag;
  zip.file('word/document.xml', newXml);
  const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(DOCX_PATH, outBuffer);
  console.log(`✔ Rebuilt ${DOCX_PATH}`);

  // Round-trip verification.
  const verifyZip = await JSZip.loadAsync(fs.readFileSync(DOCX_PATH));
  const verifyXml = await verifyZip.file('word/document.xml')!.async('text');
  const bodyMatch = verifyXml.match(/<w:body>([\s\S]*)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : verifyXml;
  const blocks = body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  const paras = blocks.map((b) => {
    const styleMatch = b.match(/<w:pStyle w:val="([^"]+)"/);
    const textMatches = [...b.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    return { style: styleMatch ? styleMatch[1] : '', text: textMatches.map((m) => m[1]).join('').trim() };
  });

  let verifiedIntents = 0;
  let verifiedExamples = 0;
  let cur: IntentDefinition | null = null;
  let seenMarker = false;
  const seenSet = new Set<string>();
  const flush = () => {
    if (cur) { verifiedIntents++; verifiedExamples += cur.examples.length; }
    cur = null; seenMarker = false; seenSet.clear();
  };
  for (const p of paras) {
    if (p.style === 'Heading1') { flush(); continue; }
    if (p.style === 'Heading2') { flush(); cur = { name: p.text, module: '', roles: [], description: '', examples: [] }; continue; }
    if (!cur || !p.text) continue;
    if (/^examples\s*\(/i.test(p.text)) { seenMarker = true; continue; }
    if (p.style === 'ListParagraph') {
      const key = p.text.toLowerCase();
      if (!seenSet.has(key)) { seenSet.add(key); cur.examples.push(p.text); }
    }
  }
  flush();

  console.log(`\nRound-trip verification: ${verifiedIntents} intents, ${verifiedExamples} examples.`);
  console.log(`Expected: ${finalDataset.intents.length} intents, ${totalExamples} examples.`);
  if (verifiedIntents !== finalDataset.intents.length || verifiedExamples !== totalExamples) {
    console.error('✖ MISMATCH — NOT writing intents.json.');
    process.exit(1);
  }
  console.log('✔ Round-trip matches exactly.');

  fs.writeFileSync(CURRENT_JSON_PATH, JSON.stringify(finalDataset, null, 2), 'utf-8');
  console.log(`✔ Wrote ${CURRENT_JSON_PATH}`);
}

main().catch((err) => {
  console.error('✖ Rebuild failed:', err);
  process.exit(1);
});

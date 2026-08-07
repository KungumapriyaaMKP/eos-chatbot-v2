import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

async function main() {
  const docxPath = path.join(__dirname, '..', '..', 'EOS_Intent_Training_Dataset_English_Only.docx');
  const buffer = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('text');

  const paragraphBlocks = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];

  function findByStyleAndText(style: string, textIncludes: string) {
    return paragraphBlocks.find((b) => {
      const styleMatch = b.match(/<w:pStyle w:val="([^"]+)"/);
      const s = styleMatch ? styleMatch[1] : '';
      return s === style && b.includes(textIncludes);
    });
  }

  console.log('=== Heading1 "Student - exams" ===');
  console.log(findByStyleAndText('Heading1', 'Student - exams'));
  console.log();
  console.log('=== Heading2 "get_marks" ===');
  console.log(findByStyleAndText('Heading2', '>get_marks<'));
  console.log();
  console.log('=== plain paragraph "roles: student, admin" (first occurrence) ===');
  console.log(paragraphBlocks.find((b) => b.includes('roles: student, admin')));
  console.log();
  console.log('=== plain description "Look up marks" ===');
  console.log(paragraphBlocks.find((b) => b.includes('Look up marks')));
  console.log();
  console.log('=== examples marker "examples (55)" ===');
  console.log(paragraphBlocks.find((b) => b.includes('examples (55)')));
}

main();

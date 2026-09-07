import fs from 'node:fs';
const lines = fs.readFileSync('C:/Users/Administrator/.gemini/antigravity-ide/brain/6c489eb4-b5e1-4e57-94b5-2ad281c3875d/.system_generated/logs/transcript_full.jsonl', 'utf8').split('\n');

const lineMap = new Map();

for (let i = 0; i < lines.length; i++) {
  if (!lines[i]) continue;
  try {
    const obj = JSON.parse(lines[i]);
    const str = obj.content || '';
    if (str.includes('File Path: `file:///d:/agent-mikrotik/apps/api/src/routes/chat.ts`') && str.includes('Total Lines: 559')) {
      const textLines = str.split('\n');
      for (const tl of textLines) {
        const clean = tl.replace(/\r$/, "");
        const m = clean.match(/^(\d+): (.*)$/);
        if (m) {
          lineMap.set(parseInt(m[1]), m[2]);
        }
      }
    }
  } catch {}
}

console.log('Unique lines captured from 559-line version:', lineMap.size);
const missing = [];
for (let i = 1; i <= 559; i++) {
  if (!lineMap.has(i)) missing.push(i);
}
console.log('Missing line count:', missing.length);

// Group missing into ranges
const ranges = [];
let start = null;
let prev = null;
for (const n of missing) {
  if (start === null) {
    start = n;
    prev = n;
  } else if (n === prev + 1) {
    prev = n;
  } else {
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
}
if (start !== null) ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
console.log('Missing ranges:', ranges.join(', '));

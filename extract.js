import fs from 'node:fs';
import readline from 'node:readline';

async function main() {
  const fileStream = fs.createReadStream('C:/Users/Administrator/.gemini/antigravity-ide/brain/6c489eb4-b5e1-4e57-94b5-2ad281c3875d/.system_generated/logs/transcript_full.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const lineMap = new Map();
  for await (const line of rl) {
    if (!line.includes('apps/api/src/routes/chat.ts') && !line.includes('apps\\\\api\\\\src\\\\routes\\\\chat.ts')) continue;
    try {
      const obj = JSON.parse(line);
      const str = obj.content || '';
      if (str.includes('File Path:') && str.includes('chat.ts')) {
        const textLines = str.split('\n');
        for (const tl of textLines) {
          const m = tl.match(/^(\d+): (.*)$/);
          if (m) {
            lineMap.set(parseInt(m[1]), m[2]);
          }
        }
      }
    } catch {}
  }
  console.log('Total lines recovered:', lineMap.size);
  const missing = [];
  for (let i = 1; i <= 559; i++) {
    if (!lineMap.has(i)) missing.push(i);
  }
  console.log('Missing line numbers:', missing);
  if (missing.length === 0) {
    const full = [];
    for (let i = 1; i <= 559; i++) {
      full.push(lineMap.get(i));
    }
    fs.writeFileSync('apps/api/src/routes/chat.ts', full.join('\n'));
    console.log('Successfully recovered chat.ts with 559 lines!');
  } else {
    fs.writeFileSync('recovered_partial.json', JSON.stringify({ missing, lines: Object.fromEntries(lineMap) }, null, 2));
  }
}

main();

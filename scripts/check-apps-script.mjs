import fs from 'node:fs';

const target = process.argv[2] || 'spreadsheet/google-sheets-refresh.gs';
const source = fs.readFileSync(target, 'utf8');

new Function(source);
console.log(`Apps Script syntax OK: ${target}`);

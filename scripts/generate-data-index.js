#!/usr/bin/env node
/**
 * Scans data/*.json (excluding index.json) and writes data/index.json
 * with the list of filenames. Run via: npm run data:index
 */
import { readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const dataDir = join(process.cwd(), 'data');
const files = readdirSync(dataDir)
  .filter(f => f.endsWith('.json') && f !== 'index.json')
  .sort();

writeFileSync(join(dataDir, 'index.json'), JSON.stringify(files, null, 2) + '\n');
console.log(`data/index.json updated with ${files.length} files`);

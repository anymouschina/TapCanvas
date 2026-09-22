import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { referenceFiles } from './builtin-skill-files.cjs';

// The skill changes with its instructions/contracts, not with the application version.
const sources = ['skills/director-desk/SKILL.md', ...referenceFiles.map(file => 'skills/director-desk/' + file),
    'src/automation/contract.ts', 'src/automation/tool-summaries.ts', 'src/media/help.ts', 'src/automation/read-sections.ts'];
const contents = await Promise.all(sources.map(file => fs.readFile(file, 'utf8').then(text => text.replace(/\r\n/g, '\n'))));
const version = 'sha256:' + createHash('sha256').update(JSON.stringify(contents)).digest('hex');
const references = Object.fromEntries(referenceFiles.map((file, i) => [file, contents[i + 1]]));
const payload = { name: 'director-desk', version, instructions: references['references/online-workflow.md'], references };
const destination = 'src/automation/builtin-skill.json', text = JSON.stringify(payload, null, 2) + '\n';
if (await fs.readFile(destination, 'utf8').catch(() => '') !== text) await fs.writeFile(destination, text);
console.log('Built versioned embedded director skill.');

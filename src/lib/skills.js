import fs from 'node:fs';
import path from 'node:path';

const MARKER = '<!-- PRAXIS:GENERATED-SKILL -->';

export function skillSource(filename, source) {
  const name = filename.replace(/\.md$/i, '');
  const text = String(source).replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) throw new Error(`Template ${filename} has no frontmatter`);
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`Template ${filename} has invalid frontmatter`);
  const head = text.slice(4, end);
  const body = text.slice(end + 5);
  const named = /^name:/m.test(head) ? head : `name: ${name}\n${head}`;
  return `---\n${named}\n---\n\n${MARKER}\n${body.replace(/^\n*/, '')}`;
}

export function installPraxisSkills(templateDir, skillRoot) {
  const results = [];
  fs.mkdirSync(skillRoot, { recursive: true });
  const names = fs.readdirSync(templateDir)
    .filter(name => name.startsWith('praxis') && name.endsWith('.md'))
    .sort();
  for (const filename of names) {
    const name = filename.slice(0, -3);
    const directory = path.join(skillRoot, name);
    const target = path.join(directory, 'SKILL.md');
    let previous = '';
    try { previous = fs.readFileSync(target, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (previous && !previous.includes(MARKER)) {
      results.push({ name, state: 'preserved', detail: 'An existing non-PRAXIS skill uses this name.' });
      continue;
    }
    const next = skillSource(filename, fs.readFileSync(path.join(templateDir, filename), 'utf8'));
    if (previous === next) {
      results.push({ name, state: 'existing' });
      continue;
    }
    fs.mkdirSync(directory, { recursive: true });
    const temporary = target + '.tmp';
    fs.writeFileSync(temporary, next);
    fs.renameSync(temporary, target);
    results.push({ name, state: previous ? 'refreshed' : 'installed' });
  }
  return results;
}

export function repairPraxisHookFile(file) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { file, state: 'absent', repaired: 0 };
    return { file, state: 'preserved', repaired: 0, detail: 'Invalid JSON or unreadable file.' };
  }
  let repaired = 0;
  const visit = item => {
    if (Array.isArray(item)) {
      for (const value of item) visit(value);
      return;
    }
    if (!item || typeof item !== 'object') return;
    if (typeof item.command === 'string' && !item.command.includes('praxis-memory')) {
      const next = item.command.replace(/(^|[\s"'])praxis (capture|tray --ensure)(?=\s|&|"|'|$)/g,
        '$1npx -y praxis-memory $2');
      if (next !== item.command) {
        item.command = next;
        repaired++;
      }
    }
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  if (!repaired) return { file, state: 'existing', repaired: 0 };
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
  return { file, state: 'repaired', repaired };
}

export function repairPersonalAgentHooks(home) {
  return [
    repairPraxisHookFile(path.join(home, '.claude', 'settings.json')),
    repairPraxisHookFile(path.join(home, '.codex', 'hooks.json')),
  ];
}

/**
 * `katastasi init-skills` — install the agent skills into a repo so Claude Code and GitHub Copilot can
 * drive Katastasi. Writes one Claude skill per action (`.claude/skills/<name>/SKILL.md`) and adds a
 * Katastasi block to `.github/copilot-instructions.md` (idempotent — re-running refreshes the block
 * between markers instead of duplicating). Returns the paths written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { KATASTASI_OVERVIEW, SKILLS } from './content.js';

const COPILOT_START = '<!-- katastasi:start -->';
const COPILOT_END = '<!-- katastasi:end -->';

function skillFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

function copilotBlock(): string {
  return `${COPILOT_START}\n## Katastasi\n\n${KATASTASI_OVERVIEW}\n${COPILOT_END}`;
}

/** Upsert the Katastasi block in a copilot-instructions file (between markers). */
function upsertCopilot(path: string): void {
  const block = copilotBlock();
  let content = '';
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    /* new file */
  }
  if (content.includes(COPILOT_START) && content.includes(COPILOT_END)) {
    content = content.replace(new RegExp(`${COPILOT_START}[\\s\\S]*?${COPILOT_END}`), block);
  } else {
    content = content ? `${content.trimEnd()}\n\n${block}\n` : `# Copilot instructions\n\n${block}\n`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

export interface InstallSkillsResult {
  written: string[]; // repo-relative paths
}

/** Install the skills into `targetDir`. Returns the relative paths written. */
export function installSkills(targetDir: string): InstallSkillsResult {
  const written: string[] = [];
  for (const skill of SKILLS) {
    const dir = join(targetDir, '.claude', 'skills', skill.name);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'SKILL.md');
    writeFileSync(path, skillFile(skill.name, skill.description, skill.body), 'utf8');
    written.push(relative(targetDir, path).replace(/\\/g, '/'));
  }
  const copilot = join(targetDir, '.github', 'copilot-instructions.md');
  const existed = existsSync(copilot);
  upsertCopilot(copilot);
  written.push(`${relative(targetDir, copilot).replace(/\\/g, '/')}${existed ? ' (updated)' : ''}`);
  return { written };
}

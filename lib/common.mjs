import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

export class GrudgeExit extends Error {
  constructor(code = 0) { super(`grudge exit ${code}`); this.exitCode = code; }
}
export const exit = (code = 0) => { throw new GrudgeExit(code); };
export function splitDirArg(argv) {
  const args = []; let dir;
  for (let i=0;i<argv.length;i+=1) {
    const arg=argv[i];
    if (arg === '--dir') { dir = argv[i+1]; i += 1; continue; }
    if (arg.startsWith('--dir=')) { dir = arg.slice(6); continue; }
    args.push(arg);
  }
  return { args, dir };
}
export function defaultLessonsDir(cwd) {
  if (existsSync(join(cwd, 'docs/lessons'))) return resolve(cwd, 'docs/lessons');
  return resolve(cwd, 'lessons');
}
export function resolveLessonsDir(cwd, explicit) {
  return resolve(cwd, explicit ?? process.env.GRUDGE_LESSONS_DIR ?? defaultLessonsDir(cwd));
}

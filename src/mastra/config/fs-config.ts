import fs from 'fs';
import path from 'path';
import { CONFIG_PATH } from './paths';

const CONFIG_DIR = CONFIG_PATH;

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function configPath(filename: string): string {
  return path.join(CONFIG_DIR, filename);
}

export function readJsonConfig<T>(filename: string, fallback: T): T {
  try {
    const content = fs.readFileSync(configPath(filename), 'utf-8');
    return JSON.parse(content);
  } catch { return fallback; }
}

export function writeJsonConfig(filename: string, data: unknown): void {
  ensureDir();
  fs.writeFileSync(configPath(filename), JSON.stringify(data, null, 2));
}

export function readTextConfig(filename: string): string | null {
  try { return fs.readFileSync(configPath(filename), 'utf-8'); }
  catch { return null; }
}

export function writeTextConfig(filename: string, content: string): void {
  ensureDir();
  fs.writeFileSync(configPath(filename), content);
}

export function deleteConfig(filename: string): void {
  try { fs.unlinkSync(configPath(filename)); } catch {}
}

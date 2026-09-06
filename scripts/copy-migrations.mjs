import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/server/migrations', { recursive: true });
cpSync('server/migrations', 'dist/server/migrations', { recursive: true });

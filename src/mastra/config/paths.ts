import path from 'path';

export const DATA_PATH = process.env.DATA_PATH || path.resolve('./data');
export const WORKSPACE_PATH = path.join(DATA_PATH, 'workspace');
export const CONFIG_PATH = path.join(DATA_PATH, 'config');

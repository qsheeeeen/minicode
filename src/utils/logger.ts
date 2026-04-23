import pino from 'pino';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

function getLogFilePath(projectHash: string, sessionName: string): string {
  const logDir = path.join(os.homedir(), '.minicode', 'sessions', projectHash);
  return path.join(logDir, `${sessionName}.log`);
}

export async function createLogger(projectHash: string, sessionName: string): Promise<pino.Logger> {
  const logDir = path.join(os.homedir(), '.minicode', 'sessions', projectHash);
  await fs.mkdir(logDir, { recursive: true });
  
  const logFile = getLogFilePath(projectHash, sessionName);
  const destination = pino.destination({ dest: logFile, sync: true });
  return pino({
    level: 'info',
    base: { session: sessionName, projectHash },
    timestamp: pino.stdTimeFunctions.isoTime,
  }, destination);
}
import pino from 'pino';
import path from 'path';
import os from 'os';

function getLogFilePath(projectHash: string, sessionName: string): string {
  const logDir = path.join(os.homedir(), '.minicode', 'sessions', projectHash);
  // sessionName already includes "session-" prefix (e.g., "session-1776958889783")
  return path.join(logDir, `${sessionName}.log`);
}

export async function createLogger(projectHash: string, sessionName: string): Promise<pino.Logger> {
  const logFile = getLogFilePath(projectHash, sessionName);
  const destination = pino.destination({ dest: logFile, sync: false });
  return pino({
    level: 'info',
    base: { session: sessionName, projectHash },
    timestamp: pino.stdTimeFunctions.isoTime,
  }, destination);
}
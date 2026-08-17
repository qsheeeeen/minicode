import pino from "pino";
import path from "path";
import fs from "fs/promises";

/** Create a pino logger writing into the session's directory (owned by
 *  SessionPersistence — the logger knows no path layout of its own). */
export async function createLogger(
  logDir: string,
  sessionName: string,
): Promise<pino.Logger> {
  await fs.mkdir(logDir, { recursive: true });

  const destination = pino.destination({
    dest: path.join(logDir, `${sessionName}.log`),
    sync: true,
  });
  return pino(
    {
      level: "info",
      base: { session: sessionName },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}

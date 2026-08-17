import path from "path";
import os from "os";

/** Single owner of the app's home directory. */
export const MINICODE_HOME = path.join(os.homedir(), ".minicode");

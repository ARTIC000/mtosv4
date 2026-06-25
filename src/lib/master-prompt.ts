import { readFile } from "node:fs/promises";
import path from "node:path";

export const MASTER_PROMPT_FILE_PATH = path.join(process.cwd(), "MTOS Master Operating System Prompt.md");

export async function getMasterPrompt() {
  return readFile(MASTER_PROMPT_FILE_PATH, "utf8");
}

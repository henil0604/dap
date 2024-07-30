import { execSync } from "child_process";
import Path from "node:path";

type Options = {
  cwd?: string;
  message?: string;
};

export async function fzf(
  command: string,
  options?: Options
): Promise<string | null>;
export async function fzf(
  list: string[],
  options?: Options
): Promise<string | null>;
export async function fzf(
  list: string | string[],
  options?: Options
): Promise<string | null> {
  const fzfCommand = `fzf --border --layout=reverse ${
    options?.message?.trim()
      ? `--header-first --header \"${options.message.replace('"', '\\"')}\"`
      : ""
  } -i`;

  const command =
    typeof list === "string"
      ? `${list} | ${fzfCommand}`
      : `echo "${list.join("\n").replaceAll('"', '\\"')}" | ${fzfCommand}`;

  try {
    const item = execSync(command, {
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf-8",
      cwd: options?.cwd,
    });

    return options?.cwd ? Path.join(options.cwd, item.trim()) : item.trim();
  } catch (error) {
    return null;
  }
}

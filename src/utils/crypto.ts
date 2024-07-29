import { exec, execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import { Readable } from "node:stream";

export function hash(data: string) {
  return crypto.hash("sha256", data);
}
export async function hashFile(path: string) {
  const command = `sha256sum ${path}`;

  try {
    const item = execSync(command, {
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf-8",
    });

    return item.trim().split(" ")[0].trim();
  } catch (error) {
    return null;
  }
}

export async function hashFromStream(stream: Readable) {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });

    stream.on("end", () => {
      const chunkHash = hash.digest("hex");
      resolve(chunkHash);
    });

    stream.on("error", (err) => {
      reject(err);
    });
  });
}

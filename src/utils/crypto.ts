import crypto from "node:crypto";

export function hash(data: string) {
  return crypto.hash("sha256", data);
}

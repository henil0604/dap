import { env } from "@/utils/env";
import bytes from "bytes";

import * as ENV from "./env";
import * as STORE from "./store";

export const CONST = {
  ENV,
  STORE,

  DRIVE_QUEUE_CONCURRENCY: 3,
  DEFAULT_STREAM_CHUNK_SIZE: bytes("10 KB"),
  DEFAULT_MAX_CHUNK_SIZE: bytes("5 MB"),
  DRIVE_UPLOAD_DIRECTORY_NAME: "Courses",
  CONCURRENT_CHUNK_UPLOADING: 3,

  DEFAULT_UPLOAD_PROMPT_PATH: env.get("HOME"),
} as const;

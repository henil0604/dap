import { env } from "@/utils/env";
import bytes from "bytes";

import * as ENV from "./env";
import * as STORE from "./store";

export const CONST = {
  ENV,
  STORE,

  DRIVE_QUEUE_CONCURRENCY: 3,
  DEFAULT_CHUNK_STREAM_SIZE: bytes("256 KB"),
  DEFAULT_MAX_CHUNK_SIZE: bytes("10 MB"),
  DRIVE_UPLOAD_DIRECTORY_NAME: "Courses",
  CONCURRENT_CHUNK_UPLOADING: 2,

  DEFAULT_UPLOAD_PROMPT_PATH: env.get("HOME"),
} as const;

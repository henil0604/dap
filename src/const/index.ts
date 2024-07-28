import * as ENV from "./env";
import * as STORE from "./store";
import bytes from "bytes";

export const CONST = {
  ENV,
  STORE,
  DRIVE_QUEUE_CONCURRENCY: 3,
  DEFAULT_STREAM_CHUNK_SIZE: bytes("1 KB"),
  DEFAULT_MAX_CHUNK_SIZE: bytes("1 MB"),
  DRIVE_UPLOAD_DIRECTORY_NAME: "Courses",
  CONCURRENT_CHUNK_UPLOADING: 3,
} as const;

import { CONST } from "@/const";
import PQueue from "p-queue";

const globalForQueue = globalThis as unknown as { driveQueue: PQueue };

export const driveQueue =
  globalForQueue.driveQueue ||
  new PQueue({ concurrency: CONST.DRIVE_QUEUE_CONCURRENCY });
globalForQueue.driveQueue = driveQueue;

import { google } from "googleapis";
import { getGoogleAuth } from "./getGoogleAuth";
import { driveQueue } from "./queue";
import { CONST } from "@/const";
import { Readable } from "stream";
import progress_stream from "progress-stream";
import { chunkString } from "@/utils/chunkString";
import { ascii } from "@/utils/ascii";
import { throttleAll } from "promise-throttle-all";

export type DriveOptions = {
  refreshToken: string;
};

export type CreateRawFileOptions = {
  data: Uint8Array;
  name: string;
  driveId?: string;
  parentDirectoryId?: string;
  streamChunkSize?: number;
  mimeType?: string;
  onProgress?: (progress: progress_stream.Progress) => Promise<any> | any;
  onStart?: () => Promise<any> | any;
};

export type ChunkEntity = {
  id: string;
  index: number;
  size: number;
  data: Uint8Array;
};

export type CreateFileOptions = {
  data: string;
  id: string;
  parentDirectoryId?: string;
  fileDirectoryName?: string;
  maxChunkSize?: number;
  onProgress?: (
    progress: progress_stream.Progress & {
      chunk: ChunkEntity;
      totalChunks: number;
    }
  ) => Promise<any> | any;
  onChunking?: (data: {
    totalChunks: number;
    size: number;
    chunks: ChunkEntity[];
  }) => Promise<any> | any;
  onChunkEvent?: (data: {
    event: "START_UPLOADING" | "END_UPLOADING" | "ERROR_UPLOADING";
    chunkIndex: number;
    data?: {
      [key: string]: any;
    };
  }) => Promise<any> | any;
};

export type CreateDirectoryOptions = {
  name: string;
  id?: string;
  parentDirectoryId?: string;
};

export class Drive {
  refreshToken: string;
  auth: ReturnType<typeof getGoogleAuth>;
  drive: ReturnType<(typeof google)["drive"]>;

  public constructor(options: DriveOptions) {
    this.refreshToken = options.refreshToken;
    this.auth = getGoogleAuth(options.refreshToken);
    this.drive = google.drive({
      version: "v3",
      auth: this.auth,
    });
  }

  public async getRootDirectoryId() {
    const list = (await driveQueue.add(() =>
      this.drive!.files.list({
        q: `'root' in parents and name='${CONST.DRIVE_UPLOAD_DIRECTORY_NAME}' and trashed=false`,
      })
    ))!;

    if (!list.data.files || list.data.files?.length === 0) {
      return await this.createDirectory({
        name: CONST.DRIVE_UPLOAD_DIRECTORY_NAME,
      });
    }

    if (list.data.files.length > 1) {
      for (const entity of [...list.data.files].slice(1)) {
        if (!entity.id) continue;
        await this.drive!.files.delete({
          fileId: entity.id,
        });
      }
    }

    return list.data.files[0].id!;
  }

  public async createDirectory(options: CreateDirectoryOptions) {
    const createResponse = (await driveQueue.add(() =>
      this.drive!.files.create({
        requestBody: {
          id: options.id,
          mimeType: "application/vnd.google-apps.folder",
          name: options.name,
          parents: options.parentDirectoryId ? [options.parentDirectoryId] : [],
        },
      })
    ))!;

    return createResponse.data.id!;
  }

  public async createRawFile(options: CreateRawFileOptions) {
    options.mimeType = options.mimeType || "application/octet-stream";
    options.streamChunkSize =
      options.streamChunkSize || CONST.DEFAULT_STREAM_CHUNK_SIZE;

    const readable = new Readable();
    let offset = 0;

    while (true) {
      if (offset >= options.data.length) {
        readable.push(null);
        break;
      }

      const chunk = options.data.slice(
        offset,
        offset + options.streamChunkSize
      );
      offset += options.streamChunkSize;
      readable.push(chunk);
    }

    let progressStream = progress_stream({
      length: options.data.length,
      time: 100,
    });

    progressStream.on("progress", async function (progress) {
      await options.onProgress?.(progress);
    });

    const readStream = readable.pipe(progressStream);

    const uploadResponse = (await driveQueue.add(async () => {
      await options.onStart?.();
      return this.drive!.files.create({
        requestBody: {
          id: options.driveId,
          name: options.name,
          mimeType: options.mimeType,
          parents: options.parentDirectoryId ? [options.parentDirectoryId] : [],
        },
        media: {
          body: readStream,
          mimeType: options.mimeType,
        },
      });
    }))!;

    if (uploadResponse.status !== 200) {
      return null;
    }

    return {
      driveId: uploadResponse.data.id!,
      kind: uploadResponse.data.kind!,
      name: uploadResponse.data.name!,
    };
  }

  public async createFile(options: CreateFileOptions) {
    const rootDirectoryId =
      options.parentDirectoryId ?? (await this.getRootDirectoryId());

    const parentDirectoryId = await this.createDirectory({
      name: options.fileDirectoryName || options.id,
      id: options.id,
      parentDirectoryId: rootDirectoryId,
    });

    options.maxChunkSize = options.maxChunkSize || CONST.DEFAULT_MAX_CHUNK_SIZE;

    const rawChunks = chunkString(options.data, options.maxChunkSize);

    const chunks = await Promise.all(
      rawChunks.map(async (chunk, index) => {
        const id = (await this.generateId())!;

        return {
          index,
          data: ascii.encode(chunk),
          size: chunk.length,
          id,
        };
      })
    );

    await options.onChunking?.({
      totalChunks: chunks.length,
      size: options.data.length,
      chunks: chunks,
    });

    const promisePool = chunks.map((chunk) => {
      return async () => {
        const chunkUploadResponse = await this.createRawFile({
          name: chunk.id,
          data: chunk.data,
          driveId: chunk.id,
          parentDirectoryId: parentDirectoryId,
          onProgress: (progress) => {
            options.onProgress?.({
              ...progress,
              chunk,
              totalChunks: chunks.length,
            });
          },
          onStart: async () => {
            await options.onChunkEvent?.({
              chunkIndex: chunk.index,
              event: "START_UPLOADING",
            });
          },
        });

        if (
          !chunkUploadResponse ||
          "driveId" in chunkUploadResponse === false
        ) {
          await options.onChunkEvent?.({
            chunkIndex: chunk.index,
            event: "ERROR_UPLOADING",
          });

          return {
            error: true,
            info: chunk,
          };
        }

        await options.onChunkEvent?.({
          chunkIndex: chunk.index,
          event: "END_UPLOADING",
        });

        return {
          error: false,
          driveId: chunkUploadResponse.driveId || null,
          info: chunk,
        };
      };
    });

    const uploadResponse = await throttleAll(
      CONST.CONCURRENT_CHUNK_UPLOADING,
      promisePool
    );

    return {
      id: options.id,
      chunks: uploadResponse.map((chunk) => ({
        error: chunk.error,
        driveId: chunk.driveId,
        index: chunk.info.index,
        size: chunk.info.size,
        data: chunk.info.data,
        id: chunk.info.id,
      })),
    };
  }

  public async generateId(): Promise<string | null> {
    const ids = await driveQueue.add(() =>
      this.drive!.files.generateIds({
        count: 1,
      })
    );

    if (ids === undefined || !ids.data.ids) {
      return null;
    }

    return ids.data.ids[0];
  }
}

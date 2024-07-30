import { prisma } from "./db";
import { Drive } from "./drive";
import Path from "node:path";
import { Directory } from "@prisma/client";

export type CreateFileOptions = {
  id: string;
  name: string;
  size: number;
  parentDirectoryId?: string;
  chunks: Omit<CreateChunkOptions, "fileId">[];
};

export type CreateChunkOptions = {
  id: string;
  index: number;
  size: number;
  fileId: string;
};

export class User {
  drive: Drive;
  username: string;

  constructor(username: string, drive: Drive) {
    this.drive = drive;
    this.username = username;
  }

  public async upsert() {
    return prisma.user.upsert({
      create: {
        username: this.username,
      },
      where: { username: this.username },
      update: {
        username: this.username,
      },
    });
  }

  public async createDirectory(name: string, parentDirectoryId?: string) {
    return prisma.directory.create({
      data: {
        name,
        parentDirectory: parentDirectoryId
          ? {
              connect: {
                id: parentDirectoryId,
              },
            }
          : undefined,
        owner: {
          connect: {
            username: this.username,
          },
        },
      },
    });
  }

  private getAbsolutePath(
    directory: Directory,
    directoriesMap: { [key: string]: Directory }
  ): string {
    if (!directory.parentDirectoryId) {
      return `/${directory.name}`;
    }

    const parentDirectory = directoriesMap[directory.parentDirectoryId];
    if (!parentDirectory) {
      return `/${directory.name}`;
    }

    return Path.join(
      this.getAbsolutePath(parentDirectory, directoriesMap),
      directory.name
    );
  }

  public async getDirectoriesWithAbsolutePath(
    parentDirectoryId?: string
  ): Promise<{ id: string; absolutePath: string; name: string }[]> {
    const directories = await this.getDirectories(parentDirectoryId);

    // Create a map for easy lookup of directories by their ID
    const directoriesMap = directories.reduce((map, dir) => {
      map[dir.id] = dir;
      return map;
    }, {} as { [key: string]: Directory });

    // Create a map of directory paths to their IDs
    const directoryPaths = directories.map((d) => {
      const absolutePath = this.getAbsolutePath(d, directoriesMap);
      return { id: d.id, absolutePath, name: d.name };
    });

    return directoryPaths;
  }

  public async getDirectories(parentDirectoryId?: string) {
    const directories = await prisma.directory.findMany({
      where: {
        parentDirectoryId: parentDirectoryId || null,
        ownerUsername: this.username,
      },
      include: {
        subDirectories: true,
        parentDirectory: true,
      },
    });

    let allDirectories = [...directories];

    for (const directory of directories) {
      const subDirectories = await this.getDirectories(directory.id);
      allDirectories = allDirectories.concat(subDirectories);
    }

    return allDirectories;
  }

  public async directoryExists(
    name: string,
    parentDirectoryId?: string
  ): Promise<boolean> {
    const directory = await prisma.directory.findFirst({
      where: {
        name,
        parentDirectoryId: parentDirectoryId || null,
        ownerUsername: this.username,
      },
    });
    return !!directory;
  }

  public async createFile(options: CreateFileOptions) {
    const file = await prisma.file.create({
      data: {
        id: options.id,
        name: options.name,
        size: options.size,
        parentDirectory: options.parentDirectoryId
          ? {
              connect: {
                id: options.parentDirectoryId,
              },
            }
          : undefined,
        owner: {
          connect: {
            username: this.username,
          },
        },
      },
    });

    for (const chunk of options.chunks) {
      await this.createChunk({
        ...chunk,
        fileId: options.id,
      });
    }

    return this.getFile(file.id);
  }

  public async createChunk(options: CreateChunkOptions) {
    return prisma.chunk.create({
      data: {
        id: options.id,
        index: options.index,
        size: options.size,
        file: {
          connect: {
            id: options.fileId,
          },
        },
      },
    });
  }

  public async getFile(id: string) {
    return prisma.file.findUnique({
      where: {
        id,
        owner: {
          username: this.username,
        },
      },
      include: {
        chunks: {
          orderBy: {
            index: "asc",
          },
        },
        parentDirectory: true,
      },
    });
  }

  public async getAllFiles() {
    return prisma.file.findMany({
      where: {
        owner: {
          username: this.username,
        },
      },
      include: {
        chunks: true,
        parentDirectory: true,
      },
    });
  }

  public async getAllFilesWithAbsolutePath() {
    const files = await this.getAllFiles();

    const directories = await this.getDirectoriesWithAbsolutePath();

    const filesWithAbsolutePath = files.map((file) => {
      const directory = directories.find(
        (dir) => dir.id === file.parentDirectoryId
      );

      const absolutePath = directory
        ? Path.join(directory.absolutePath, file.name)
        : `/${file.name}`;

      return {
        ...file,
        absolutePath,
      };
    });

    return filesWithAbsolutePath;
  }
}

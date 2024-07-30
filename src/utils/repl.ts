import { execSync } from "node:child_process";
import { CONST } from "@/const";
import { isCancel, select, log, spinner, confirm, text } from "@clack/prompts";
import fs from "node:fs";
import { User } from "@/utils/user";
import chalk from "chalk";
import { fzf } from "./fzf";
import { store } from "./store";
import { hash, hashFile } from "./crypto";
import Path from "node:path";
import { ascii } from "./ascii";
import cliProgress from "cli-progress";
import bytes from "bytes";

enum ActionChoice {
  UPLOAD = "UPLOAD",
  DOWNLOAD = "DOWNLOAD",
  CREATE_DIRECTORY = "CREATE_DIRECTORY",
}

async function askActionChoice(): Promise<ActionChoice | null> {
  const choice = (await select<
    { value: ActionChoice; label: string }[],
    ActionChoice
  >({
    message: "What would you like to do?",
    options: [
      { value: ActionChoice.UPLOAD, label: "Upload" },
      { value: ActionChoice.DOWNLOAD, label: "Download" },
      { value: ActionChoice.CREATE_DIRECTORY, label: "Create Directory" },
    ],
  })) as ActionChoice;

  if (isCancel(choice)) {
    return null;
  }

  return choice;
}

async function askForFile(path: string): Promise<string | null> {
  const command = `find . $(if [ -f .gitignore ]; then cat .gitignore | grep -v '^#' | grep -v '^$' | sed 's|^|./|' | sed 's|$|/*|' | xargs -I {} echo "-ipath \\"{}\\" -prune -o"; fi) -type f -print`;

  return fzf(command, {
    cwd: path,
    message: "Select local file",
  });
}

async function askForDirectory(path: string): Promise<string | null> {
  const command = `find . $(if [ -f .gitignore ]; then cat .gitignore | grep -v '^#' | grep -v '^$' | sed 's|^|./|' | sed 's|$|/*|' | xargs -I {} echo "-ipath \\"{}\\" -prune -o"; fi) -type d -print`;

  return fzf(command, {
    cwd: path,
    message: "Select local directory",
  });
}

async function askForDriveDirectory(
  user: User
): Promise<{ id: string; absolutePath: string }> {
  const directories = await user.getDirectoriesWithAbsolutePath();

  if (directories.length === 0) {
    return {
      id: "",
      absolutePath: "/",
    };
  }

  const directoryPaths = directories.map((d) => ({
    id: d.id,
    path: d.absolutePath,
    name: d.name,
  }));

  directoryPaths.unshift({ id: "", path: "/", name: "Root" });

  const selectedPath = await fzf(
    directoryPaths.map((d) => d.path),
    {
      message: "Select remote directory",
    }
  );

  if (!selectedPath) {
    return { id: "", absolutePath: "/" };
  }

  const selectedDirectory = directoryPaths.find((d) => d.path === selectedPath);

  if (!selectedDirectory) {
    return { id: "", absolutePath: "/" };
  }

  return { id: selectedDirectory.id, absolutePath: selectedDirectory.path };
}

async function askForDriveFile(user: User) {
  const allFiles = await user.getAllFilesWithAbsolutePath();

  const filesPaths = allFiles.map((f) => ({
    id: f.id,
    path: f.absolutePath,
    name: f.name,
  }));

  const selectedPath = await fzf(
    filesPaths.map((f) => f.path),
    {
      message: "Select remote file",
    }
  );

  if (!selectedPath) {
    return null;
  }

  const selectedFile = filesPaths.find((f) => f.path === selectedPath);

  if (!selectedFile) {
    return null;
  }

  return selectedFile;
}

export function clearScreen(user: User) {
  console.clear();
  log.info(`Logged in as ${chalk.cyanBright(user.username)}`);
}

async function uploadProcess(user: User) {
  const filePath = await askForFile(CONST.DEFAULT_UPLOAD_PROMPT_PATH);

  if (!filePath) {
    return;
  }

  log.info(`Selected file ${chalk.cyanBright(filePath)}`);

  const uploadDirectory = await askForDriveDirectory(user);

  log.info(
    `Selected directory ${chalk.yellowBright(uploadDirectory.absolutePath)}`
  );

  const shouldUpload = await confirm({
    message: "Continue to upload?",
    initialValue: true,
  });

  if (isCancel(shouldUpload) || !shouldUpload) {
    log.warn("Upload cancelled");
    await askForMessageAcknowledgement();
    return;
  }

  console.clear();

  const sp = spinner();

  sp.start("initializing upload");

  sp.message("extracting data from file");

  sp.stop();
  const fileStat = await fs.promises.stat(filePath);
  const id = await user.drive.generateId();

  log.info(`File: ${filePath}`);
  log.info(`PID: ${process.pid}`);
  log.info(`ID: ${id}`);
  log.info(`Size: ${bytes.format(fileStat.size)}`);
  log.info("");

  if (!id) {
    log.error("Failed to generate ID");
    return;
  }

  const progressBar = new cliProgress.SingleBar(
    {
      clearOnComplete: false,
      hideCursor: false,
      format:
        "{bar} | {value}% | {uploadedSize}/{totalSize} | {uploadedChunks}/{totalChunks} | SPD: {speed}/s ",
    },
    cliProgress.Presets.rect
  );

  let totalBytesUploaded = 0;
  let totalBytesUploadedDelta = 0;
  let totalChunksUploaded = 0;

  let speedCheckerInterval = setInterval(() => {
    progressBar.update(Math.round(progressBar.getProgress() * 100), {
      speed: bytes.format(totalBytesUploadedDelta),
    });
    totalBytesUploadedDelta = 0;
  }, 1000);

  sp.start("chunking file");

  const startTime = Date.now();

  const uploadResponse = await user.drive.createFile({
    filePath: filePath,
    id,
    onChunkingProgress: (data) => {
      sp.message(`chunking file: ${data.index}/${data.totalChunks}`);
    },
    onChunking: (data) => {
      sp.stop();
      progressBar.start(100, 0, {
        uploadedSize: bytes.format(0),
        totalSize: bytes.format(fileStat.size),
        uploadedChunks: 0,
        totalChunks: data.totalChunks,
      });
    },
    onChunkEvent: (data) => {
      if (data.event === "END_UPLOADING") {
        totalChunksUploaded++;
        progressBar.update(Math.round(progressBar.getProgress() * 100), {
          speed: bytes.format(0),
          uploadedChunks: totalChunksUploaded,
        });
      }
    },
    onProgress: (data) => {
      totalBytesUploaded += data.delta;
      totalBytesUploadedDelta += data.delta;

      progressBar.update(
        Math.round((totalBytesUploaded / fileStat.size) * 100),
        {
          uploadedSize: bytes.format(totalBytesUploaded),
        }
      );
    },
  });
  const endTime = Date.now();

  clearInterval(speedCheckerInterval);
  progressBar.update(100, {
    uploadedSize: bytes.format(fileStat.size),
  });
  progressBar.stop();

  await user.createFile({
    id: id,
    name: Path.basename(filePath),
    parentDirectoryId: uploadDirectory.id || undefined,
    size: fileStat.size,
    chunks: uploadResponse.chunks.map((chunk) => ({
      id: chunk.id,
      index: chunk.index,
      size: chunk.size,
    })),
  });

  log.success("File uploaded");
  log.info(`Time taken: ${((endTime - startTime) / 1000).toFixed(1)}s`);
  await askForMessageAcknowledgement();
}

async function downloadProcess(user: User) {
  const file = await askForDriveFile(user);

  if (!file) {
    return;
  }

  log.info(`Selected file ${chalk.cyanBright(file.path)}`);

  const directory = await askForDirectory(CONST.DEFAULT_DOWNLOAD_PROMPT_PATH);

  if (!directory) {
    return;
  }

  log.info(`Selected directory ${chalk.yellowBright(directory)}`);

  const sp = spinner();

  sp.start("Fetching file info");

  const fileInfo = await user.getFile(file.id);

  if (!fileInfo) {
    await askForMessageAcknowledgement("File not found");
    return;
  }

  sp.stop();

  log.info(`Size: ${bytes.format(Number.parseInt(fileInfo.size.toString()))}`);

  const shouldDownload = await confirm({
    message: "Continue to download?",
    initialValue: true,
  });

  if (isCancel(shouldDownload) || !shouldDownload) {
    log.warn("Download Canceled");
    await askForMessageAcknowledgement();
    return;
  }

  clearScreen(user);

  const totalFileSize = Number.parseInt(fileInfo.size.toString());

  log.info(`ID: ${fileInfo.id}`);
  log.info(`Name: ${chalk.cyanBright(file.name)}`);
  log.info(`Remote Path: ${chalk.greenBright(file.path)}`);
  log.info(`Save Path: ${chalk.yellowBright(directory)}`);
  log.info(`Total Chunks: ${fileInfo.chunks.length}`);
  log.info(`Size: ${bytes.format(totalFileSize)}`);
  log.info(`PID: ${process.pid}`);

  let totalBytesDownloaded = 0;
  let totalChunksDownloaded = 0;
  let totalBytesUploadedDelta = 0;

  const fullFilePath = Path.join(directory, file.name);
  const destinationFileStream = fs.createWriteStream(fullFilePath);

  const progressBar = new cliProgress.SingleBar(
    {
      clearOnComplete: false,
      hideCursor: false,
      format:
        "{bar} | {value}% | {downloadedChunks}/{totalChunks} | {downloadedSize}/{totalSize} | {speed}/s",
    },
    cliProgress.Presets.rect
  );

  progressBar.start(100, 0, {
    downloadedChunks: 0,
    totalChunks: fileInfo.chunks.length,
    speed: bytes.format(0),
    totalSize: bytes.format(totalFileSize),
    downloadedSize: bytes.format(0),
  });

  let speedCheckerInterval = setInterval(() => {
    progressBar.update(Math.round(progressBar.getProgress() * 100), {
      speed: bytes.format(totalBytesUploadedDelta),
    });
    totalBytesUploadedDelta = 0;
  }, 1000);

  const startTime = Date.now();
  const downloadResponse = await user.drive.downloadFile({
    id: fileInfo.id,
    stream: destinationFileStream,
    size: parseInt(fileInfo.size.toString()),
    chunks: fileInfo.chunks.map((chunk) => {
      return {
        id: chunk.id,
        size: parseInt(chunk.size.toString()),
      };
    }),
    onProgress: (progress) => {
      totalBytesDownloaded += progress.delta;
      totalBytesUploadedDelta += progress.delta;

      progressBar.update(
        Math.round((totalBytesDownloaded / totalFileSize) * 100),
        {
          downloadedSize: bytes.format(totalBytesDownloaded),
        }
      );
    },
    onChunkEvent: (data) => {
      if (data.event === "END_DOWNLOADING") {
        totalChunksDownloaded++;
        progressBar.update(progressBar.getProgress() * 100, {
          downloadedChunks: totalChunksDownloaded,
        });
      }
    },
  });
  const endTime = Date.now();

  clearInterval(speedCheckerInterval);
  progressBar.update(100, {
    downloadedSize: bytes.format(totalFileSize),
  });
  progressBar.stop();

  log.success("File downloaded");
  log.info(`Time taken: ${((endTime - startTime) / 1000).toFixed(1)}s`);
  await askForMessageAcknowledgement();
}

async function askForMessageAcknowledgement(message?: string) {
  return text({
    message: message || "Press enter to continue...",
    placeholder: "Press enter",
  });
}

export async function createDirectoryProcess(user: User) {
  const parentDirectory = await askForDriveDirectory(user);

  let directoryName = "";
  let isValidDirectoryName = false;
  const validDirectoryRegex = /^[a-zA-Z0-9_\-]+$/;

  while (!isValidDirectoryName) {
    const name = await text({
      message: "Enter the name of the directory",
      validate: (name) => {
        if (!name || !name.trim()) {
          return "Name is required";
        }
        if (!validDirectoryRegex.test(name)) {
          return "Invalid directory name. Directory name can only contain alphanumeric characters, hyphens and underscores";
        }
      },
    });

    if (isCancel(name) || !name || !name.trim()) {
      return;
    }

    const directoryExists = await user.directoryExists(
      name,
      parentDirectory.id
    );
    if (directoryExists) {
      log.error(
        `directory with name ${chalk.cyanBright(
          name
        )} already exists in ${chalk.yellowBright(
          parentDirectory.absolutePath
        )}`
      );

      continue;
    }

    isValidDirectoryName = true;
    directoryName = name;
  }

  const shouldProceed = await confirm({
    message: `create directory ${chalk.cyanBright(
      directoryName
    )} in ${chalk.yellowBright(parentDirectory.absolutePath)}?`,
  });

  if (!shouldProceed) {
    log.warn("directory creation cancelled");
    await askForMessageAcknowledgement();
    return;
  }

  const sp = spinner();

  sp.start("creating directory");

  await user.createDirectory(directoryName, parentDirectory?.id);

  sp.stop();

  log.success(`directory ${chalk.cyanBright(directoryName)} created`);
  await askForMessageAcknowledgement();
}

export const repl = {
  askActionChoice,
  uploadProcess,
  ActionChoice,
  clearScreen,
  createDirectoryProcess,
  downloadProcess,
};

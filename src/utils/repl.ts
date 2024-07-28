import { execSync } from "node:child_process";
import { CONST } from "@/const";
import { isCancel, select, log, spinner, confirm, text } from "@clack/prompts";
import fs from "node:fs";
import { User } from "@/utils/user";
import chalk from "chalk";
import { fzf } from "./fzf";
import { store } from "./store";
import { hash } from "./crypto";
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

  const selectedPath = await fzf(directoryPaths.map((d) => d.path));

  if (!selectedPath) {
    return { id: "", absolutePath: "/" };
  }

  const selectedDirectory = directoryPaths.find((d) => d.path === selectedPath);

  if (!selectedDirectory) {
    return { id: "", absolutePath: "/" };
  }

  return { id: selectedDirectory.id, absolutePath: selectedDirectory.path };
}

export function clearScreen(user: User) {
  console.clear();
  log.info(`Logged in as ${chalk.cyanBright(user.username)}`);
}

async function uploadProcess(user: User) {
  const filePath = await askForFile(CONST.DEFAULT_UPLOAD_PROMPT_PATH);

  if (!filePath) {
    log.error("No file selected");
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
  const fileData = await fs.promises.readFile(filePath, "utf8");
  const fileHash = hash(fileData);

  log.info(`File: ${filePath}`);
  log.info(`Hash: ${fileHash}`);
  log.info(`PID: ${process.pid}`);
  log.info("");
  const id = await user.drive.generateId();

  if (!id) {
    log.error("Failed to generate ID");
    return;
  }

  const progressBar = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: false,
      format:
        "{index} | {hash} | {bar} | {value}% | {uploadedSize}/{totalSize} | SPD: {speed}/s",
    },
    cliProgress.Presets.rect
  );

  const chunkProgressBars = new Map<number, cliProgress.SingleBar>();

  const mainProgress = progressBar.create(
    100,
    0,
    {
      hash: fileHash.slice(0, 6),
      totalSize: bytes.format(fileData.length),
      uploadedSize: bytes.format(0),
      speed: bytes.format(0),
    },
    {
      format: "{hash} | {bar} | {value}% | {uploadedSize}/{totalSize}",
    }
  );

  mainProgress.update(0);

  let totalBytesUploaded = 0;

  const uploadResponse = await user.drive.createFile({
    data: fileData,
    id,
    onChunking: (data) => {
      for (const chunk of data.chunks) {
        const bar = progressBar.create(100, 0, {
          index: chunk.index,
          hash: hash(ascii.decode(chunk.data)).slice(0, 6),
          totalSize: bytes.format(chunk.size),
          uploadedSize: bytes.format(0),
          speed: bytes.format(0),
        });

        bar.update(0);

        chunkProgressBars.set(chunk.index, bar);
      }
    },
    onChunkEvent: (data) => {
      const bar = chunkProgressBars.get(data.chunkIndex);

      if (!bar) {
        return;
      }

      if (data.event === "END_UPLOADING") {
        bar.update(100, {
          speed: bytes.format(0),
        });
        bar.stop();
        chunkProgressBars.delete(data.chunkIndex);
      }
    },
    onProgress: (data) => {
      const bar = chunkProgressBars.get(data.chunk.index);

      bar?.update(Math.round(data.percentage), {
        uploadedSize: bytes.format(data.transferred),
        totalSize: bytes.format(data.chunk.size),
        speed: bytes.format(data.speed),
      });

      totalBytesUploaded += data.delta;

      mainProgress.update(
        Math.round((totalBytesUploaded / fileData.length) * 100),
        {
          uploadedSize: bytes.format(totalBytesUploaded),
        }
      );
    },
  });

  chunkProgressBars.forEach((bar) => bar.stop());
  mainProgress.stop();
  progressBar.stop();

  await user.createFile({
    id: id,
    hash: fileHash,
    name: Path.basename(filePath),
    parentDirectoryId: uploadDirectory.id || undefined,
    size: fileData.length,
    chunks: uploadResponse.chunks.map((chunk) => ({
      id: chunk.id,
      hash: hash(ascii.decode(chunk.data)),
      index: chunk.index,
      size: chunk.size,
    })),
  });

  log.success("File uploaded");
  await askForMessageAcknowledgement();
}

async function askForMessageAcknowledgement() {
  return text({ message: "Press any key to continue..." });
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
};

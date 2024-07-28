import AuthApp, { serve as ServeAuthApp } from "@/auth-server";
import { logger } from "@/utils/logger";
import { store } from "./utils/store";
import { AddressInfo } from "net";
import open from "open";
import { waitForRefreshToken } from "@/utils/waitForRefreshToken";
import { confirm, isCancel, log, spinner, text } from "@clack/prompts";
import { CONST } from "@/const";
import { Drive } from "@/utils/drive";
import { repl } from "@/utils/repl";
import { User } from "@/utils/user";
import bytes from "bytes";

async function AuthProcess() {
  if (store.getItem(CONST.STORE.REFRESH_TOKEN)) {
    const drive = new Drive({
      refreshToken: store.getItem(CONST.STORE.REFRESH_TOKEN)!,
    });

    const username = await text({
      message: "Username",
      initialValue: "dap",
    });

    if (isCancel(username) || !username.trim()) {
      logger.error("Username is required");
      process.exit();
    }

    const user = new User(username, drive);

    const sp = spinner();

    sp.start("logging in...");
    await user.upsert();
    sp.stop();

    return {
      drive,
      user,
    };
  }

  const shouldProceed = await confirm({
    message: "continue to google authentication?",
    initialValue: true,
  });

  if (!shouldProceed) {
    logger.warn("exiting...");
    process.exit(1);
  }

  // Start auth server
  logger.info("attempting to start auth server");

  const {
    server: authServer,
    port: authServerPort,
    close: closeAuthServer,
  } = await ServeAuthApp();

  logger.success(`auth server listening on`, authServerPort);

  const address = authServer.address() as AddressInfo;

  await open(`http://${address.address}:${address.port}/auth`);

  await waitForRefreshToken();

  await closeAuthServer();

  return AuthProcess();
}

logger.info("checking authentication");
const { drive, user } = await AuthProcess();
logger.success("auth process complete");

// clear screen
console.clear();

let exitRepl = false;

while (!exitRepl) {
  repl.clearScreen(user);
  const choice = await repl.askActionChoice();

  if (!choice) {
    exitRepl = true;
    continue;
  }

  switch (choice) {
    case repl.ActionChoice.UPLOAD:
      await repl.uploadProcess(user);
      break;
    case repl.ActionChoice.CREATE_DIRECTORY:
      await repl.createDirectoryProcess(user);
      break;
    case repl.ActionChoice.DOWNLOAD:
      break;
  }
}

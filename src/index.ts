import AuthApp, { serve as ServeAuthApp } from "@/auth-server";
import { logger } from "@/utils/logger";
import { store } from "./utils/store";
import { AddressInfo } from "net";
import open from "open";
import { waitForRefreshToken } from "@/utils/waitForRefreshToken";
import { confirm } from "@clack/prompts";
import { CONST } from "@/const";
import { Drive } from "@/utils/drive";
import bytes from "bytes";
import { ascii } from "@/utils/ascii";

async function AuthProcess() {
  if (store.getItem(CONST.STORE.REFRESH_TOKEN)) {
    return true;
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

  return true;
}

logger.info("checking authentication");
await AuthProcess();
logger.success("auth process complete");

const drive = new Drive({
  refreshToken: store.getItem(CONST.STORE.REFRESH_TOKEN)!,
});

import chalk from "chalk";
import { CONST } from "@/const";
import { env } from "./env";

/**
 * Log prefix symbols.
 */
const PREFIX = Object.freeze({
  info: "i",
  warn: "!",
  error: "x",
  success: "+",
});

/**
 * Constructs a colored prefix for log messages.
 *
 * @param prefix - The prefix symbol.
 * @param color - The chalk color function.
 * @returns The colored prefix string.
 */
function constructPrefix(
  prefix: string,
  color: (text: string) => string
): string {
  return color(`[${prefix}]`);
}

/**
 * Checks if logging is enabled based on the environment variable.
 *
 * @returns True if logging is enabled, false otherwise.
 */
function canLog(): boolean {
  return env.getBool(CONST.ENV.ENABLE_LOGGER);
}

/**
 * Logs a message to the console with a colored prefix and timestamp.
 *
 * @param prefix - The log prefix symbol.
 * @param color - The chalk color function.
 * @param data - The data to log.
 */
function log(
  prefix: string,
  color: (text: string) => string,
  ...data: any[]
): void {
  if (!canLog()) return;

  const prefixString = constructPrefix(prefix, color);
  const date = chalk.gray(new Date().toISOString());

  console.log(`${prefixString} ${date}`, ...data);
}

/**
 * Logs an informational message.
 *
 * @param data - The data to log.
 */
function info(...data: any[]): void {
  log(PREFIX.info, chalk.cyanBright, ...data);
}

/**
 * Logs a warning message.
 *
 * @param data - The data to log.
 */
function warn(...data: any[]): void {
  log(PREFIX.warn, chalk.yellowBright, ...data);
}

/**
 * Logs an error message.
 *
 * @param data - The data to log.
 */
function error(...data: any[]): void {
  log(PREFIX.error, chalk.redBright, ...data);
}

/**
 * Logs a success message.
 *
 * @param data - The data to log.
 */
function success(...data: any[]): void {
  log(PREFIX.success, chalk.greenBright, ...data);
}

/**
 * Logger object with methods to log different levels of messages.
 */
export const logger = {
  log,
  info,
  warn,
  error,
  success,
};

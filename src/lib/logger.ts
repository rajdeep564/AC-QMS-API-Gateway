import pino, { type Logger } from "pino";
import { config } from "../config/env";

export const logger = pino({
  level: config.nodeEnv === "production" ? "info" : "debug",
  transport:
    config.nodeEnv === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
            singleLine: true,
          },
        }
      : undefined,
});

function moduleChild(module: string): Logger {
  const { getLogger } = require("./request-context") as typeof import("./request-context");
  return getLogger().child({ module });
}

export function createModuleLogger(module: string): Pick<Logger, "debug" | "info" | "warn" | "error"> {
  return {
    debug: (objOrMsg: object | string, msg?: string) => {
      const log = moduleChild(module);
      if (typeof objOrMsg === "string") {
        log.debug(objOrMsg);
      } else if (msg !== undefined) {
        log.debug(objOrMsg, msg);
      } else {
        log.debug(objOrMsg);
      }
    },
    info: (objOrMsg: object | string, msg?: string) => {
      const log = moduleChild(module);
      if (typeof objOrMsg === "string") {
        log.info(objOrMsg);
      } else if (msg !== undefined) {
        log.info(objOrMsg, msg);
      } else {
        log.info(objOrMsg);
      }
    },
    warn: (objOrMsg: object | string, msg?: string) => {
      const log = moduleChild(module);
      if (typeof objOrMsg === "string") {
        log.warn(objOrMsg);
      } else if (msg !== undefined) {
        log.warn(objOrMsg, msg);
      } else {
        log.warn(objOrMsg);
      }
    },
    error: (objOrMsg: object | string, msg?: string) => {
      const log = moduleChild(module);
      if (typeof objOrMsg === "string") {
        log.error(objOrMsg);
      } else if (msg !== undefined) {
        log.error(objOrMsg, msg);
      } else {
        log.error(objOrMsg);
      }
    },
  };
}

import { CONST } from "@/const";
import { store } from "./store";

export function waitForRefreshToken(): Promise<string> {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const token = store.getItem(CONST.STORE.REFRESH_TOKEN);
      if (token) {
        clearInterval(interval);
        resolve(token);
      }
    }, 1000);
  });
}

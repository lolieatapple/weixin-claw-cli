import { loginFlow } from "../auth/login.js";

export async function cmdLogin(): Promise<void> {
  const result = await loginFlow();
  if (!result.success) {
    process.exit(1);
  }
}

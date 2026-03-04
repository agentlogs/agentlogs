import { Resend } from "resend";
import { env } from "@/lib/env";

let resendClient: Resend | undefined;

export function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

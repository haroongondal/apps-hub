import type { Mailer } from './lost-access.ts';

// Shape of Cloudflare's native send_email binding at runtime (structured send, no MIME library needed).
export interface SendEmailBinding {
  send(message: { to: string; from: string; subject: string; text?: string; html?: string }): Promise<{ messageId: string }>;
}

export function createCloudflareMailer(binding: SendEmailBinding, from: string): Mailer {
  return {
    async send(to, subject, text) {
      await binding.send({ to, from, subject, text });
    },
  };
}

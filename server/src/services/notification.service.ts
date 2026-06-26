import { createModuleLogger } from "../lib/logger";
import { prisma, type Tx } from "../lib/prisma-types";
import {
  createNotifications,
  resolveRecipients,
  type RecipientSpec,
} from "../modules/notifications/notifications.repository";

const log = createModuleLogger("notification");

export type { RecipientSpec };

export type NotifyInput = {
  recipients: RecipientSpec;
  type: string;
  title: string;
  message: string;
  link?: string;
  excludeUserId?: string;
  tx?: Tx;
};

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const client = input.tx ?? prisma;
    const resolved = await resolveRecipients(input.recipients, client);
    const userIds = [...new Set(resolved)].filter(
      (id) => id !== input.excludeUserId,
    );

    if (userIds.length === 0) return;

    await createNotifications(
      userIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link ?? null,
        isRead: false,
      })),
      client,
    );
  } catch (error) {
    log.error(
      { err: error, type: input.type, title: input.title },
      "Failed to dispatch notification",
    );
  }
}

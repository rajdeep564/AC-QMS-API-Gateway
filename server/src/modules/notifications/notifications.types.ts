export type NotificationDto = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: Date;
};

export type UnreadCountDto = {
  count: number;
};

export type MarkAllReadResultDto = {
  count: number;
};

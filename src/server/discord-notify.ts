import { config } from './config';
import { logger } from './logger';
import { normalizeLocale, type SupportedLocale } from '../shared/types';

export interface DiscordLoginDmPayload {
  callbackKey: string;
  discordId: string;
  username: string;
  userPublicId?: string;
  locale?: SupportedLocale | string | null;
  timestamp?: Date;
}

export interface DiscordHostCreatedDmPayload {
  discordId: string;
  username: string;
  hostId: string;
  serverId: string;
  hostName: string;
  runtime: string;
  runtimeVersion: string;
  status: string;
  createdAt: Date;
  locale?: SupportedLocale | string | null;
}

// Bounded idempotency cache to guarantee at most 1 DM per event key
const processedNotifications = new Map<string, number>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_ENTRIES = 1000;

function markNotificationProcessed(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of processedNotifications.entries()) {
    if (now - ts > CACHE_TTL_MS) {
      processedNotifications.delete(k);
    }
  }
  if (processedNotifications.has(key)) {
    return false;
  }
  if (processedNotifications.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = processedNotifications.keys().next().value;
    if (oldestKey) processedNotifications.delete(oldestKey);
  }
  processedNotifications.set(key, now);
  return true;
}

function formatTimestamp(date: Date, locale: SupportedLocale): string {
  try {
    return (
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: 'UTC',
      }).format(date) + ' UTC'
    );
  } catch {
    return date.toISOString();
  }
}

export function buildDiscordLoginDmMessage(params: {
  username: string;
  discordId: string;
  userPublicId?: string;
  locale: SupportedLocale;
  timestamp: Date;
}) {
  const formattedTime = formatTimestamp(params.timestamp, params.locale);
  const visitUrl = config.publicUrl;
  const discordServerUrl = config.discord.supportServerUrl;

  if (params.locale === 'en-US') {
    const title = '🔐 HyperHost Login Successful';
    const description = [
      `Hello ${params.username},`,
      '',
      'You have successfully signed in to HyperHost using Discord.',
      '',
      'Login details:',
      `• Account: ${params.username}`,
      `• Discord ID: ${params.discordId}`,
      ...(params.userPublicId ? [`• User ID: ${params.userPublicId}`] : []),
      `• Time: ${formattedTime}`,
      `• Portal: ${visitUrl}`,
      '',
      'If you did not perform this login, please review your account and take appropriate action.',
      '',
      'HyperHost — Powered by HyperSoft',
    ].join('\n');

    return {
      embeds: [
        {
          color: 0x6d28d9,
          title,
          description,
          timestamp: params.timestamp.toISOString(),
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'Visit HyperHost',
              url: visitUrl,
            },
            {
              type: 2,
              style: 5,
              label: 'HyperSoft Discord',
              url: discordServerUrl,
            },
          ],
        },
      ],
    };
  }

  // Default & ar-IQ message
  const title = '🔐 تم تسجيل الدخول بنجاح إلى HyperHost';
  const description = [
    `مرحباً ${params.username}،`,
    '',
    'تم تسجيل الدخول بنجاح إلى HyperHost باستخدام حسابك في Discord.',
    '',
    'تفاصيل تسجيل الدخول:',
    `• الحساب: ${params.username}`,
    `• معرّف Discord: ${params.discordId}`,
    ...(params.userPublicId ? [`• معرّف المستخدم: ${params.userPublicId}`] : []),
    `• وقت تسجيل الدخول: ${formattedTime}`,
    `• الرابط: ${visitUrl}`,
    '',
    'إذا لم تكن أنت من قام بتسجيل الدخول، يرجى مراجعة حسابك واتخاذ الإجراءات المناسبة.',
    '',
    'HyperHost — Powered by HyperSoft',
  ].join('\n');

  return {
    embeds: [
      {
        color: 0x6d28d9,
        title,
        description,
        timestamp: params.timestamp.toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'زيارة HyperHost',
            url: visitUrl,
          },
          {
            type: 2,
            style: 5,
            label: 'سيرفر HyperSoft',
            url: discordServerUrl,
          },
        ],
      },
    ],
  };
}

export function buildDiscordHostCreatedDmMessage(params: {
  username: string;
  serverId: string;
  hostName: string;
  runtime: string;
  runtimeVersion: string;
  status: string;
  createdAt: Date;
  locale: SupportedLocale;
}) {
  const formattedTime = formatTimestamp(params.createdAt, params.locale);
  const baseUrl = config.publicUrl.replace(/\/$/, '');
  const hostPanelUrl = `${baseUrl}/hosts/${encodeURIComponent(params.serverId)}`;
  const discordServerUrl = config.discord.supportServerUrl;
  const runtimeDisplay = `${params.runtime} v${params.runtimeVersion}`;

  if (params.locale === 'en-US') {
    const title = '🚀 Host Created Successfully in HyperHost';
    const description = [
      `Hello ${params.username},`,
      '',
      'Your new Host has been created in HyperHost.',
      '',
      'Host details:',
      `• Host Name: ${params.hostName}`,
      `• Server ID: ${params.serverId}`,
      `• Runtime: ${runtimeDisplay}`,
      `• Created At: ${formattedTime}`,
      `• Status: ${params.status}`,
      '',
      'HyperHost — Powered by HyperSoft',
    ].join('\n');

    return {
      embeds: [
        {
          color: 0x6d28d9,
          title,
          description,
          timestamp: params.createdAt.toISOString(),
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'زيارة الاستضافة',
              url: hostPanelUrl,
            },
            {
              type: 2,
              style: 5,
              label: 'سيرفر HyperSoft',
              url: discordServerUrl,
            },
          ],
        },
      ],
    };
  }

  // Default & ar-IQ message
  const title = '🚀 تم إنشاء الاستضافة بنجاح في HyperHost';
  const description = [
    `مرحباً ${params.username}،`,
    '',
    'تم إنشاء الاستضافة بنجاح في HyperHost.',
    '',
    'تفاصيل الاستضافة:',
    `• Host Name: ${params.hostName}`,
    `• Server ID: ${params.serverId}`,
    `• Runtime: ${runtimeDisplay}`,
    `• Created At: ${formattedTime}`,
    `• Status: ${params.status}`,
    '',
    'HyperHost — Powered by HyperSoft',
  ].join('\n');

  return {
    embeds: [
      {
        color: 0x6d28d9,
        title,
        description,
        timestamp: params.createdAt.toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'زيارة الاستضافة',
            url: hostPanelUrl,
          },
          {
            type: 2,
            style: 5,
            label: 'سيرفر HyperSoft',
            url: discordServerUrl,
          },
        ],
      },
    ],
  };
}

async function deliverDiscordDirectMessage(
  discordId: string,
  messageBody: Record<string, unknown>,
  contextLabel: string
): Promise<{ attempted: boolean; dmSent: boolean }> {
  const botToken = config.discord.botToken;
  if (!botToken) {
    return { attempted: false, dmSent: false };
  }

  if (!discordId || !/^\d{15,22}$/.test(discordId)) {
    logger.warn(`Skipped Discord DM (${contextLabel}): invalid Discord ID format`);
    return { attempted: false, dmSent: false };
  }

  try {
    const dmChannelRes = await fetch(
      'https://discord.com/api/v10/users/@me/channels',
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipient_id: discordId }),
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!dmChannelRes.ok) {
      logger.warn(`Unable to open Discord DM channel (${contextLabel})`, {
        discordId,
        status: dmChannelRes.status,
      });
      return { attempted: true, dmSent: false };
    }

    const dmChannel = (await dmChannelRes.json()) as { id?: string };
    if (!dmChannel?.id) {
      logger.warn(`Discord DM channel response missing channel ID (${contextLabel})`, {
        discordId,
      });
      return { attempted: true, dmSent: false };
    }

    const sendRes = await fetch(
      `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageBody),
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!sendRes.ok) {
      logger.warn(`Could not deliver Discord DM (${contextLabel})`, {
        discordId,
        status: sendRes.status,
      });
      return { attempted: true, dmSent: false };
    }

    logger.info(`Delivered Discord DM notification (${contextLabel})`, {
      discordId,
    });

    return { attempted: true, dmSent: true };
  } catch (err) {
    logger.warn(`Discord DM failed safely (${contextLabel})`, {
      discordId,
      reason: err instanceof Error ? err.name : 'NetworkError',
    });
    return { attempted: true, dmSent: false };
  }
}

export async function sendDiscordLoginNotification(
  payload: DiscordLoginDmPayload
): Promise<{
  attempted: boolean;
  dmSent: boolean;
}> {
  if (!config.discord.botToken) {
    return { attempted: false, dmSent: false };
  }

  if (!markNotificationProcessed(`login:${payload.callbackKey}`)) {
    logger.info('Skipped duplicate Discord login DM for already-processed callback', {
      discordId: payload.discordId,
    });
    return { attempted: false, dmSent: false };
  }

  const locale: SupportedLocale = normalizeLocale(payload.locale);
  const timestamp = payload.timestamp ?? new Date();
  const messageBody = buildDiscordLoginDmMessage({
    username: payload.username,
    discordId: payload.discordId,
    userPublicId: payload.userPublicId,
    locale,
    timestamp,
  });

  return deliverDiscordDirectMessage(payload.discordId, messageBody, 'login');
}

export async function sendDiscordHostCreatedNotification(
  payload: DiscordHostCreatedDmPayload
): Promise<{
  attempted: boolean;
  dmSent: boolean;
}> {
  if (!config.discord.botToken) {
    return { attempted: false, dmSent: false };
  }

  if (!markNotificationProcessed(`host_create:${payload.serverId}`)) {
    return { attempted: false, dmSent: false };
  }

  const locale: SupportedLocale = normalizeLocale(payload.locale);
  const messageBody = buildDiscordHostCreatedDmMessage({
    username: payload.username,
    serverId: payload.serverId,
    hostName: payload.hostName,
    runtime: payload.runtime,
    runtimeVersion: payload.runtimeVersion,
    status: payload.status,
    createdAt: payload.createdAt,
    locale,
  });

  return deliverDiscordDirectMessage(
    payload.discordId,
    messageBody,
    'host_created'
  );
}

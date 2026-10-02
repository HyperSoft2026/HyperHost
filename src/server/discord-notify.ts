import { config } from './config';
import { logger } from './logger';
import {
  normalizeLocale,
  RUNTIME_CATALOG,
  type SupportedLocale,
} from '../shared/types';

export type DiscordDmFailureReason =
  | 'DISCORD_DM_NOT_CONFIGURED'
  | 'DISCORD_DM_UNAUTHORIZED'
  | 'DISCORD_DM_FORBIDDEN'
  | 'DISCORD_DM_NOT_FOUND'
  | 'DISCORD_DM_RATE_LIMITED'
  | 'DISCORD_API_ERROR'
  | 'DISCORD_NETWORK_ERROR'
  | 'DUPLICATE_NOTIFICATION_SKIPPED'
  | 'INVALID_DISCORD_ID';

export type DiscordDmDeliveryResult =
  | {
      ok: true;
      channelId: string;
      messageId: string;
    }
  | {
      ok: false;
      reason: DiscordDmFailureReason;
      statusCode?: number;
    };

export interface DiscordLoginDmPayload {
  callbackKey: string;
  discordId: string;
  username: string;
  displayName?: string;
  userPublicId?: string;
  ipAddress?: string | null;
  locale?: SupportedLocale | string | null;
  timestamp?: Date;
}

export interface DiscordHostCreatedDmPayload {
  discordId: string;
  username: string;
  displayName?: string;
  userPublicId?: string;
  hostId?: string;
  serverId: string;
  hostName: string;
  hostType?: string;
  runtime: string;
  runtimeVersion: string;
  memoryLimitMb?: number;
  diskLimitMb?: number;
  cpuLimitPercent?: number;
  status: string;
  createdAt: Date;
  locale?: SupportedLocale | string | null;
}

const DISCORD_NOTIFICATION_TEXT = {
  'ar-IQ': {
    'discord.login.title': '🔐 تم تسجيل الدخول بنجاح إلى HyperHost',
    'discord.login.visitBtn': 'زيارة HyperHost',
    'discord.login.hyperSoftBtn': 'سيرفر HyperSoft',
    'discord.host.created.title': '🚀 تم إنشاء استضافتك في HyperHost',
    'discord.host.created.openHost': 'فتح الاستضافة',
    'discord.host.created.hyperSoft': 'سيرفر HyperSoft',
  },
  'en-US': {
    'discord.login.title': '🔐 HyperHost Login Successful',
    'discord.login.visitBtn': 'Visit HyperHost',
    'discord.login.hyperSoftBtn': 'HyperSoft Discord',
    'discord.host.created.title': '🚀 HyperHost Host Created',
    'discord.host.created.openHost': 'Open Host',
    'discord.host.created.hyperSoft': 'HyperSoft Discord',
  },
} as const;

// Bounded idempotency cache to guarantee at most 1 DM per OAuth login state or Host creation
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

function formatRuntimeLabel(runtimeCode: string, version: string): string {
  const catalogMatch = RUNTIME_CATALOG.find(
    (item) => item.code.toUpperCase() === runtimeCode.toUpperCase()
  );
  const label = catalogMatch ? catalogMatch.label.replace(/\s*\(.*\)$/, '') : runtimeCode;
  return `${label} ${version}`;
}

function mapDiscordStatusToFailureReason(status: number): DiscordDmFailureReason {
  if (status === 401) return 'DISCORD_DM_UNAUTHORIZED';
  if (status === 403) return 'DISCORD_DM_FORBIDDEN';
  if (status === 404) return 'DISCORD_DM_NOT_FOUND';
  if (status === 429) return 'DISCORD_DM_RATE_LIMITED';
  return 'DISCORD_API_ERROR';
}

export function buildDiscordLoginDmMessage(params: {
  callbackKey?: string;
  username: string;
  displayName?: string;
  discordId: string;
  userPublicId?: string;
  ipAddress?: string | null;
  locale: SupportedLocale;
  timestamp?: Date;
  loginTimestampIso?: string;
}) {
  const resolvedDate =
    params.timestamp ??
    (params.loginTimestampIso ? new Date(params.loginTimestampIso) : new Date());
  const formattedTime = formatTimestamp(resolvedDate, params.locale);
  const visitUrl = config.publicUrl;
  const discordServerUrl = config.discord.supportServerUrl;
  const copy = DISCORD_NOTIFICATION_TEXT[params.locale];

  if (params.locale === 'en-US') {
    const description = [
      `Hello ${params.displayName || params.username},`,
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
          title: copy['discord.login.title'],
          description,
          timestamp: resolvedDate.toISOString(),
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: copy['discord.login.visitBtn'],
              url: visitUrl,
            },
            {
              type: 2,
              style: 5,
              label: copy['discord.login.hyperSoftBtn'],
              url: discordServerUrl,
            },
          ],
        },
      ],
    };
  }

  const description = [
    `مرحباً ${params.displayName || params.username}،`,
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
        title: copy['discord.login.title'],
        description,
        timestamp: resolvedDate.toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: copy['discord.login.visitBtn'],
            url: visitUrl,
          },
          {
            type: 2,
            style: 5,
            label: copy['discord.login.hyperSoftBtn'],
            url: discordServerUrl,
          },
        ],
      },
    ],
  };
}

export function buildDiscordHostCreatedDmMessage(params: {
  discordId?: string;
  username: string;
  displayName?: string;
  serverId: string;
  hostName: string;
  hostType?: string;
  runtime: string;
  runtimeVersion: string;
  memoryLimitMb?: number;
  diskLimitMb?: number;
  cpuLimitPercent?: number;
  status: string;
  createdAt?: Date;
  createdAtIso?: string;
  locale: SupportedLocale;
}) {
  const resolvedDate =
    params.createdAt ??
    (params.createdAtIso ? new Date(params.createdAtIso) : new Date());
  const formattedTime = formatTimestamp(resolvedDate, params.locale);
  const baseUrl = config.publicUrl.replace(/\/$/, '');
  const hostPanelUrl = `${baseUrl}/hosts/${encodeURIComponent(params.serverId)}`;
  const discordServerUrl = config.discord.supportServerUrl;
  const runtimeDisplay = formatRuntimeLabel(params.runtime, params.runtimeVersion);
  const ramMb = params.memoryLimitMb ?? 512;
  const diskMb = params.diskLimitMb ?? 2048;
  const cpuPct = params.cpuLimitPercent ?? 100;
  const copy = DISCORD_NOTIFICATION_TEXT[params.locale];

  if (params.locale === 'en-US') {
    const description = [
      `Hello ${params.displayName || params.username},`,
      '',
      'Your new Host has been created in HyperHost.',
      '',
      `• Host: ${params.hostName}`,
      `• Host ID: ${params.serverId}`,
      `• Runtime: ${runtimeDisplay}`,
      `• RAM: ${ramMb} MB`,
      `• Disk: ${diskMb} MB`,
      `• CPU: ${cpuPct}%`,
      `• Status: ${params.status}`,
      `• Creation Time: ${formattedTime}`,
      `• Host Panel: ${hostPanelUrl}`,
      '',
      'HyperHost — Powered by HyperSoft',
    ].join('\n');

    return {
      embeds: [
        {
          color: 0x6d28d9,
          title: copy['discord.host.created.title'],
          description,
          timestamp: resolvedDate.toISOString(),
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: copy['discord.host.created.openHost'],
              url: hostPanelUrl,
            },
            {
              type: 2,
              style: 5,
              label: copy['discord.host.created.hyperSoft'],
              url: discordServerUrl,
            },
          ],
        },
      ],
    };
  }

  const description = [
    `مرحباً ${params.displayName || params.username}،`,
    '',
    'تم إنشاء استضافتك الجديدة بنجاح في HyperHost.',
    '',
    `• اسم الاستضافة (Host): ${params.hostName}`,
    `• معرّف الاستضافة (Host ID): ${params.serverId}`,
    `• بيئة التشغيل (Runtime): ${runtimeDisplay}`,
    `• الذاكرة (RAM): ${ramMb} MB`,
    `• التخزين (Disk): ${diskMb} MB`,
    `• المعالج (CPU): ${cpuPct}%`,
    `• الحالة (Status): ${params.status}`,
    `• وقت الإنشاء: ${formattedTime}`,
    `• رابط لوحة الاستضافة: ${hostPanelUrl}`,
    '',
    'HyperHost — Powered by HyperSoft',
  ].join('\n');

  return {
    embeds: [
      {
        color: 0x6d28d9,
        title: copy['discord.host.created.title'],
        description,
        timestamp: resolvedDate.toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: copy['discord.host.created.openHost'],
            url: hostPanelUrl,
          },
          {
            type: 2,
            style: 5,
            label: copy['discord.host.created.hyperSoft'],
            url: discordServerUrl,
          },
        ],
      },
    ],
  };
}

async function deliverDiscordDirectMessage(
  discordId: string,
  safeUserId: string,
  messageBody: Record<string, unknown>,
  contextLabel: 'login' | 'host_created'
): Promise<DiscordDmDeliveryResult> {
  const botToken = config.discord.botToken;
  if (!botToken) {
    logger.warn('Discord DM notification failed', {
      context: contextLabel,
      reason: 'DISCORD_DM_NOT_CONFIGURED',
      userId: safeUserId,
    });
    return {
      ok: false,
      reason: 'DISCORD_DM_NOT_CONFIGURED',
    };
  }

  if (!discordId || !/^\d{15,22}$/.test(discordId)) {
    logger.warn('Discord DM notification failed', {
      context: contextLabel,
      reason: 'INVALID_DISCORD_ID',
      userId: safeUserId,
    });
    return {
      ok: false,
      reason: 'INVALID_DISCORD_ID',
    };
  }

  try {
    // Step 1: Open DM channel via Discord REST API v10
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
      const reason = mapDiscordStatusToFailureReason(dmChannelRes.status);
      logger.warn('Discord DM notification failed', {
        context: contextLabel,
        step: 'open_dm_channel',
        status: dmChannelRes.status,
        reason,
        userId: safeUserId,
      });
      return {
        ok: false,
        reason,
        statusCode: dmChannelRes.status,
      };
    }

    const dmChannel = (await dmChannelRes.json()) as { id?: string };
    if (!dmChannel?.id) {
      logger.warn('Discord DM notification failed', {
        context: contextLabel,
        step: 'open_dm_channel_parse',
        reason: 'DISCORD_API_ERROR',
        userId: safeUserId,
      });
      return {
        ok: false,
        reason: 'DISCORD_API_ERROR',
        statusCode: dmChannelRes.status,
      };
    }

    // Step 2: Send message to DM channel via Discord REST API v10
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
      const reason = mapDiscordStatusToFailureReason(sendRes.status);
      logger.warn('Discord DM notification failed', {
        context: contextLabel,
        step: 'send_dm_message',
        status: sendRes.status,
        reason,
        userId: safeUserId,
      });
      return {
        ok: false,
        reason,
        statusCode: sendRes.status,
      };
    }

    const sentMsg = (await sendRes.json()) as { id?: string };
    if (!sentMsg?.id) {
      logger.warn('Discord DM notification failed', {
        context: contextLabel,
        step: 'send_dm_message_parse',
        reason: 'DISCORD_API_ERROR',
        userId: safeUserId,
      });
      return {
        ok: false,
        reason: 'DISCORD_API_ERROR',
        statusCode: sendRes.status,
      };
    }

    logger.info('Discord DM notification delivered successfully', {
      context: contextLabel,
      channelId: dmChannel.id,
      messageId: sentMsg.id,
      userId: safeUserId,
    });

    return {
      ok: true,
      channelId: dmChannel.id,
      messageId: sentMsg.id,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError');
    const reason: DiscordDmFailureReason = 'DISCORD_NETWORK_ERROR';

    logger.warn('Discord DM notification failed', {
      context: contextLabel,
      reason,
      timeout: isTimeout,
      errorName: err instanceof Error ? err.name : 'NetworkError',
      userId: safeUserId,
    });

    return {
      ok: false,
      reason,
    };
  }
}

export async function sendDiscordLoginNotification(
  payload: DiscordLoginDmPayload
): Promise<DiscordDmDeliveryResult> {
  const safeUserId = payload.userPublicId || `discord:${payload.discordId}`;

  if (!config.discord.botToken) {
    logger.warn('Discord DM notification failed', {
      context: 'login',
      reason: 'DISCORD_DM_NOT_CONFIGURED',
      userId: safeUserId,
    });
    return {
      ok: false,
      reason: 'DISCORD_DM_NOT_CONFIGURED',
    };
  }

  if (!markNotificationProcessed(`login:${payload.callbackKey}`)) {
    logger.info('Skipped duplicate Discord login DM for already-processed callback', {
      userId: safeUserId,
    });
    return {
      ok: false,
      reason: 'DUPLICATE_NOTIFICATION_SKIPPED',
    };
  }

  const locale: SupportedLocale = normalizeLocale(payload.locale);
  const timestamp = payload.timestamp ?? new Date();
  const messageBody = buildDiscordLoginDmMessage({
    username: payload.username,
    displayName: payload.displayName,
    discordId: payload.discordId,
    userPublicId: payload.userPublicId,
    ipAddress: payload.ipAddress,
    locale,
    timestamp,
  });

  return deliverDiscordDirectMessage(
    payload.discordId,
    safeUserId,
    messageBody,
    'login'
  );
}

export async function sendDiscordHostCreatedNotification(
  payload: DiscordHostCreatedDmPayload
): Promise<DiscordDmDeliveryResult> {
  const safeUserId = payload.userPublicId || `discord:${payload.discordId}`;

  if (!config.discord.botToken) {
    logger.warn('DISCORD_HOST_NOTIFICATION_FAILED', {
      reason: 'DISCORD_DM_NOT_CONFIGURED',
      hostId: payload.serverId,
      userId: safeUserId,
    });
    return {
      ok: false,
      reason: 'DISCORD_DM_NOT_CONFIGURED',
    };
  }

  if (!markNotificationProcessed(`host_create:${payload.serverId}`)) {
    return {
      ok: false,
      reason: 'DUPLICATE_NOTIFICATION_SKIPPED',
    };
  }

  const locale: SupportedLocale = normalizeLocale(payload.locale);
  const messageBody = buildDiscordHostCreatedDmMessage({
    username: payload.username,
    displayName: payload.displayName,
    serverId: payload.serverId,
    hostName: payload.hostName,
    hostType: payload.hostType,
    runtime: payload.runtime,
    runtimeVersion: payload.runtimeVersion,
    memoryLimitMb: payload.memoryLimitMb,
    diskLimitMb: payload.diskLimitMb,
    cpuLimitPercent: payload.cpuLimitPercent,
    status: payload.status,
    createdAt: payload.createdAt,
    locale,
  });

  const result = await deliverDiscordDirectMessage(
    payload.discordId,
    safeUserId,
    messageBody,
    'host_created'
  );

  if (!result.ok) {
    logger.warn('DISCORD_HOST_NOTIFICATION_FAILED', {
      reason: result.reason,
      statusCode: result.statusCode ?? null,
      hostId: payload.serverId,
      userId: safeUserId,
    });
  }

  return result;
}

export async function probeDiscordBotApiHealth(): Promise<{
  configured: boolean;
  reachable: boolean;
  statusCode: number | null;
  reason: string | null;
}> {
  const botToken = config.discord.botToken;
  if (!botToken) {
    return {
      configured: false,
      reachable: false,
      statusCode: null,
      reason: 'DISCORD_DM_NOT_CONFIGURED',
    };
  }

  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: {
        Authorization: `Bot ${botToken}`,
      },
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      return {
        configured: true,
        reachable: true,
        statusCode: res.status,
        reason: null,
      };
    }

    return {
      configured: true,
      reachable: false,
      statusCode: res.status,
      reason: mapDiscordStatusToFailureReason(res.status),
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      statusCode: null,
      reason: 'DISCORD_NETWORK_ERROR',
    };
  }
}

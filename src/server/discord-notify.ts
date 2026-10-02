import { config } from './config';
import { logger } from './logger';
import { normalizeLocale, type SupportedLocale } from '../shared/types';

export interface DiscordLoginDmPayload {
  callbackKey: string;
  discordId: string;
  username: string;
  locale?: SupportedLocale | string | null;
  timestamp?: Date;
}

// Bounded idempotency cache to guarantee at most 1 DM per OAuth callback
const processedCallbacks = new Map<string, number>();
const CALLBACK_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_ENTRIES = 1000;

function markCallbackProcessed(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of processedCallbacks.entries()) {
    if (now - ts > CALLBACK_CACHE_TTL_MS) {
      processedCallbacks.delete(k);
    }
  }
  if (processedCallbacks.has(key)) {
    return false;
  }
  if (processedCallbacks.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = processedCallbacks.keys().next().value;
    if (oldestKey) processedCallbacks.delete(oldestKey);
  }
  processedCallbacks.set(key, now);
  return true;
}

function formatTimestamp(date: Date, locale: SupportedLocale): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: 'UTC',
    }).format(date) + ' UTC';
  } catch {
    return date.toISOString();
  }
}

export function buildDiscordLoginDmMessage(params: {
  username: string;
  discordId: string;
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
      `• Time: ${formattedTime}`,
      '',
      'If you did not perform this login, please review your account and take appropriate action.',
      '',
      'HyperHost — Powered by HyperSoft',
    ].join('\n');

    return {
      embeds: [
        {
          color: 0x5865f2,
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
  const title = '🔐 تم تسجيل الدخول إلى HyperHost';
  const description = [
    `مرحباً ${params.username}،`,
    '',
    'تم تسجيل الدخول إلى حسابك في HyperHost بنجاح باستخدام Discord.',
    '',
    'تفاصيل تسجيل الدخول:',
    `• الحساب: ${params.username}`,
    `• Discord ID: ${params.discordId}`,
    `• الوقت: ${formattedTime}`,
    '',
    'إذا لم تكن أنت من قام بتسجيل الدخول، يرجى مراجعة حسابك واتخاذ الإجراءات المناسبة.',
    '',
    'HyperHost — Powered by HyperSoft',
  ].join('\n');

  return {
    embeds: [
      {
        color: 0x5865f2,
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

export async function sendDiscordLoginNotification(
  payload: DiscordLoginDmPayload
): Promise<{
  attempted: boolean;
  dmSent: boolean;
}> {
  const botToken = config.discord.botToken;

  if (!botToken) {
    return {
      attempted: false,
      dmSent: false,
    };
  }

  if (! payload.discordId || !/^\d{15,22}$/.test(payload.discordId)) {
    logger.warn('Skipped Discord login DM: invalid Discord user ID format');
    return {
      attempted: false,
      dmSent: false,
    };
  }

  // Ensure idempotency so a single OAuth callback never sends duplicate DMs
  if (!markCallbackProcessed(payload.callbackKey)) {
    logger.info('Skipped duplicate Discord login DM for already-processed callback', {
      discordId: payload.discordId,
    });
    return {
      attempted: false,
      dmSent: false,
    };
  }

  const locale: SupportedLocale = normalizeLocale(payload.locale);
  const timestamp = payload.timestamp ?? new Date();
  const messageBody = buildDiscordLoginDmMessage({
    username: payload.username,
    discordId: payload.discordId,
    locale,
    timestamp,
  });

  try {
    // Step 1: Open or retrieve DM channel with the authenticated Discord user
    const dmChannelRes = await fetch(
      'https://discord.com/api/v10/users/@me/channels',
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipient_id: payload.discordId }),
        signal: AbortSignal.timeout(6000),
      }
    );

    if (dmChannelRes.status === 429) {
      logger.warn('Discord Bot API rate limit reached while opening DM channel', {
        discordId: payload.discordId,
        status: 429,
      });
      return { attempted: true, dmSent: false };
    }

    if (!dmChannelRes.ok) {
      logger.warn('Unable to open Discord DM channel for login notification', {
        discordId: payload.discordId,
        status: dmChannelRes.status,
      });
      return { attempted: true, dmSent: false };
    }

    const dmChannel = (await dmChannelRes.json()) as { id?: string };
    if (!dmChannel?.id) {
      logger.warn('Discord DM channel response did not include a channel ID', {
        discordId: payload.discordId,
      });
      return { attempted: true, dmSent: false };
    }

    // Step 2: Send the localized DM embed + link button components
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

    if (sendRes.status === 429) {
      logger.warn('Discord Bot API rate limit reached while sending login DM', {
        discordId: payload.discordId,
        status: 429,
      });
      return { attempted: true, dmSent: false };
    }

    if (!sendRes.ok) {
      // e.g. HTTP 403 (Discord error 50007: Cannot send messages to this user when DMs are closed)
      logger.warn('Could not deliver Discord login DM to user (DMs may be disabled)', {
        discordId: payload.discordId,
        status: sendRes.status,
      });
      return { attempted: true, dmSent: false };
    }

    logger.info('Delivered Discord login DM notification', {
      discordId: payload.discordId,
      locale,
    });

    return {
      attempted: true,
      dmSent: true,
    };
  } catch (err) {
    logger.warn('Discord login DM notification failed safely without interrupting login', {
      discordId: payload.discordId,
      reason: err instanceof Error ? err.name : 'NetworkError',
    });
    return {
      attempted: true,
      dmSent: false,
    };
  }
}

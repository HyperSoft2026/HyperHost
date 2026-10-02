import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  config,
  getDiscordRedirectUriOrNull,
  isDiscordLoginNotificationConfigured,
  isDiscordOAuthConfigured,
} from '../config';
import {
  clearSessionCookie,
  getSessionCookieOptions,
  recordActivityLog,
  resolveAuthContext,
  SESSION_COOKIE_NAME,
} from '../auth';
import {
  encryptSecret,
  generateSecureToken,
  hashToken,
} from '../crypto';
import { checkDatabaseHealth, getPrismaOrThrow } from '../database';
import { AppError } from '../errors';
import {
  sendDiscordLoginNotification,
  type DiscordDmDeliveryResult,
} from '../discord-notify';
import {
  MAX_HOSTS_PER_USER,
  normalizeLocale,
  type SupportedLocale,
} from '../../shared/types';
import { formatEntityPublicId, generatePublicId } from '../../shared/ids';

const OAUTH_STATE_COOKIE = 'hyperhost_oauth_state';
const OAUTH_LOCALE_COOKIE = 'hyperhost_locale';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Idempotent callback guard to prevent duplicate OAuth code processing on double-requests
const completedOAuthStates = new Map<
  string,
  { rawSessionToken: string; timestamp: number; dmResult: DiscordDmDeliveryResult }
>();

function createSignedOAuthState(locale: SupportedLocale): string {
  const timestampHex = Date.now().toString(16);
  const nonce = generateSecureToken(12);
  const localeCode = locale === 'en-US' ? 'en-US' : 'ar-IQ';
  const payload = `${timestampHex}.${nonce}.${localeCode}`;
  const signature = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('hex')
    .slice(0, 32);
  return `${payload}.${signature}`;
}

function verifySignedOAuthState(state: string): {
  valid: boolean;
  locale: SupportedLocale;
} {
  const parts = state.split('.');
  if (parts.length !== 4) {
    return { valid: false, locale: 'ar-IQ' };
  }
  const [timestampHex, nonce, rawLocale, providedSig] = parts;
  if (!timestampHex || !nonce || !rawLocale || !providedSig) {
    return { valid: false, locale: 'ar-IQ' };
  }

  const issuedAt = Number.parseInt(timestampHex, 16);
  if (!Number.isFinite(issuedAt)) {
    return { valid: false, locale: 'ar-IQ' };
  }
  if (Math.abs(Date.now() - issuedAt) > OAUTH_STATE_TTL_MS) {
    return { valid: false, locale: 'ar-IQ' };
  }

  const locale = normalizeLocale(rawLocale);
  const payload = `${timestampHex}.${nonce}.${locale}`;
  const expectedSig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('hex')
    .slice(0, 32);

  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(providedSig, 'utf8'),
      Buffer.from(expectedSig, 'utf8')
    );
    return { valid, locale };
  } catch {
    return { valid: false, locale: 'ar-IQ' };
  }
}

function resolveRequestedLocale(request: FastifyRequest): SupportedLocale {
  const query = request.query as { locale?: string } | undefined;
  const headerLocale = request.headers['x-hyperhost-locale'];
  const cookieLocale = request.cookies?.[OAUTH_LOCALE_COOKIE];
  const candidate =
    query?.locale ||
    (typeof headerLocale === 'string' ? headerLocale : undefined) ||
    cookieLocale;
  return normalizeLocale(candidate);
}

function buildDiscordAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: config.discord.clientId!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify email',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function buildCallbackSuccessHtml(
  reply: FastifyReply,
  dmResult: DiscordDmDeliveryResult
): void {
  const dmStatus = dmResult.ok ? 'sent' : 'failed';
  const dmReason = dmResult.ok ? '' : dmResult.reason;
  const redirectUrl = `/?login=discord_success&dm=${dmStatus}${
    dmReason ? `&dm_reason=${encodeURIComponent(dmReason)}` : ''
  }`;
  const htmlSafeRedirectUrl = redirectUrl.replace(/&/g, '&amp;');
  const safePostMessageJson = JSON.stringify({
    type: 'OAUTH_AUTH_SUCCESS',
    dmSent: dmResult.ok,
    dmReason: dmResult.ok ? null : dmResult.reason,
  });

  reply.type('text/html').send(`<!DOCTYPE html>
<html lang="ar-IQ">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="1;url=${htmlSafeRedirectUrl}" />
    <title>HyperHost Authentication</title>
  </head>
  <body style="background:#090A10;color:#F8FAFC;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <script>
      try {
        if (window.opener && window.opener !== window) {
          window.opener.postMessage(${safePostMessageJson}, '*');
          window.close();
          setTimeout(function () {
            window.location.replace(${JSON.stringify(redirectUrl)});
          }, 350);
        } else {
          window.location.replace(${JSON.stringify(redirectUrl)});
        }
      } catch (e) {
        window.location.replace(${JSON.stringify(redirectUrl)});
      }
    </script>
    <p>Authentication complete. Redirecting to HyperHost...</p>
  </body>
</html>`);
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Construct Discord OAuth2 URL using DISCORD_REDIRECT_URI from environment
  app.get('/api/auth/url', async (request, reply) => {
    const redirectUri = getDiscordRedirectUriOrNull();
    if (!isDiscordOAuthConfigured() || !redirectUri) {
      throw new AppError(
        'DISCORD_OAUTH_NOT_CONFIGURED',
        'Discord OAuth2 environment variables (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI) are not configured on the server.',
        503
      );
    }

    const dbHealth = await checkDatabaseHealth();
    if (!dbHealth.connected) {
      throw new AppError(
        'DATABASE_UNAVAILABLE',
        'PostgreSQL database must be connected before initiating Discord OAuth2 sessions.',
        503
      );
    }

    const locale = resolveRequestedLocale(request);
    const state = createSignedOAuthState(locale);
    const cookieOpts = {
      ...getSessionCookieOptions(request),
      maxAge: 60 * 10,
    };

    reply.setCookie(OAUTH_STATE_COOKIE, state, cookieOpts);
    reply.setCookie(OAUTH_LOCALE_COOKIE, locale, cookieOpts);

    return {
      success: true,
      data: {
        url: buildDiscordAuthorizeUrl(state, redirectUri),
        locale,
      },
    };
  });

  // Direct OAuth redirect route
  app.get('/api/auth/discord', async (request, reply) => {
    const redirectUri = getDiscordRedirectUriOrNull();
    if (!isDiscordOAuthConfigured() || !redirectUri) {
      throw new AppError(
        'DISCORD_OAUTH_NOT_CONFIGURED',
        'Discord OAuth2 environment variables (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI) are not configured on the server.',
        503
      );
    }

    const locale = resolveRequestedLocale(request);
    const state = createSignedOAuthState(locale);
    const cookieOpts = {
      ...getSessionCookieOptions(request),
      maxAge: 60 * 10,
    };

    reply.setCookie(OAUTH_STATE_COOKIE, state, cookieOpts);
    reply.setCookie(OAUTH_LOCALE_COOKIE, locale, cookieOpts);

    return reply.redirect(buildDiscordAuthorizeUrl(state, redirectUri));
  });

  // OAuth2 Callback Handler
  const handleCallback = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (query.error) {
      throw new AppError(
        'DISCORD_OAUTH_DENIED',
        `Discord authorization was cancelled or denied: ${query.error}`,
        400
      );
    }

    if (!query.code) {
      throw new AppError(
        'MISSING_OAUTH_CODE',
        'Missing authorization code from Discord OAuth2 callback.',
        400
      );
    }

    const redirectUri = getDiscordRedirectUriOrNull();
    if (!isDiscordOAuthConfigured() || !redirectUri) {
      throw new AppError(
        'DISCORD_OAUTH_NOT_CONFIGURED',
        'Discord OAuth2 environment variables are not configured.',
        503
      );
    }

    const storedState = request.cookies?.[OAUTH_STATE_COOKIE];
    const signedVerification = query.state
      ? verifySignedOAuthState(query.state)
      : { valid: false, locale: 'ar-IQ' as SupportedLocale };

    const hasMatchingCookieState = Boolean(
      storedState && query.state && storedState === query.state
    );

    if (
      !query.state ||
      (storedState && storedState !== query.state) ||
      (!hasMatchingCookieState && !signedVerification.valid)
    ) {
      throw new AppError(
        'INVALID_OAUTH_STATE',
        'OAuth2 state parameter missing or mismatched (CSRF protection triggered).',
        400
      );
    }

    // Idempotency guard: if this exact state was already completed within the last few minutes, reuse session
    const stateHash = hashToken(query.state);
    const existingCompleted = completedOAuthStates.get(stateHash);
    if (
      existingCompleted &&
      Date.now() - existingCompleted.timestamp < OAUTH_STATE_TTL_MS
    ) {
      reply.clearCookie(OAUTH_STATE_COOKIE, getSessionCookieOptions(request));
      reply.setCookie(
        SESSION_COOKIE_NAME,
        existingCompleted.rawSessionToken,
        getSessionCookieOptions(request)
      );
      buildCallbackSuccessHtml(reply, existingCompleted.dmResult);
      return;
    }

    const activeLocale: SupportedLocale = signedVerification.valid
      ? signedVerification.locale
      : normalizeLocale(request.cookies?.[OAUTH_LOCALE_COOKIE]);

    const prisma = getPrismaOrThrow();

    // Exchange authorization code for tokens
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.discord.clientId!,
        client_secret: config.discord.clientSecret!,
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenRes.ok) {
      throw new AppError(
        'DISCORD_TOKEN_EXCHANGE_FAILED',
        'Failed to exchange authorization code with Discord OAuth2 API.',
        502
      );
    }

    const tokenPayload = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    // Fetch Discord user profile
    const profileRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!profileRes.ok) {
      throw new AppError(
        'DISCORD_PROFILE_FETCH_FAILED',
        'Failed to retrieve user identity from Discord API.',
        502
      );
    }

    const discordUser = (await profileRes.json()) as {
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
      email?: string | null;
    };

    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=256`
      : null;

    const displayName = discordUser.global_name || discordUser.username;

    const existingUser = await prisma.user.findUnique({
      where: { discordId: discordUser.id },
    });
    const isNewUser = !existingUser;
    const isAdminByEnv = config.discord.adminDiscordIds.includes(discordUser.id);

    const user = await prisma.user.upsert({
      where: { discordId: discordUser.id },
      update: {
        username: discordUser.username,
        displayName,
        avatar: avatarUrl,
        email: discordUser.email ?? null,
        ...(existingUser && !existingUser.publicId.startsWith('usr_')
          ? { publicId: formatEntityPublicId('usr', existingUser.id, existingUser.publicId) }
          : {}),
        ...(isAdminByEnv ? { role: 'ADMIN' } : {}),
      },
      create: {
        publicId: generatePublicId('usr'),
        discordId: discordUser.id,
        username: discordUser.username,
        displayName,
        avatar: avatarUrl,
        email: discordUser.email ?? null,
        role: isAdminByEnv ? 'ADMIN' : 'USER',
      },
    });

    const tokenExpiresAt = new Date(Date.now() + tokenPayload.expires_in * 1000);
    const scopes = tokenPayload.scope ? tokenPayload.scope.split(' ') : ['identify'];

    await prisma.discordAccount.upsert({
      where: { userId: user.id },
      update: {
        discordId: discordUser.id,
        username: discordUser.username,
        globalName: discordUser.global_name ?? null,
        avatar: avatarUrl,
        email: discordUser.email ?? null,
        accessTokenEncrypted: encryptSecret(tokenPayload.access_token),
        refreshTokenEncrypted: tokenPayload.refresh_token
          ? encryptSecret(tokenPayload.refresh_token)
          : null,
        tokenExpiresAt,
        scopes,
      },
      create: {
        userId: user.id,
        discordId: discordUser.id,
        username: discordUser.username,
        globalName: discordUser.global_name ?? null,
        avatar: avatarUrl,
        email: discordUser.email ?? null,
        accessTokenEncrypted: encryptSecret(tokenPayload.access_token),
        refreshTokenEncrypted: tokenPayload.refresh_token
          ? encryptSecret(tokenPayload.refresh_token)
          : null,
        tokenExpiresAt,
        scopes,
      },
    });

    const ipAddress =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      null;
    const userAgent = (request.headers['user-agent'] as string) || null;

    // Create secure session
    const rawSessionToken = generateSecureToken(32);
    const csrfToken = generateSecureToken(16);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);

    await prisma.session.create({
      data: {
        tokenHash: hashToken(rawSessionToken),
        userId: user.id,
        csrfToken,
        ipAddress,
        userAgent,
        expiresAt,
      },
    });

    const userPublicId = formatEntityPublicId('usr', user.id, user.publicId);

    // Dispatch single, fail-safe Discord Login DM Notification and capture real delivery status
    const dmResult = await sendDiscordLoginNotification({
      callbackKey: stateHash,
      discordId: user.discordId,
      username: user.username,
      displayName: user.displayName,
      userPublicId,
      ipAddress,
      locale: activeLocale,
      timestamp: new Date(),
    });

    completedOAuthStates.set(stateHash, {
      rawSessionToken,
      timestamp: Date.now(),
      dmResult,
    });

    await recordActivityLog({
      userId: user.id,
      action: isNewUser
        ? 'Registered & Authenticated via Discord OAuth2'
        : 'Authenticated via Discord OAuth2',
      metadata: {
        discordId: user.discordId,
        username: user.username,
        isNewUser,
        discordLoginDmSent: dmResult.ok,
        discordLoginDmReason: dmResult.ok ? null : dmResult.reason,
      },
      request,
    });

    reply.clearCookie(OAUTH_STATE_COOKIE, getSessionCookieOptions(request));
    reply.clearCookie(OAUTH_LOCALE_COOKIE, getSessionCookieOptions(request));
    reply.setCookie(
      SESSION_COOKIE_NAME,
      rawSessionToken,
      getSessionCookieOptions(request)
    );

    buildCallbackSuccessHtml(reply, dmResult);
  };

  app.get('/api/auth/discord/callback', handleCallback);
  app.get('/api/auth/discord/callback/', handleCallback);
  app.get('/auth/callback', handleCallback);
  app.get('/auth/callback/', handleCallback);

  // Current authenticated session inspection (never triggers DM notification)
  app.get('/api/auth/me', async (request) => {
    const dbHealth = await checkDatabaseHealth();
    if (!dbHealth.connected) {
      return {
        success: true,
        data: {
          authenticated: false,
          user: null,
          oauthConfigured: isDiscordOAuthConfigured(),
          loginNotificationConfigured: isDiscordLoginNotificationConfigured(),
          databaseConnected: false,
        },
      };
    }

    const ctx = await resolveAuthContext(request);
    if (!ctx) {
      return {
        success: true,
        data: {
          authenticated: false,
          user: null,
          oauthConfigured: isDiscordOAuthConfigured(),
          loginNotificationConfigured: isDiscordLoginNotificationConfigured(),
          databaseConnected: true,
        },
      };
    }

    const prisma = getPrismaOrThrow();
    const [hostCount, latestLoginLog] = await Promise.all([
      prisma.host.count({
        where: { ownerId: ctx.user.id },
      }),
      prisma.activityLog.findFirst({
        where: {
          userId: ctx.user.id,
          action: {
            contains: 'Discord OAuth2',
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const loginMeta = (latestLoginLog?.metadata as Record<string, unknown> | null) ?? null;
    const lastLoginNotification = loginMeta
      ? {
          sent: loginMeta.discordLoginDmSent === true,
          reason:
            loginMeta.discordLoginDmSent === true
              ? null
              : typeof loginMeta.discordLoginDmReason === 'string'
              ? loginMeta.discordLoginDmReason
              : 'DISCORD_API_ERROR',
        }
      : null;

    return {
      success: true,
      data: {
        authenticated: true,
        oauthConfigured: isDiscordOAuthConfigured(),
        loginNotificationConfigured: isDiscordLoginNotificationConfigured(),
        databaseConnected: true,
        csrfToken: ctx.session.csrfToken,
        lastLoginNotification,
        user: {
          id: ctx.user.id,
          publicId: formatEntityPublicId('usr', ctx.user.id, ctx.user.publicId),
          discordId: ctx.user.discordId,
          username: ctx.user.username,
          displayName: ctx.user.displayName,
          avatar: ctx.user.avatar,
          role: ctx.user.role,
          createdAt: ctx.user.createdAt.toISOString(),
          updatedAt: ctx.user.updatedAt.toISOString(),
          hostCount,
          maxHosts: MAX_HOSTS_PER_USER,
        },
      },
    };
  });

  // Logout
  app.post('/api/auth/logout', async (request, reply) => {
    const dbHealth = await checkDatabaseHealth();
    if (dbHealth.connected) {
      const ctx = await resolveAuthContext(request);
      if (ctx) {
        const prisma = getPrismaOrThrow();
        await prisma.session.update({
          where: { id: ctx.session.id },
          data: { revokedAt: new Date() },
        });
        await recordActivityLog({
          userId: ctx.user.id,
          action: 'Signed out of Session',
          request,
        });
      }
    }

    clearSessionCookie(reply, request);
    return {
      success: true,
      data: { signedOut: true },
    };
  });

  // Manual Retry for Discord Login DM (rate-limited, non-blocking, safe)
  app.post('/api/notifications/retry-login-dm', async (request) => {
    const ctx = await resolveAuthContext(request);
    if (!ctx) {
      throw new AppError(
        'AUTHENTICATION_REQUIRED',
        'You must be signed in to retry notifications.',
        401
      );
    }

    const { canRetryNotification, recordRetryAttempt } = await import('../discord-notify');
    const retryKey = `user_login:${ctx.user.id}`;
    const check = canRetryNotification(retryKey);
    if (!check.allowed) {
      throw new AppError(
        'RETRY_RATE_LIMITED',
        `Please wait ${check.waitSeconds}s before retrying notification.`,
        429
      );
    }
    recordRetryAttempt(retryKey);

    const userPublicId = formatEntityPublicId('usr', ctx.user.id, ctx.user.publicId);
    const ipAddress =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      null;

    const dmResult = await sendDiscordLoginNotification(
      {
        callbackKey: `retry_${ctx.user.id}_${Date.now()}`,
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        displayName: ctx.user.displayName,
        userPublicId,
        ipAddress,
        locale: resolveRequestedLocale(request),
        timestamp: new Date(),
      },
      true
    );

    await recordActivityLog({
      userId: ctx.user.id,
      action: 'Retried Discord Login DM Notification',
      metadata: {
        sent: dmResult.ok,
        reason: dmResult.ok ? null : dmResult.reason,
        statusCode: dmResult.ok ? 200 : (dmResult as any).statusCode ?? null,
        discordErrorCode: dmResult.ok ? null : (dmResult as any).discordErrorCode ?? null,
      },
      request,
    });

    return {
      success: true,
      data: {
        sent: dmResult.ok,
        reason: dmResult.ok ? null : dmResult.reason,
        statusCode: dmResult.ok ? 200 : (dmResult as any).statusCode ?? null,
        discordErrorCode: dmResult.ok ? null : (dmResult as any).discordErrorCode ?? null,
      },
    };
  });
}

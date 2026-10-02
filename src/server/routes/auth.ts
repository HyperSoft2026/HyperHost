import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  config,
  getDiscordRedirectUriOrNull,
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
import { MAX_HOSTS_PER_USER } from '../../shared/types';

const OAUTH_STATE_COOKIE = 'hyperhost_oauth_state';

function buildDiscordAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: config.discord.clientId!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify email',
    state,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
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

    const state = generateSecureToken(16);

    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      ...getSessionCookieOptions(request),
      maxAge: 60 * 10,
    });

    return {
      success: true,
      data: {
        url: buildDiscordAuthorizeUrl(state, redirectUri),
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

    const state = generateSecureToken(16);

    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      ...getSessionCookieOptions(request),
      maxAge: 60 * 10,
    });

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
    if (!storedState || !query.state || storedState !== query.state) {
      throw new AppError(
        'INVALID_OAUTH_STATE',
        'OAuth2 state parameter missing or mismatched (CSRF protection triggered).',
        400
      );
    }

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

    const user = await prisma.user.upsert({
      where: { discordId: discordUser.id },
      update: {
        username: discordUser.username,
        displayName,
        avatar: avatarUrl,
        email: discordUser.email ?? null,
      },
      create: {
        discordId: discordUser.id,
        username: discordUser.username,
        displayName,
        avatar: avatarUrl,
        email: discordUser.email ?? null,
        role: 'USER',
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

    // Create secure session
    const rawSessionToken = generateSecureToken(32);
    const csrfToken = generateSecureToken(16);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);

    await prisma.session.create({
      data: {
        tokenHash: hashToken(rawSessionToken),
        userId: user.id,
        csrfToken,
        ipAddress:
          (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          request.ip ||
          null,
        userAgent: (request.headers['user-agent'] as string) || null,
        expiresAt,
      },
    });

    await recordActivityLog({
      userId: user.id,
      action: 'Authenticated via Discord OAuth2',
      metadata: {
        discordId: user.discordId,
        username: user.username,
      },
      request,
    });

    reply.clearCookie(OAUTH_STATE_COOKIE, getSessionCookieOptions(request));
    reply.setCookie(
      SESSION_COOKIE_NAME,
      rawSessionToken,
      getSessionCookieOptions(request)
    );

    reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>HyperHost Authentication</title>
  </head>
  <body style="background:#090A10;color:#F8FAFC;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
    <p>Authentication complete. Redirecting to HyperHost Control Plane...</p>
  </body>
</html>`);
  };

  app.get('/api/auth/discord/callback', handleCallback);
  app.get('/api/auth/discord/callback/', handleCallback);
  app.get('/auth/callback', handleCallback);
  app.get('/auth/callback/', handleCallback);

  // Current authenticated session inspection
  app.get('/api/auth/me', async (request) => {
    const dbHealth = await checkDatabaseHealth();
    if (!dbHealth.connected) {
      return {
        success: true,
        data: {
          authenticated: false,
          user: null,
          oauthConfigured: isDiscordOAuthConfigured(),
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
          databaseConnected: true,
        },
      };
    }

    const prisma = getPrismaOrThrow();
    const hostCount = await prisma.host.count({
      where: { ownerId: ctx.user.id },
    });

    return {
      success: true,
      data: {
        authenticated: true,
        oauthConfigured: isDiscordOAuthConfigured(),
        databaseConnected: true,
        csrfToken: ctx.session.csrfToken,
        user: {
          id: ctx.user.id,
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
}

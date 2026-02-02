import prisma from '../lib/prisma';

export interface GoogleOAuthTokenData {
  serviceName: string;
  refreshToken: string;
  accessToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
}

/**
 * Gets the Google OAuth token for a specific service from the database
 */
export async function getGoogleOAuthToken(
  serviceName: string,
): Promise<GoogleOAuthTokenData | null> {
  const delegate =
    (prisma as any).googleOAuthToken ?? prisma.googleOAuthToken;
  const token = await delegate.findUnique({
    where: { serviceName },
  });

  if (!token) {
    return null;
  }

  return {
    serviceName: token.serviceName,
    refreshToken: token.refreshToken,
    accessToken: token.accessToken,
    expiresAt: token.expiresAt,
    scope: token.scope,
  };
}

/**
 * Saves or updates a Google OAuth token in the database
 */
export async function saveGoogleOAuthToken(
  data: GoogleOAuthTokenData,
): Promise<void> {
  const delegate =
    (prisma as any).googleOAuthToken ?? prisma.googleOAuthToken;
  await delegate.upsert({
    where: { serviceName: data.serviceName },
    create: {
      serviceName: data.serviceName,
      refreshToken: data.refreshToken,
      accessToken: data.accessToken,
      expiresAt: data.expiresAt,
      scope: data.scope,
    },
    update: {
      refreshToken: data.refreshToken,
      accessToken: data.accessToken,
      expiresAt: data.expiresAt,
      scope: data.scope,
    },
  });
}

/**
 * Updates only the access token and expiry for a service
 */
export async function updateGoogleAccessToken(
  serviceName: string,
  accessToken: string,
  expiresAt?: Date,
): Promise<void> {
  const delegate =
    (prisma as any).googleOAuthToken ?? prisma.googleOAuthToken;
  await delegate.update({
    where: { serviceName },
    data: {
      accessToken,
      expiresAt,
    },
  });
}

/**
 * Deletes a Google OAuth token from the database
 */
export async function deleteGoogleOAuthToken(
  serviceName: string,
): Promise<void> {
  const delegate =
    (prisma as any).googleOAuthToken ?? prisma.googleOAuthToken;
  await delegate.delete({
    where: { serviceName },
  });
}

/**
 * Checks if a token exists for a service
 */
export async function hasGoogleOAuthToken(
  serviceName: string,
): Promise<boolean> {
  const token = await getGoogleOAuthToken(serviceName);
  return token !== null;
}

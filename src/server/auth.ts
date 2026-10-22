import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { Role, User } from '@prisma/client';
import { prisma } from './prisma.js';
import { sendWelcomeEmail } from './mailer.js';
import { tenantLoginEnabled } from './features.js';

export interface AuthedRequest extends Request {
  firebaseUser?: { uid: string; email: string | null; displayName: string | null };
  profile?: User;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const idToken = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!idToken) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    // Invites are matched by e-mail, so the token's e-mail must be proven. Google Sign-In
    // always sets this; it only fails for e-mail/password accounts that skipped verification,
    // which would otherwise let anyone claim an invite just by typing the invited address.
    if (decoded.email_verified !== true) {
      res.status(403).json({ error: 'E-mail não verificado. Entre com uma conta Google.' });
      return;
    }
    req.firebaseUser = {
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: (decoded.name as string | undefined) ?? null,
    };
    next();
  } catch (error) {
    console.error('Failed to verify Firebase ID token:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Every authenticated request needs the caller's profile (for role checks), which would
// otherwise mean a Postgres round-trip on top of the route's own query for every single
// API call. Profiles change rarely, so a short-lived in-memory cache avoids that — safe
// because this runs as a single Node process, not multiple instances behind a load balancer.
const PROFILE_CACHE_TTL_MS = 30_000;
const ACCESS_DISABLED_MESSAGE = 'Seu acesso foi desativado. Entre em contato com um administrador.';
const TENANT_LOGIN_UNAVAILABLE_MESSAGE = 'O acesso de inquilinos à plataforma ainda não está disponível.';

// Why this profile can't use the app right now, or null if it can. Applied to cached and
// freshly-loaded profiles alike so flipping a flag takes effect within the cache TTL.
function accessDeniedMessage(profile: Pick<User, 'disabled' | 'role'>): string | null {
  if (profile.disabled) return ACCESS_DISABLED_MESSAGE;
  if (profile.role === 'tenant' && !tenantLoginEnabled()) return TENANT_LOGIN_UNAVAILABLE_MESSAGE;
  return null;
}
const profileCache = new Map<string, { profile: User; expiresAt: number }>();

export function invalidateProfileCache(uid: string) {
  profileCache.delete(uid);
}

// Loads (or bootstraps) the caller's Postgres profile. Mirrors the logic that used to live in
// useAuth.tsx: migrate a pre-registered invite by email. Anyone without a matching invite is
// rejected — access is invite-only, there is no self-serve tenant signup.
export async function loadProfile(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.firebaseUser) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { uid, email, displayName } = req.firebaseUser;
  const normalizedEmail = (email ?? '').toLowerCase();

  const cached = profileCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) {
    const deniedMessage = accessDeniedMessage(cached.profile);
    if (deniedMessage) {
      res.status(403).json({ error: deniedMessage });
      return;
    }
    req.profile = cached.profile;
    next();
    return;
  }

  let profile = await prisma.user.findUnique({ where: { id: uid } });

  if (!profile) {
    const preRegistration = normalizedEmail
      ? await prisma.user.findFirst({ where: { email: normalizedEmail, isInvite: true } })
      : null;

    if (!preRegistration) {
      res.status(403).json({ error: 'Nenhum convite encontrado para este e-mail. Solicite acesso a um administrador.' });
      return;
    }

    // Checked before migrating so the invite stays pending (and no welcome email goes out)
    // until tenant login is turned on.
    const preRegistrationDenied = accessDeniedMessage(preRegistration);
    if (preRegistrationDenied) {
      res.status(403).json({ error: preRegistrationDenied });
      return;
    }

    // The invite and the real profile share the same (unique) e-mail, and rows created
    // for the invite (properties, contracts, payments) point at its placeholder id — so the
    // invite's e-mail is freed first and its references are repointed before it's deleted.
    profile = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: preRegistration.id },
        data: { email: `migrating+${preRegistration.id}@invalid.local` },
      });
      const migrated = await tx.user.create({
        data: {
          id: uid,
          email: normalizedEmail,
          displayName: displayName || preRegistration.displayName,
          role: preRegistration.role,
          phone: preRegistration.phone,
          cpf: preRegistration.cpf,
          address: preRegistration.address,
          themePreference: preRegistration.themePreference,
        },
      });
      const from = preRegistration.id;
      await tx.property.updateMany({ where: { ownerUid: from }, data: { ownerUid: uid } });
      await tx.contract.updateMany({ where: { landlordUid: from }, data: { landlordUid: uid } });
      await tx.contract.updateMany({ where: { tenantUid: from }, data: { tenantUid: uid } });
      await tx.payment.updateMany({ where: { tenantUid: from }, data: { tenantUid: uid } });
      await tx.user.delete({ where: { id: from } });
      return migrated;
    });

    if (normalizedEmail) {
      sendWelcomeEmail(normalizedEmail, displayName || '').catch((error) => {
        console.error('Failed to send welcome email:', error);
      });
    }
  }

  const deniedMessage = accessDeniedMessage(profile);
  if (deniedMessage) {
    res.status(403).json({ error: deniedMessage });
    return;
  }

  req.profile = profile;
  profileCache.set(uid, { profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.profile || !roles.includes(req.profile.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

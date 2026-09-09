import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { Role, User } from '@prisma/client';
import { prisma } from './prisma';
import { sendWelcomeEmail } from './mailer';

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

// Loads (or bootstraps) the caller's Postgres profile. Mirrors the logic that used to live in
// useAuth.tsx: migrate a pre-registered invite by email, or create a default tenant profile.
export async function loadProfile(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.firebaseUser) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { uid, email, displayName } = req.firebaseUser;
  const normalizedEmail = (email ?? '').toLowerCase();

  let profile = await prisma.user.findUnique({ where: { id: uid } });

  if (!profile) {
    const preRegistration = normalizedEmail
      ? await prisma.user.findFirst({ where: { email: normalizedEmail, isInvite: true } })
      : null;

    if (preRegistration) {
      profile = await prisma.$transaction(async (tx) => {
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
        await tx.user.delete({ where: { id: preRegistration.id } });
        return migrated;
      });
    } else {
      profile = await prisma.user.create({
        data: {
          id: uid,
          email: normalizedEmail,
          displayName: displayName || '',
          role: 'tenant',
        },
      });

      if (normalizedEmail) {
        sendWelcomeEmail(normalizedEmail, displayName || '').catch((error) => {
          console.error('Failed to send welcome email:', error);
        });
      }
    }
  }

  req.profile = profile;
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

import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config';
import User from '../models/user';
import CreditTransaction from '../models/creditTransaction';

// Every new account starts with this many free credits (pinned business rule).
const SIGNUP_FREE_CREDITS = 3;

async function login(req: Request, res: Response): Promise<any> {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const user = await User.getUserByEmail(email);
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, tenantId: user.tenantId, isAdmin: user.isAdmin === true },
      config.jwtSecret,
      { expiresIn: '7d' },
    );

    const { password: _password, ...safeUser } = user;
    return res.json({ user: safeUser, token });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ message: 'Login failed' });
  }
}

async function signup(req: Request, res: Response): Promise<any> {
  const { email, password, displayName } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  if (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 60) {
    return res.status(400).json({ message: 'Display name must be between 2 and 60 characters' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }

  try {
    const existingUser = await User.getUserByEmail(email);
    if (existingUser) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    // tenantId: in the MVP generator, override this with the project's tenant identifier.
    // Default: 'default' for single-tenant use. Extend by reading from req.headers['x-tenant-id'].
    const tenantId = (req.headers['x-tenant-id'] as string) ?? 'default';

    const user = await User.createUser({
      email,
      password: hashedPassword,
      tenantId,
      displayName: displayName.trim(),
    });

    // Free starting credits, recorded as a signup_grant transaction (pinned rule).
    await CreditTransaction.grant({
      userId: user.id,
      tenantId,
      amount: SIGNUP_FREE_CREDITS,
      type: 'signup_grant',
      description: 'Free credits for signing up',
    });
    const freshUser = await User.getUserById(user.id);

    const token = jwt.sign(
      { id: user.id, email: user.email, tenantId: user.tenantId, isAdmin: user.isAdmin === true },
      config.jwtSecret,
      { expiresIn: '7d' },
    );

    const { password: _password, ...safeUser } = freshUser ?? user;
    return res.json({ user: safeUser, token });
  } catch (error) {
    console.error('Error during signup:', error);
    return res.status(500).json({ message: 'Registration failed' });
  }
}

// Change the authenticated user's password. Requires the current password.
// Mounted behind jwtCheck, so req.user.id is the actor.
async function changePassword(req: Request, res: Response): Promise<any> {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters' });
  }

  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    const user = await User.getUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isCurrentValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentValid) return res.status(400).json({ message: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.updatePassword(user.id, hashed);
    return res.json({ message: 'Password updated' });
  } catch (error) {
    console.error('Error during change-password:', error);
    return res.status(500).json({ message: 'Password change failed' });
  }
}

// Self-service account deletion. Requires a valid JWT (middleware.jwtCheck);
// removes the actor's own credit history and enhancement requests, then the
// user row itself. No admin path exists to delete another account — this is
// the only delete capability by design, and the one verify/smoke-test.sh uses
// to remove its own fixtures via the API instead of touching the DB directly.
async function deleteMe(req: Request, res: Response): Promise<any> {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    await User.deleteUser(req.user.id);
    return res.status(200).json({ message: 'Account deleted' });
  } catch (error) {
    console.error('Error deleting account:', error);
    return res.status(500).json({ message: 'Could not delete account' });
  }
}

export default { login, signup, changePassword, deleteMe };

import { createClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "@creavate/shared";
import { config, required } from "./config.js";
import { ensureUser, one } from "./db.js";
export interface AuthRequest extends Request {
  creator?: { id: string; email: string };
}
export async function authenticate(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new AppError(401, "Sign in to continue");
    if (!config.CREATOR_EMAIL && !config.CREATOR_AUTH_USER_ID)
      throw new AppError(
        503,
        "Configure the creator email before connecting accounts",
      );
    const client = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_PUBLISHABLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user?.email || !data.user.email_confirmed_at)
      throw new AppError(401, "A verified account is required");
    if (
      config.CREATOR_EMAIL &&
      data.user.email.toLowerCase() !== config.CREATOR_EMAIL.toLowerCase()
    )
      throw new AppError(403, "This deployment belongs to another creator");
    if (
      config.CREATOR_AUTH_USER_ID &&
      data.user.id !== config.CREATOR_AUTH_USER_ID
    )
      throw new AppError(403, "This deployment belongs to another creator");
    req.creator = { id: data.user.id, email: data.user.email };
    await ensureUser(data.user.id, data.user.email);
    next();
  } catch (e) {
    next(e);
  }
}
export function creator(req: Request) {
  const value = (req as AuthRequest).creator;
  if (!value) throw new AppError(401, "Authentication required");
  return value;
}
export async function owner() {
  if (config.CREATOR_AUTH_USER_ID)
    return one("select * from users where id=$1", [
      config.CREATOR_AUTH_USER_ID,
    ]);
  if (config.CREATOR_EMAIL)
    return one("select * from users where lower(email)=lower($1)", [
      config.CREATOR_EMAIL,
    ]);
  throw new AppError(
    503,
    "Set CREATOR_EMAIL before starting the single-creator agent host",
  );
}

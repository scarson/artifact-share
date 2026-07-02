import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { parseKeyRing, signSession, verifySession } from "../crypto/tokens";

const NAME = "admin_session";
const TTL_SEC = 7 * 24 * 60 * 60; // 7 days (spec §8)

export async function startSession(c: Context, sessionSecret: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const token = await signSession(parseKeyRing(sessionSecret), exp); // exp signed; jose enforces it
  setCookie(c, NAME, token, {
    httpOnly: true, secure: true, sameSite: "Strict", path: "/", expires: new Date(exp * 1000),
  });
}

export async function isAuthed(c: Context, sessionSecret: string): Promise<boolean> {
  const t = getCookie(c, NAME);
  return t ? await verifySession(t, parseKeyRing(sessionSecret)) : false;
}

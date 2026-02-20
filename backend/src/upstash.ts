import { Redis } from '@upstash/redis';

// Initialize from environment as requested
export const redis = Redis.fromEnv();

function isoWeekKey(d = new Date()) {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`;
}

export async function setPaid(tokenKey: string) {
  try {
    await redis.set(`paid:${tokenKey}`, '1');
    await redis.expire(`paid:${tokenKey}`, 60 * 60 * 24 * 365);
    return true;
  } catch (e) {
    console.warn('setPaid failed', e);
    return false;
  }
}

export async function isPaid(tokenKey: string) {
  try {
    const v = await redis.get(`paid:${tokenKey}`);
    return String(v) === '1';
  } catch (e) {
    console.warn('isPaid failed', e);
    return false;
  }
}

export { isoWeekKey };

export async function unsetPaid(tokenKey: string) {
  try {
    await redis.del(`paid:${tokenKey}`);
    return true;
  } catch (e) {
    console.warn('unsetPaid failed', e);
    return false;
  }
}

export async function consumeWeekly(tokenKey: string, limit = 3) {
  try {
    const week = isoWeekKey();
    const k = `usage:${tokenKey}:${week}`;
    // increment
    const usedRaw: any = await (redis as any).incr(k);
    const used = Number(usedRaw ?? 0);
    if (used === 1) {
      try {
        await (redis as any).expire(k, 60 * 60 * 24 * 8);
      } catch (e) {
        // ignore
      }
    }
    const allowed = used <= limit;
    const remaining = Math.max(0, limit - used);
    return { used, remaining, allowed };
  } catch (e) {
    console.warn('consumeWeekly failed', e);
    return { used: 0, remaining: 0, allowed: false };
  }
}

// Keep existing-compatible helpers for other modules in the repo
export async function getWeeklyUsage(tokenKey: string) {
  try {
    const week = isoWeekKey();
    const k = `usage:${tokenKey}:${week}`;
    const v: any = await redis.get(k);
    return Number(v ?? 0);
  } catch (e) {
    console.warn('getWeeklyUsage failed', e);
    return null;
  }
}

export async function incrementWeeklyUsage(tokenKey: string, by = 1) {
  try {
    const week = isoWeekKey();
    const k = `usage:${tokenKey}:${week}`;
    // prefer incrby if available
    const n: any = typeof (redis as any).incrby === 'function' ? await (redis as any).incrby(k, by) : await (redis as any).incr(k);
    try {
      await (redis as any).expire(k, 60 * 60 * 24 * 30);
    } catch (e) {
      // ignore
    }
    return Number(n ?? 0);
  } catch (e) {
    console.warn('incrementWeeklyUsage failed', e);
    return null;
  }
}

export async function markTokenPaid(tokenKey: string) {
  return setPaid(tokenKey);
}

export async function isTokenPaid(tokenKey: string) {
  return isPaid(tokenKey);
}

export default redis;

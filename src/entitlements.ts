type Ent = {
  isPremium: boolean;
  plan: string | null;
  sparkDailyCount: number;
  sparkDailyDate: string; // YYYY-MM-DD
};

const store = new Map<string, Ent>();

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getEntitlements(uid: string) {
  if (!uid) return null;
  let e = store.get(uid);
  if (!e) {
    e = { isPremium: false, plan: null, sparkDailyCount: 0, sparkDailyDate: todayDate() };
    store.set(uid, e);
  }
  // reset daily if stale
  if (e.sparkDailyDate !== todayDate()) {
    e.sparkDailyDate = todayDate();
    e.sparkDailyCount = 0;
    store.set(uid, e);
  }
  return { ...e } as Ent;
}

export function setPremium(uid: string, isPremium: boolean, plan: string | null = null) {
  if (!uid) return null;
  const prev = store.get(uid) || { isPremium: false, plan: null, sparkDailyCount: 0, sparkDailyDate: todayDate() };
  const next = { ...prev, isPremium, plan };
  store.set(uid, next);
  return { ...next };
}

export function incrementSparkCount(uid: string, by = 1) {
  if (!uid) return null;
  const e = store.get(uid) || { isPremium: false, plan: null, sparkDailyCount: 0, sparkDailyDate: todayDate() };
  if (e.sparkDailyDate !== todayDate()) {
    e.sparkDailyDate = todayDate();
    e.sparkDailyCount = 0;
  }
  e.sparkDailyCount += by;
  store.set(uid, e);
  return { ...e };
}

export function getDailyRemaining(uid: string) {
  const e = getEntitlements(uid);
  if (!e) return { dailyLimit: 3, dailyUsed: 0, dailyRemaining: 3 };
  const limit = e.isPremium ? Infinity : 3;
  const used = e.sparkDailyCount || 0;
  return { dailyLimit: limit, dailyUsed: used, dailyRemaining: limit === Infinity ? Infinity : Math.max(0, limit - used) };
}

export function resetSparkDaily(uid: string) {
  const e = store.get(uid);
  if (!e) return null;
  e.sparkDailyDate = todayDate();
  e.sparkDailyCount = 0;
  store.set(uid, e);
  return { ...e };
}

// Expose store for potential DB swap
export const entitlementsStore = store;

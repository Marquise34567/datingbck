type Ent = {
  isPremium: boolean;
  plan: string | null;
  sparkDailyCount: number;
  sparkDailyDate: string; // YYYY-MM-DD
  conversationWeeklyCount?: number;
  conversationWeekStart?: string; // YYYY-MM-DD (week start)
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null; // ISO date
};

const store = new Map<string, Ent>();

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function weekStartDate() {
  const d = new Date();
  const day = d.getUTCDay();
  // get Monday as start of week (if Sunday (0), go back 6 days)
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return monday.toISOString().slice(0, 10);
}

export function getEntitlements(uid: string) {
  if (!uid) return null;
  let e = store.get(uid);
  if (!e) {
    e = { isPremium: false, plan: null, sparkDailyCount: 0, sparkDailyDate: todayDate(), conversationWeeklyCount: 0, conversationWeekStart: weekStartDate() };
    store.set(uid, e);
  }
  // reset daily if stale
  if (e.sparkDailyDate !== todayDate()) {
    e.sparkDailyDate = todayDate();
    e.sparkDailyCount = 0;
    store.set(uid, e);
  }
  // reset weekly if week start changed
  if ((e.conversationWeekStart || '') !== weekStartDate()) {
    e.conversationWeekStart = weekStartDate();
    e.conversationWeeklyCount = 0;
    store.set(uid, e);
  }
  return { ...e } as Ent;
}

export function setPremium(uid: string, isPremium: boolean, plan: string | null = null) {
  if (!uid) return null;
  const prev = store.get(uid) || { isPremium: false, plan: null, sparkDailyCount: 0, sparkDailyDate: todayDate(), conversationWeeklyCount: 0, conversationWeekStart: weekStartDate(), stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null };
  const next = { ...prev, isPremium, plan };
  store.set(uid, next);
  return { ...next };
}

export function incrementSparkCount(uid: string, by = 1) {
  if (!uid) return null;
  const e = store.get(uid) || { isPremium: false, plan: null, sparkDailyCount: 0, sparkDailyDate: todayDate(), conversationWeeklyCount: 0, conversationWeekStart: weekStartDate(), stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null };
  if (e.sparkDailyDate !== todayDate()) {
    e.sparkDailyDate = todayDate();
    e.sparkDailyCount = 0;
  }
  e.sparkDailyCount += by;
  store.set(uid, e);
  return { ...e };
}

export function incrementConversationCount(uid: string, by = 1) {
  if (!uid) return null;
  const e = store.get(uid) || { isPremium: false, plan: null, sparkDailyCount: 0, sparkDailyDate: todayDate(), conversationWeeklyCount: 0, conversationWeekStart: weekStartDate(), stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null };
  if ((e.conversationWeekStart || '') !== weekStartDate()) {
    e.conversationWeekStart = weekStartDate();
    e.conversationWeeklyCount = 0;
  }
  e.conversationWeeklyCount = (e.conversationWeeklyCount || 0) + by;
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

export function getWeeklyRemaining(uid: string) {
  const e = getEntitlements(uid);
  if (!e) return { weeklyLimit: 3, weeklyUsed: 0, weeklyRemaining: 3 };
  const limit = e.isPremium ? Infinity : 3;
  const used = e.conversationWeeklyCount || 0;
  return { weeklyLimit: limit, weeklyUsed: used, weeklyRemaining: limit === Infinity ? Infinity : Math.max(0, limit - used) };
}

export function resetSparkDaily(uid: string) {
  const e = store.get(uid);
  if (!e) return null;
  e.sparkDailyDate = todayDate();
  e.sparkDailyCount = 0;
  store.set(uid, e);
  return { ...e };
}

export function resetWeeklyConversations(uid: string) {
  const e = store.get(uid);
  if (!e) return null;
  e.conversationWeekStart = weekStartDate();
  e.conversationWeeklyCount = 0;
  store.set(uid, e);
  return { ...e };
}

export function updateStripeInfo(uid: string, opts: { customerId?: string | null; subscriptionId?: string | null; currentPeriodEnd?: string | null }) {
  if (!uid) return null;
  const e = store.get(uid) || { isPremium: false, plan: null, sparkDailyCount: 0, sparkDailyDate: todayDate(), stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null };
  if (opts.customerId !== undefined) e.stripeCustomerId = opts.customerId;
  if (opts.subscriptionId !== undefined) e.stripeSubscriptionId = opts.subscriptionId;
  if (opts.currentPeriodEnd !== undefined) e.currentPeriodEnd = opts.currentPeriodEnd;
  store.set(uid, e);
  return { ...e };
}

// Expose store for potential DB swap
export const entitlementsStore = store;

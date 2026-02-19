type Role = "user" | "coach";

export type Turn = { role: Role; text: string; ts: number };

const store = new Map<string, Turn[]>();
const metaStore = new Map<string, Record<string, any>>();

export type SessionMemory = {
  whoEndedIt?: string;
  why?: string;
  whatHappened?: string;
  userGoal?: string;
  wantsClosure?: boolean;
};

export function setSessionMemory(sessionId: string, partial: Partial<SessionMemory>) {
  const prev = (metaStore.get(sessionId) as SessionMemory) || {};
  const next = { ...prev, ...partial } as SessionMemory;
  metaStore.set(sessionId, next);
  return next;
}

export function getSessionMemory(sessionId: string): SessionMemory {
  return (metaStore.get(sessionId) as SessionMemory) || {};
}

export function getHistory(sessionId: string) {
  return store.get(sessionId) || [];
}

export function pushTurn(sessionId: string, turn: Turn, max = 10) {
  const arr = store.get(sessionId) || [];
  arr.push(turn);
  const trimmed = arr.slice(-max);
  store.set(sessionId, trimmed);
  return trimmed;
}

export function getLastCoachLine(sessionId: string) {
  const arr = getHistory(sessionId);
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].role === "coach") return arr[i].text;
  }
  return "";
}

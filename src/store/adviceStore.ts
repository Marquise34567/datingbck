export interface Advice {
  id: string;
  author: string;
  text: string;
  tags?: string[];
  createdAt: string;
}

const store: Advice[] = [];

export function getAllAdvice(): Advice[] {
  return store;
}

export function addAdvice(data: { author: string; text: string; tags?: string[] }): Advice {
  const advice: Advice = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    ...data
  };
  store.push(advice);
  return advice;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

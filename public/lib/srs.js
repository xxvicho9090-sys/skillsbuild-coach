// Repetición espaciada con escalones fijos (en días).
import { S, save, logAct } from './store.js';

export const STEPS = [0, 1, 3, 7, 14, 30, 60];
const DAY = 86400000;

export const dueCards = (now = Date.now()) => S.cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);

// g: 0 otra vez · 1 difícil · 2 bien · 3 fácil
export function nextStep(step, g) {
  if (g === 0) return 0;
  if (g === 1) return Math.max(1, step);
  return Math.min(STEPS.length - 1, step + (g === 3 ? 2 : 1));
}

export function label(step, g) {
  if (g === 0) return '10 min';
  const d = STEPS[nextStep(step, g)];
  return d < 30 ? `${d} d` : `${Math.round(d / 30)} mes${d >= 60 ? 'es' : ''}`;
}

export function grade(card, g) {
  card.step = nextStep(card.step, g);
  card.due = g === 0 ? Date.now() + 10 * 60000 : Date.now() + STEPS[card.step] * DAY;
  card.last = Date.now();
  logAct(1, 'reviews');
}

export function removeCards(pred) {
  S.cards = S.cards.filter((c) => !pred(c));
  save();
}

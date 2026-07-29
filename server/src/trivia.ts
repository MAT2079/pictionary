import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import type { TriviaCard } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

let cards: TriviaCard[] = [];

export function loadTrivia(): void {
  const custom = join(DATA_DIR, 'trivia.yaml');
  const example = join(DATA_DIR, 'trivia.example.yaml');
  const path = existsSync(custom) ? custom : example;
  const raw = YAML.parse(readFileSync(path, 'utf8')) as { text: string; id?: string }[];
  cards = (raw ?? []).map((c) => ({ id: c.id ?? randomUUID(), text: String(c.text) }));
}

export function getTrivia(): TriviaCard[] {
  return cards;
}

export function setTrivia(next: TriviaCard[]): void {
  cards = next.map((c) => ({ id: c.id ?? randomUUID(), text: String(c.text) }));
}

export function addCard(text: string): TriviaCard {
  const card = { id: randomUUID(), text };
  cards.push(card);
  return card;
}

export function updateCard(id: string, text: string): TriviaCard | undefined {
  const c = cards.find((x) => x.id === id);
  if (c) c.text = text;
  return c;
}

export function removeCard(id: string): void {
  cards = cards.filter((c) => c.id !== id);
}

export function randomCard(): TriviaCard | undefined {
  if (cards.length === 0) return undefined;
  return cards[Math.floor(Math.random() * cards.length)];
}

import type { AgentConfig } from './config';
import type { State, Transcript } from './types';

export const terminalStates: State[] = ['COMPLETED', 'FAILED', 'OPTED_OUT', 'VOICEMAIL', 'NO_ANSWER', 'BUSY', 'CANCELED'];
const progression: Partial<Record<State, State[]>> = {
  INITIALIZING: ['CONNECTED'], CONNECTED: ['AI_DISCLOSURE'], AI_DISCLOSURE: ['GREETING'], GREETING: ['DISCOVERY'],
  DISCOVERY: ['QUALIFICATION', 'OFFERING_DEMO', 'SCHEDULING', 'FOLLOW_UP'], QUALIFICATION: ['DISCOVERY', 'OFFERING_DEMO', 'SCHEDULING', 'FOLLOW_UP'],
  OFFERING_DEMO: ['DISCOVERY', 'QUALIFICATION', 'FOLLOW_UP', 'SCHEDULING'], SCHEDULING: ['DISCOVERY', 'QUALIFICATION', 'FOLLOW_UP'],
  FOLLOW_UP: ['DISCOVERY', 'SCHEDULING'], HUMAN_HANDOFF: ['FOLLOW_UP'], COMPLETING: ['COMPLETED'],
};
export function canTransition(from: State, to: State) {
  if (from === to) return true;
  if (terminalStates.includes(from)) return false;
  if (['FAILED', 'OPTED_OUT', 'CANCELED', 'BUSY', 'NO_ANSWER', 'VOICEMAIL', 'HUMAN_HANDOFF', 'COMPLETING', 'COMPLETED'].includes(to)) return true;
  return !!progression[from]?.includes(to);
}
export function isOptOut(text: string) { return /\b(don['’]?t|do not|never|stop)\s+(?:ever\s+)?(?:call|contact|text|phone|calling|contacting|texting)\b|\b(remove me|take me off|unsubscribe|opt[ -]?out)\b/i.test(text); }
export function wantsHuman(text: string) { return /\b(real person|human|someone (?:real|from (?:your|the) team)|speak (?:to|with) (?:a |an )?(?:person|representative|agent))\b/i.test(text); }
export function insideCallingHours(config: Pick<AgentConfig, 'operatingHours'>, timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.find(p=>p.type==='weekday')?.value || '');
  const hour = Number(parts.find(p=>p.type==='hour')?.value);
  return config.operatingHours.days.includes(day) && hour >= config.operatingHours.start && hour < config.operatingHours.end;
}
export function confirmationEvidence(messages: Transcript[], id: string, topic: 'sms'|'booking', slotLabel?: string) {
  const index = messages.findIndex(m => m.id === id && m.role === 'user');
  if (index < 0 || messages.slice(index + 1).some(m => m.role === 'user')) return false;
  const caller = messages[index].text;
  if (/\b(no|not|don't|do not|cancel|maybe|wait)\b/i.test(caller)) return false;
  const previous = messages.slice(0,index).reverse().find(m=>m.role==='assistant');
  if (topic === 'sms' && /\b(send|text)\b.*\b(link|demo|message|follow.?up)\b/i.test(caller)) return true;
  if (!/\b(yes|yeah|yep|sure|confirm|please do|go ahead|that works|sounds good|okay|ok)\b/i.test(caller)) return false;
  if (!previous || previous.interrupted) return false;
  if (topic === 'sms') return /\b(text|sms)\b/i.test(previous.text) && /\b(send|may i|can i|would you|permission)\b/i.test(previous.text);
  return !!slotLabel && previous.text.includes(slotLabel) && /\b(book|confirm|reserve|schedule)\b/i.test(previous.text);
}

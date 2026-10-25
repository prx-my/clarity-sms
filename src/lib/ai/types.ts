import type { AgentConfig, WorkspaceConfig } from './config';
export type State = 'INITIALIZING'|'CONNECTED'|'AI_DISCLOSURE'|'GREETING'|'DISCOVERY'|'QUALIFICATION'|'OFFERING_DEMO'|'SCHEDULING'|'FOLLOW_UP'|'HUMAN_HANDOFF'|'COMPLETING'|'COMPLETED'|'FAILED'|'OPTED_OUT'|'VOICEMAIL'|'NO_ANSWER'|'BUSY'|'CANCELED';
export type Session = {
  id: string; agentId: string; contactId: string; callSid: string|null; direction: 'inbound'|'outbound'; phone: string;
  state: State; connectionStatus: string; startedAt: string|null; endedAt: string|null; createdAt: string;
  durationSeconds: number; relaySeconds: number; outcome: string|null; summary: string; simulation: boolean;
  agentSnapshot: AgentConfig; memory: Record<string, unknown>; cohort: string; experiment: string;
};
export type Transcript = { id: string; sessionId: string; role: 'user'|'assistant'; text: string; generatedText: string|null; interrupted: boolean; delivery: 'received'|'submitted'|'interrupted'; createdAt: string };
export type CallEvent = { id: string; sessionId: string; kind: string; data: Record<string,unknown>; createdAt: string };
export type ToolExecution = { id: string; sessionId: string; name: string; key: string; input: Record<string,unknown>; output: Record<string,unknown>|null; status: 'pending'|'succeeded'|'failed'|'unknown'; durationMs: number; createdAt: string };
export type Usage = { id: string; sessionId: string; key: string; category: string; model: string; quantity: string; unit: string; estimated: boolean; finalizedUsd: string|null; metadata: Record<string,unknown>; createdAt: string };
export type Rate = { id: string; provider: string; category: string; model: string; unit: string; usdPerUnit: string; effectiveAt: string; source: string; bundled: boolean; increment: number };
export type Lead = { id: string; phone: string; name: string|null; optedOut: boolean; details: Record<string,string>; consentAt: string|null; consentEvidence: string; timezone: string };
export type Qualification = { id: string; sessionId: string; contactId: string; outcome: string; summary: string; evidence: string[]; attributes: Record<string,string>; createdAt: string };
export type Snapshot = { session: Session; messages: Transcript[]; events: CallEvent[]; tools: ToolExecution[]; usage: Usage[]; qualifications: Qualification[] };
export type Settings = { id: string; config: WorkspaceConfig };
export interface VoiceTransport {
  text(token: string, last: boolean): void;
  end(reason: string): void;
  close(): void;
}

export type Contact = { id: string; phone: string; name: string | null; optedOut: boolean; createdAt?: string; lastActivityAt?: string | null };
export type Conversation = { id: string; contact: Contact; lastMessageAt: string; unreadCount: number; preview: string; status: string };
export type Message = { id: string; twilioSid: string | null; conversationId: string; direction: 'inbound'|'outbound'; body: string | null; fromNumber: string; toNumber: string; numSegments: number; mediaUrls: string[]; status: string; errorCode: string | null; createdAt: string; optimistic?: boolean };
export type MessageEvent = { id: string; messageSid: string; status: string; errorCode: string | null; createdAt: string };
export type Thread = { id: string; contact: Contact; unreadCount: number; status: string; messages: Message[]; events: MessageEvent[] };

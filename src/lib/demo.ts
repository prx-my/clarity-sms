import type { Contact, Conversation, Message, MessageEvent, Thread } from './types';
export const demoEnabled = () => process.env.DEMO_MODE === '1';
type DemoStore = { contacts: Contact[]; conversations: Conversation[]; messages: Message[]; events: MessageEvent[] };
declare global { var clarityDemoStore: DemoStore | undefined; }
const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
function initial(): DemoStore {
  const alex: Contact = { id:'11111111-1111-4111-8111-111111111111', name:'Alex Morgan', phone:'+14155550143', optedOut:false, createdAt:ago(1500) };
  const taylor: Contact = { id:'22222222-2222-4222-8222-222222222222', name:'Taylor Reed', phone:'+14155550145', optedOut:false, createdAt:ago(3000) };
  const jordan: Contact = { id:'33333333-3333-4333-8333-333333333333', name:'Jordan Lee', phone:'+14155550148', optedOut:true, createdAt:ago(6000) };
  const conversations: Conversation[] = [
    { id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', contact:alex, lastMessageAt:ago(4), unreadCount:1, preview:'Perfect, see you tomorrow!', status:'open' },
    { id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', contact:taylor, lastMessageAt:ago(80), unreadCount:0, preview:'Your appointment is confirmed.', status:'open' },
    { id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc', contact:jordan, lastMessageAt:ago(1440), unreadCount:0, preview:'STOP', status:'open' },
  ];
  const from = '+15550000000';
  const messages: Message[] = [
    { id:'m1',twilioSid:'SMDEMO001',conversationId:conversations[0].id,direction:'outbound',body:'Hi Alex, just checking in about our plans tomorrow.',fromNumber:from,toNumber:alex.phone,numSegments:1,mediaUrls:[],status:'delivered',errorCode:null,createdAt:ago(67) },
    { id:'m2',twilioSid:'SMDEMO002',conversationId:conversations[0].id,direction:'inbound',body:'Perfect, see you tomorrow!',fromNumber:alex.phone,toNumber:from,numSegments:1,mediaUrls:[],status:'received',errorCode:null,createdAt:ago(4) },
    { id:'m3',twilioSid:'SMDEMO003',conversationId:conversations[1].id,direction:'outbound',body:'Your appointment is confirmed for Friday at 2 PM.',fromNumber:from,toNumber:taylor.phone,numSegments:1,mediaUrls:[],status:'delivered',errorCode:null,createdAt:ago(100) },
    { id:'m4',twilioSid:'SMDEMO004',conversationId:conversations[2].id,direction:'outbound',body:'Thanks for speaking with us today.',fromNumber:from,toNumber:jordan.phone,numSegments:1,mediaUrls:[],status:'delivered',errorCode:null,createdAt:ago(1500) },
    { id:'m5',twilioSid:'SMDEMO005',conversationId:conversations[2].id,direction:'inbound',body:'STOP',fromNumber:jordan.phone,toNumber:from,numSegments:1,mediaUrls:[],status:'received',errorCode:null,createdAt:ago(1440) },
  ];
  const events: MessageEvent[] = [
    {id:'e1',messageSid:'SMDEMO001',status:'queued',errorCode:null,createdAt:ago(67)},
    {id:'e2',messageSid:'SMDEMO001',status:'sent',errorCode:null,createdAt:ago(66)},
    {id:'e3',messageSid:'SMDEMO001',status:'delivered',errorCode:null,createdAt:ago(65)},
    {id:'e4',messageSid:'SMDEMO003',status:'delivered',errorCode:null,createdAt:ago(99)},
    {id:'e5',messageSid:'SMDEMO004',status:'delivered',errorCode:null,createdAt:ago(1499)},
  ];
  return { contacts:[alex,taylor,jordan], conversations, messages, events };
}
export function demoStore() { return globalThis.clarityDemoStore ||= initial(); }
export function demoConversations(q: string) {
  const store=demoStore();
  return { items: store.conversations.filter(c=>c.status==='open' && (!q || `${c.contact.name||''} ${c.contact.phone}`.toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>new Date(b.lastMessageAt).getTime()-new Date(a.lastMessageAt).getTime()), nextCursor:null };
}
export function demoThread(id:string): Thread | null {
  const store=demoStore(), conversation=store.conversations.find(c=>c.id===id);
  if(!conversation)return null;
  return { id:conversation.id, contact:conversation.contact, unreadCount:conversation.unreadCount, status:conversation.status, messages:store.messages.filter(m=>m.conversationId===id).sort((a,b)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime()), events:store.events.filter(e=>store.messages.some(m=>m.conversationId===id&&m.twilioSid===e.messageSid)).sort((a,b)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime()) };
}
export function demoSend(to:string,body:string,name?:string) {
  const store=demoStore(); let contact=store.contacts.find(c=>c.phone===to);
  if(!contact){contact={id:crypto.randomUUID(),phone:to,name:name||null,optedOut:false,createdAt:new Date().toISOString()};store.contacts.push(contact)}
  if(contact.optedOut)return null;
  if(name)contact.name=name;
  let conversation=store.conversations.find(c=>c.contact.id===contact.id);
  if(!conversation){conversation={id:crypto.randomUUID(),contact,lastMessageAt:new Date().toISOString(),unreadCount:0,preview:'',status:'open'};store.conversations.push(conversation)}
  const sid=`SMDEMO${crypto.randomUUID().replaceAll('-','').slice(0,24).toUpperCase()}`;
  const message:Message={id:crypto.randomUUID(),twilioSid:sid,conversationId:conversation.id,direction:'outbound',body,fromNumber:'+15550000000',toNumber:to,numSegments:Math.max(1,Math.ceil(body.length>160?body.length/153:body.length/160)),mediaUrls:[],status:'queued',errorCode:null,createdAt:new Date().toISOString()};
  store.messages.push(message);conversation.preview=body;conversation.lastMessageAt=message.createdAt;conversation.status='open';
  store.events.push({id:crypto.randomUUID(),messageSid:sid,status:'queued',errorCode:null,createdAt:message.createdAt});
  setTimeout(()=>{message.status='sent';store.events.push({id:crypto.randomUUID(),messageSid:sid,status:'sent',errorCode:null,createdAt:new Date().toISOString()})},500);
  setTimeout(()=>{message.status='delivered';store.events.push({id:crypto.randomUUID(),messageSid:sid,status:'delivered',errorCode:null,createdAt:new Date().toISOString()})},1300);
  return {id:message.id,twilioSid:sid,status:'queued',conversationId:conversation.id};
}
export function demoAnalytics(){
  const store=demoStore(),sent=store.messages.filter(m=>m.direction==='outbound'),received=store.messages.filter(m=>m.direction==='inbound');
  const series=Array.from({length:30},(_,index)=>{const date=new Date();date.setDate(date.getDate()-29+index);const day=date.toISOString().slice(0,10);return {day,sent:sent.filter(m=>m.createdAt.slice(0,10)===day).length,received:received.filter(m=>m.createdAt.slice(0,10)===day).length}});
  const sentThreads=new Set(sent.map(m=>m.conversationId));
  const replied=new Set(received.filter(m=>sentThreads.has(m.conversationId)).map(m=>m.conversationId));
  return {sent:sent.length,delivered:sent.filter(m=>m.status==='delivered').length,failed:0,replyRate:sentThreads.size?Math.round(replied.size/sentThreads.size*100):0,series,failures:[]};
}

/* eslint-disable @next/next/no-img-element -- Twilio media URLs may expire or require authorization; optimization cannot proxy them reliably. */
'use client';
import { useState } from 'react';
import { format } from 'date-fns';
import { Check, CheckCheck, Clock3, CircleAlert, Paperclip } from 'lucide-react';
import { Tooltip } from './ui/primitives';
import { errorReason } from '@/lib/errors';
import type { Message } from '@/lib/types';
export function MessageBubble({ message, onTimeline, onRetry }: { message:Message; onTimeline:(message:Message)=>void; onRetry?:(message:Message)=>void }) { const outbound=message.direction==='outbound';const failed=message.status==='failed'||message.status==='undelivered';const Icon=failed?CircleAlert:message.status==='delivered'?CheckCheck:message.status==='sent'?Check:Clock3;return <div className={`message-row ${outbound?'outbound':''}`}><div className="bubble">{message.body}{message.mediaUrls.map((url,i)=><Media key={`${url}-${i}`} url={url}/>)}</div><div className={`message-meta ${failed?'failed':''}`}><span>{format(new Date(message.createdAt),'h:mm a')}</span>{outbound&&<><Tooltip content={failed?errorReason(message.errorCode):message.status}><button className="icon-button" style={{width:18,height:18}} onClick={()=>onTimeline(message)} aria-label={`View ${message.status} status timeline`}><Icon size={13}/></button></Tooltip>{failed&&onRetry&&<button style={{color:'var(--danger)',fontSize:11,textDecoration:'underline',background:'none',border:0}} onClick={()=>onRetry(message)}>Retry</button>}</>}</div></div> }
function Media({url}:{url:string}){const[failed,setFailed]=useState(false);return failed?<span className="media-fallback"><Paperclip size={13}/>Attachment unavailable</span>:<img className="media-thumb" src={url} alt="Message attachment" onError={()=>setFailed(true)}/>}

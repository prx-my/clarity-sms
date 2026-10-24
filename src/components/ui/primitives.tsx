'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as ScrollPrimitive from '@radix-ui/react-scroll-area';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary'|'secondary'|'ghost'|'danger'; size?: 'default'|'icon'|'sm' }>(function Button({ className, variant='secondary', size='default', ...props }, ref) { return <button ref={ref} className={cn('button', `button-${variant}`, `button-${size}`, className)} {...props}/>; });
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) { return <input ref={ref} className={cn('input', className)} {...props}/>; });
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) { return <textarea ref={ref} className={cn('textarea', className)} {...props}/>; });
export function Badge({ children, tone='neutral', className }: { children: React.ReactNode; tone?: 'neutral'|'success'|'warning'|'danger'; className?: string }) { return <span className={cn('badge', `badge-${tone}`, className)}>{children}</span>; }
export function Skeleton({ className }: { className?: string }) { return <div className={cn('skeleton',className)} aria-hidden/>; }
export function Avatar({ name }: { name: string }) { return <AvatarPrimitive.Root className="avatar"><AvatarPrimitive.Fallback delayMs={0}>{name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase()}</AvatarPrimitive.Fallback></AvatarPrimitive.Root>; }
export const Separator = SeparatorPrimitive.Root;
export function ScrollArea({ children, className }: { children: React.ReactNode; className?: string }) { return <ScrollPrimitive.Root className={cn('scroll-root',className)}><ScrollPrimitive.Viewport className="scroll-viewport">{children}</ScrollPrimitive.Viewport><ScrollPrimitive.Scrollbar orientation="vertical" className="scroll-bar"><ScrollPrimitive.Thumb className="scroll-thumb"/></ScrollPrimitive.Scrollbar></ScrollPrimitive.Root>; }
export function Tooltip({ content, children }: { content: string; children: React.ReactNode }) { return <TooltipPrimitive.Provider delayDuration={250}><TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="tooltip" sideOffset={5}>{content}<TooltipPrimitive.Arrow className="tooltip-arrow"/></TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root></TooltipPrimitive.Provider>; }
export function Dialog({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open:boolean)=>void; title: string; description?: string; children: React.ReactNode }) { return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-overlay"/><DialogPrimitive.Content className="dialog-content"><div className="dialog-heading"><div><DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>{description && <DialogPrimitive.Description className="dialog-description">{description}</DialogPrimitive.Description>}</div><DialogPrimitive.Close className="icon-button" aria-label="Close"><X size={18}/></DialogPrimitive.Close></div>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>; }
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;
export const DropdownContent = DropdownPrimitive.Content;
export const DropdownItem = DropdownPrimitive.Item;

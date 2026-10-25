// Twelve-place fixed point; decimal strings cross every database/API boundary.
export const SCALE=BigInt('1000000000000');
export function fixed(value:string):bigint {
  if(!/^-?\d{1,18}(\.\d{1,12})?$/.test(value))throw new Error('Invalid decimal');
  const negative=value.startsWith('-'),[w,f='']=value.replace(/^-/,'').split('.');const n=BigInt(w)*SCALE+BigInt(f.padEnd(12,'0'));return negative?-n:n;
}
export function money(n:bigint):string {const sign=n<BigInt(0)?'-':'';const a=n<BigInt(0)?-n:n;return `${sign}${a/SCALE}.${(a%SCALE).toString().padStart(12,'0')}`;}
export function multiply(a:string,b:string){return money(fixed(a)*fixed(b)/SCALE);}
export function divide(a:string,b:number){return b>0?money(fixed(a)*BigInt(1000000)/BigInt(Math.round(b*1000000))):null;}
export type PriceRate={id:string;amount:string;currency:string;unit:string;increment:number;bundled:boolean;source:string;effectiveAt:string};
export function price(quantity:string,unit:string,rate:PriceRate,bundled=false):string|null {
  if(bundled||rate.bundled)return money(BigInt(0));let q=fixed(quantity);if(q<BigInt(0))throw new Error('Negative usage');
  if(unit==='second'&&rate.unit==='minute'){const step=BigInt(rate.increment)*SCALE;q=(q+step-BigInt(1))/step*step;return money(q*fixed(rate.amount)/(SCALE*BigInt(60)));}
  if(unit!==rate.unit)return null;return money(q*fixed(rate.amount)/SCALE);
}
export function selectRate<T extends PriceRate & {provider:string;service:string;model:string}>(rates:T[],provider:string,service:string,model:string,at:string):T|null {
  return rates.filter(r=>r.provider===provider&&r.service===service&&r.model===model&&Date.parse(r.effectiveAt)<=Date.parse(at)).sort((a,b)=>Date.parse(b.effectiveAt)-Date.parse(a.effectiveAt))[0]||null;
}
// Twilio resource Price is a signed account debit. Keep raw signed price in
// the source event; normalize expense to positive and credits to negative.
export function twilioExpense(raw:string){return money(-fixed(raw));}

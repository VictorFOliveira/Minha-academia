import crypto from 'node:crypto';

const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer){
  let bits='',out='';
  for(const byte of buffer) bits+=byte.toString(2).padStart(8,'0');
  for(let i=0;i<bits.length;i+=5){
    const chunk=bits.slice(i,i+5).padEnd(5,'0');
    out+=alphabet[parseInt(chunk,2)];
  }
  return out;
}

export function base32Decode(value){
  const clean=String(value||'').toUpperCase().replace(/[^A-Z2-7]/g,'');
  let bits='';
  for(const ch of clean){
    const idx=alphabet.indexOf(ch);
    if(idx<0) continue;
    bits+=idx.toString(2).padStart(5,'0');
  }
  const bytes=[];
  for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
  return Buffer.from(bytes);
}

export function generateTotpSecret(){
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret,counter,digits=6){
  const key=base32Decode(secret);
  const buf=Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac=crypto.createHmac('sha1',key).update(buf).digest();
  const offset=hmac[hmac.length-1]&0x0f;
  const code=((hmac[offset]&0x7f)<<24)|((hmac[offset+1]&0xff)<<16)|((hmac[offset+2]&0xff)<<8)|(hmac[offset+3]&0xff);
  return String(code%(10**digits)).padStart(digits,'0');
}

export function totpCode(secret,time=Date.now(),step=30){
  return hotp(secret,Math.floor(time/1000/step));
}

export function verifyTotp(secret,code,{window=1,time=Date.now()}={}){
  const normalized=String(code||'').replace(/\D/g,'');
  if(normalized.length!==6) return false;
  const current=Math.floor(time/1000/30);
  for(let delta=-window;delta<=window;delta++){
    const expected=hotp(secret,current+delta);
    const a=Buffer.from(normalized),b=Buffer.from(expected);
    if(a.length===b.length && crypto.timingSafeEqual(a,b)) return true;
  }
  return false;
}

export function generateRecoveryCodes(count=8){
  return Array.from({length:count},()=>crypto.randomBytes(6).toString('hex').toUpperCase());
}

export function recoveryHash(code){
  return crypto.createHash('sha256').update(String(code||'').trim().toUpperCase()).digest('hex');
}

export function verifyRecoveryCode(code,hashes=[]){
  const target=recoveryHash(code);
  const index=(hashes||[]).findIndex(hash=>{
    try{
      const a=Buffer.from(target,'hex'),b=Buffer.from(String(hash),'hex');
      return a.length===b.length && crypto.timingSafeEqual(a,b);
    }catch{return false;}
  });
  return index;
}

export function otpauthUri({secret,email,issuer='Minha Academia'}){
  const label=encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

import { randomUUID,createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { opaqueToken } from '../../src/features/identity/crypto.ts';
import { currentTripPublicConfig,TRIP_PUBLIC_PHOTO } from '../../src/features/individual-trips/public-photo.ts';

vi.mock('node:fs',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs')>();
 return {...actual,readFileSync:vi.fn(actual.readFileSync)};
});
const workspace=randomUUID(),env={LS_IDENTITY_ENABLED:'true',LS_APP_ORIGIN:'https://life-skills.bneineviimacademy.org',LS_IDENTITY_WORKSPACE_ID:workspace,LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:opaqueToken()}),LS_IDENTITY_ACTIVE_KEY_ID:'synthetic',LS_IDENTITY_CSRF_KEY:opaqueToken(),LS_IDENTITY_LOOKUP_KEY:opaqueToken(),LS_IDENTITY_RATE_KEY:opaqueToken(),LS_INDIVIDUAL_TRIPS_ENABLED:'true',LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED:'true',LS_INDIVIDUAL_TRIPS_WORKSPACE_ID:workspace,LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID:randomUUID()};
afterEach(()=>vi.mocked(readFileSync).mockClear());
it('binds the actual public JPEG bytes and dimensions, without publishing private provenance',()=>{
 const bytes=readFileSync(join(process.cwd(),'public',TRIP_PUBLIC_PHOTO.src.slice(1))) as Buffer;
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(TRIP_PUBLIC_PHOTO.sha256);
 expect(bytes.length).toBe(505151); expect(bytes.subarray(0,2)).toEqual(Buffer.from([0xff,0xd8]));
 expect(bytes.includes(Buffer.from('Exif\0\0'))).toBe(false); expect(bytes.includes(Buffer.from('http://ns.adobe.com/xap/1.0/'))).toBe(false);
 const segments:{marker:number;data:Buffer}[]=[];
 for(let i=2;i<bytes.length;){
  if(bytes[i++]!==0xff)throw new Error('invalid JPEG segment');
  const marker=bytes[i++]!; if(marker===0xda||marker===0xd9)break;
  const length=bytes.readUInt16BE(i);segments.push({marker,data:bytes.subarray(i+2,i+length)});i+=length;
 }
 const frame=segments.find(segment=>segment.marker===0xc2)!;
 expect(frame.data.readUInt16BE(1)).toBe(TRIP_PUBLIC_PHOTO.height);expect(frame.data.readUInt16BE(3)).toBe(TRIP_PUBLIC_PHOTO.width);
 expect(segments.filter(segment=>segment.marker===0xe1||segment.marker===0xe2||segment.marker===0xfe)).toEqual([]);
 const en=currentTripPublicConfig('en',env)!,he=currentTripPublicConfig('he',env)!;
 expect(en.photo.src).toBe(env.LS_APP_ORIGIN+TRIP_PUBLIC_PHOTO.src);expect(he.publicUrl).toBe(env.LS_APP_ORIGIN+'/he/florida/trips');
 expect(he.photo.alt).not.toBe(en.photo.alt);expect(Object.keys(en.photo).sort()).toEqual(['alt','height','src','width']);
});
it('fails closed on unavailable or substituted export bytes before opening the route',()=>{
 vi.mocked(readFileSync).mockReturnValueOnce(Buffer.from('substituted image'));
 expect(currentTripPublicConfig('en',env)).toBeNull();
 vi.mocked(readFileSync).mockImplementationOnce(()=>{throw new Error('missing asset');});
 expect(currentTripPublicConfig('he',env)).toBeNull();
 expect(currentTripPublicConfig('en',env)).not.toBeNull();
});
it('public photo admission requires only its explicit release flag and verified public HTTPS origin, never private runtime keys',()=>{
 const publicOnly={LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED:'true',LS_APP_ORIGIN:env.LS_APP_ORIGIN};
 expect(currentTripPublicConfig('en',publicOnly)).not.toBeNull();
 for(const LS_APP_ORIGIN of ['http://life-skills.bneineviimacademy.org','https://foreign.invalid','https://life-skills.bneineviimacademy.org:8443','https://user:password@life-skills.bneineviimacademy.org','https://life-skills.bneineviimacademy.org/private','https://life-skills.bneineviimacademy.org?token=secret','https://life-skills.bneineviimacademy.org#private',' https://life-skills.bneineviimacademy.org'])expect(currentTripPublicConfig('en',{...publicOnly,LS_APP_ORIGIN})).toBeNull();
 expect(currentTripPublicConfig('en',{...publicOnly,LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED:'false'})).toBeNull();
});

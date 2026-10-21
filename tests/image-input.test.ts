import {describe,it,expect} from 'vitest';
import sharp from 'sharp';
import {prepareImage,ImageRejected,IMAGE_LIMITS} from '../src/inputs/image.js';

const solid=(width:number,height:number,format:'png'|'jpeg'|'webp'|'gif')=>sharp({create:{width,height,channels:3,background:{r:240,g:240,b:240}}})[format]().toBuffer();
const rejection=async(input:Buffer)=>{try{await prepareImage(input);}catch(error){if(error instanceof ImageRejected)return error.code;throw error;}return null;};

describe('prepareImage accepts exactly JPEG, PNG and WebP',()=>{
 it.each([['png','image/png'],['jpeg','image/jpeg'],['webp','image/webp']] as const)('accepts %s based on its content',async(format,mime)=>{
  const result=await prepareImage(await solid(320,200,format));
  expect(result).toMatchObject({mime,width:320,height:200});
  expect(Buffer.from(result.base64,'base64').length).toBe(result.bytes);
 });
 it.each([
  ['a GIF, even though it is a real image','gif'],
 ])('rejects %s',async()=>{
  expect(await rejection(await solid(100,100,'gif'))).toBe('unsupported_format');
 });
 it('rejects an SVG document',async()=>{
  expect(await rejection(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>'))).toBe('unsupported_format');
 });
 it.each([
  ['HTML pretending to be an image',Buffer.from('<html><script>alert(1)</script></html>')],
  ['random bytes',Buffer.from(Array.from({length:2048},(_,i)=>(i*37)%251))],
  ['an empty upload',Buffer.alloc(0)],
 ])('rejects %s',async(_name,bytes)=>{
  expect(['not_an_image','unsupported_format']).toContain(await rejection(bytes));
 });
 it('rejects a truncated image',async()=>{
  const png=await solid(400,400,'png');
  expect(await rejection(png.subarray(0,Math.floor(png.length/2)))).toBe('not_an_image');
 });
});

describe('prepareImage enforces documented limits',()=>{
 it('rejects uploads over the byte limit before decoding them',async()=>{
  expect(await rejection(Buffer.alloc(IMAGE_LIMITS.maxBytes+1,1))).toBe('too_large');
 });
 it('rejects images with too many pixels even when the file is small',async()=>{
  const wide=await sharp({create:{width:7000,height:5000,channels:3,background:{r:255,g:255,b:255}}}).png({compressionLevel:9}).toBuffer();
  expect(wide.length).toBeLessThan(IMAGE_LIMITS.maxBytes);
  expect(await rejection(wide)).toBe('too_many_pixels');
 });
 it('rejects images that are too small to contain readable text',async()=>{
  expect(await rejection(await solid(IMAGE_LIMITS.minEdge-1,200,'png'))).toBe('too_small');
 });
 it('downscales large images so cost and upload time stay bounded',async()=>{
  const result=await prepareImage(await solid(4000,3000,'jpeg'));
  expect(Math.max(result.width,result.height)).toBe(IMAGE_LIMITS.outputEdge);
  expect(result.width/result.height).toBeCloseTo(4/3,1);
 });
});

describe('prepareImage removes metadata',()=>{
 it('strips EXIF data such as copyright and GPS from the processed image',async()=>{
  const source=await sharp({create:{width:300,height:200,channels:3,background:'#ccc'}}).jpeg().withExif({IFD0:{Copyright:'Privat Max Mustermann'},IFD3:{GPSLatitudeRef:'N',GPSLatitude:'51/1 15/1 0/1'}}).toBuffer();
  expect((await sharp(source).metadata()).exif).toBeDefined();
  const processed=await prepareImage(source);
  const metadata=await sharp(Buffer.from(processed.base64,'base64')).metadata();
  expect(metadata.exif).toBeUndefined();
  expect(Buffer.from(processed.base64,'base64').toString('latin1')).not.toContain('Mustermann');
 });
 it('applies EXIF orientation before dropping it, so text is not rotated',async()=>{
  const source=await sharp({create:{width:300,height:100,channels:3,background:'#ccc'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const processed=await prepareImage(source);
  expect(processed).toMatchObject({width:100,height:300});
  expect((await sharp(Buffer.from(processed.base64,'base64')).metadata()).orientation).toBeUndefined();
 });
});

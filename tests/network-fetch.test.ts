import {describe,it,expect} from 'vitest';
import {isPublicAddress,decodeBody,safeFetchPage} from '../src/tools/network';

describe('NAT64 / DNS64 networks',()=>{
 it('accepts a synthesized 64:ff9b::/96 address when the embedded IPv4 address is public',()=>{
  expect(isPublicAddress('64:ff9b::808:808')).toBe(true);
 });
 it.each(['64:ff9b::7f00:1','64:ff9b::a00:1','64:ff9b::a9fe:a9fe','64:ff9b::c0a8:101','64:ff9b::0:0'])('still blocks %s because the embedded IPv4 address is not public',address=>{
  expect(isPublicAddress(address)).toBe(false);
 });
 it('does not extend the exception to the local-use prefix 64:ff9b:1::/48',()=>{
  expect(isPublicAddress('64:ff9b:1::808:808')).toBe(false);
 });
});

describe('response decoding',()=>{
 const latin1=Buffer.from('Grenzöffnung am 9. November','latin1');
 it('uses the charset from the Content-Type header',()=>{
  expect(decodeBody(latin1,'text/html; charset=ISO-8859-1')).toBe('Grenzöffnung am 9. November');
 });
 it('falls back to the charset declared in the HTML head',()=>{
  const html=Buffer.concat([Buffer.from('<html><head><meta charset="windows-1252"></head><body>Grenz','latin1'),Buffer.from('ö','latin1'),Buffer.from('ffnung</body></html>','latin1')]);
  expect(decodeBody(html,'text/html')).toContain('Grenzöffnung');
 });
 it('decodes UTF-8 by default and ignores unknown charset names',()=>{
  expect(decodeBody(Buffer.from('Größe','utf8'),'text/html')).toBe('Größe');
  expect(decodeBody(Buffer.from('Größe','utf8'),'text/html; charset=does-not-exist')).toBe('Größe');
 });
 it('extracts readable text from a page that is served as Latin-1',async()=>{
  const body=decodeBody(Buffer.from('<html><head><title>Mauerfall</title></head><body><main><p>Die Grenzöffnung war am 9. November 1989.</p></main></body></html>','latin1'),'text/html; charset=iso-8859-1');
  const page=await safeFetchPage('https://example.org/',new AbortController().signal,{resolve:async()=>[{address:'93.184.216.34',family:4}],request:async()=>({status:200,headers:{'content-type':'text/html'},body})});
  expect(page.text).toBe('Die Grenzöffnung war am 9. November 1989.');
 });
});

describe('text extraction',()=>{
 const fetchHtml=(body:string)=>safeFetchPage('https://example.org/',new AbortController().signal,{resolve:async()=>[{address:'93.184.216.34',family:4}],request:async()=>({status:200,headers:{'content-type':'text/html'},body})});
 it('drops navigation, citation markers and edit links but keeps article text and line breaks',async()=>{
  const page=await fetchHtml('<html><body><nav>Menü</nav><main><h1>Mauerfall</h1><p>Am 9. November 1989 fiel die Mauer.<sup class="reference">[1]</sup> <span class="mw-editsection">[Bearbeiten]</span></p><p>Zweiter Absatz.</p></main></body></html>');
  expect(page.text).toBe('Mauerfall\nAm 9. November 1989 fiel die Mauer.\nZweiter Absatz.');
 });
});

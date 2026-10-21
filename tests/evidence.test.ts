import {describe,it,expect} from 'vitest';
import {locateQuote} from '../src/evidence/quotes.js';
import {selectPassages} from '../src/evidence/passages.js';
import {validateReport,ReportValidationError} from '../src/evidence/report.js';
import type {Analysis,Claim,Source,SourceChunk} from '../src/schemas/contracts.js';

const claim:Claim={id:'c1',originalText:'x',normalizedText:'Die Mauer fiel am 9. November 1989.',timeScope:'9. November 1989',locationScope:'Berlin',entities:['Berliner Mauer'],checkability:'checkable'};
const source=(id:string,over:Partial<Source>={}):Source=>({id,requestedUrl:`https://${id}.example`,finalUrl:`https://${id}.example`,title:id,publisher:id,publishedAt:null,updatedAt:null,retrievedAt:'2026-10-21',provenanceGroup:id,retrievalStatus:'available',truncated:false,...over});

describe('locateQuote',()=>{
 const source='Die Mauer um­schloss\nWest-Berlin – bis zum „9. November 1989“ und trennte die Stadt.';
 it.each([
  ['re-flowed whitespace','Die Mauer umschloss West-Berlin'],
  ['straight quotes instead of typographic ones','bis zum "9. November 1989" und trennte die Stadt.'],
  ['a hyphen instead of an en dash','West-Berlin - bis zum'],
 ])('finds a quote with %s and returns the literal source text',(_name,quote)=>{
  const found=locateQuote(source,quote);
  expect(found).not.toBeNull();
  expect(source).toContain(found!);
 });
 it('returns the exact source span, not the re-typed quote',()=>{
  expect(locateQuote(source,'bis zum "9. November 1989"')).toBe('bis zum „9. November 1989“');
 });
 it('ignores quotation marks wrapped around the whole quote',()=>{
  expect(locateQuote(source,'„Die Mauer umschloss West-Berlin“')).toMatch(/^Die Mauer um.schloss\nWest-Berlin$/);
 });
 it.each([
  ['a different digit or month','bis zum „9. Oktober 1989“'],
  ['a different case','die mauer umschloss'],
  ['words that are not adjacent in the source','Mauer Stadt'],
  ['an empty quote','   '],
 ])('rejects %s',(_name,quote)=>expect(locateQuote(source,quote)).toBeNull());
});

describe('selectPassages',()=>{
 const sentence='Ein Satz über das Wetter in einer anderen Stadt ohne Bezug zum Thema. ';
 it('returns contiguous exact substrings of at most 2500 characters, in source order',()=>{
  const text=Array.from({length:60},(_,i)=>sentence.repeat(3)+`Zeile ${i}`).join('\n');
  const chunks=selectPassages('s1',text,claim);
  expect(chunks.length).toBeGreaterThan(0);
  for(const chunk of chunks){expect(text).toContain(chunk.text);expect(chunk.text.length).toBeLessThanOrEqual(2500);}
  const positions=chunks.map(c=>text.indexOf(c.text));
  expect([...positions].sort((a,b)=>a-b)).toEqual(positions);
 });
 it('does not cut a sentence in half when the source has line breaks or full stops to cut at',()=>{
  const target='Die Berliner Mauer fiel am 9. November 1989 nach der Pressekonferenz.';
  const text=(sentence.repeat(36)+'\n'+target+'\n'+sentence.repeat(5));
  const chunks=selectPassages('s1',text,claim);
  expect(chunks.some(c=>c.text.includes(target))).toBe(true);
 });
 it('selects the passage that matches the claim from a long source and respects the text budget',()=>{
  const text=sentence.repeat(1200)+'\nDie Berliner Mauer fiel am 9. November 1989.\n'+sentence.repeat(1200);
  const chunks=selectPassages('s1',text,claim);
  expect(chunks.some(c=>c.text.includes('9. November 1989'))).toBe(true);
  expect(chunks.reduce((sum,c)=>sum+c.text.length,0)).toBeLessThanOrEqual(15000);
 });
});

describe('validateReport findings',()=>{
 const sources=[source('s1'),source('s2'),source('s3',{retrievalStatus:'unavailable'})];
 const chunks:SourceChunk[]=[{id:'s1:p1',sourceId:'s1',text:'Die Mauer fiel am 9. November 1989.',sectionLabel:'a'},{id:'s2:p1',sourceId:'s2',text:'Andere Quelle nennt 1990.',sectionLabel:'a'}];
 const analysis=(over:Partial<Analysis['evidence'][number]>[]):Analysis=>({evidence:over.map((o,i)=>({id:`e${i+1}`,claimId:'c1',sourceId:'s1',chunkId:'s1:p1',exactQuote:'Die Mauer fiel am 9. November 1989.',relation:'supports' as const,scopeMatch:true,limitations:[],...o})),verdict:{claimId:'c1',label:'Belegt',summary:'Ja.',reasoningItems:[{text:'Quelle nennt das Datum.',evidenceIds:over.map((_,i)=>`e${i+1}`)}],evidenceIds:over.map((_,i)=>`e${i+1}`),limitations:[]},gap:null,followUpQuery:null});
 const issuesOf=(input:unknown)=>{try{validateReport(input,claim,sources,chunks);}catch(error){if(error instanceof ReportValidationError)return error.issues;throw error;}return [];};
 it('names every problem at once so one correction can fix them all',()=>{
  const issues=issuesOf(analysis([{exactQuote:'Erfundener Satz.'},{id:'e2',sourceId:'s9'},{id:'e3',sourceId:'s3'}]));
  expect(issues.some(i=>i.includes('e1')&&i.includes('Erfundener Satz.'))).toBe(true);
  expect(issues.some(i=>i.includes('e2')&&i.includes('s9'))).toBe(true);
  expect(issues.some(i=>i.includes('e3')&&i.includes('nicht abrufbar'))).toBe(true);
 });
 it('rejects a quote that exists only in a different source than the one cited',()=>{
  const issues=issuesOf(analysis([{sourceId:'s2',chunkId:'s2:p1',exactQuote:'Die Mauer fiel am 9. November 1989.'}]));
  expect(issues).toHaveLength(1);
  expect(issues[0]).toContain('s2');
 });
 it('rejects references to unknown evidence in the verdict and gives the valid ids',()=>{
  const report=analysis([{}]);report.verdict.reasoningItems[0]!.evidenceIds=['e1','e7'];
  expect(issuesOf(report).join(' ')).toMatch(/e7/);
 });
 it('rejects schema violations with a readable finding',()=>{
  expect(issuesOf({evidence:'nein'})[0]).toMatch(/Schemaverstoß/);
 });
 it('does not change its input',()=>{
  const report=analysis([{exactQuote:'„Die  Mauer fiel am 9. November 1989.“'}]);const before=JSON.stringify(report);
  validateReport(report,claim,sources,chunks);
  expect(JSON.stringify(report)).toBe(before);
 });
 it('keeps a legitimate unresolved verdict without reasoning intact',()=>{
  const report:Analysis={evidence:[],verdict:{claimId:'c1',label:'Ungeklärt',summary:'Offen.',reasoningItems:[],evidenceIds:[],limitations:['Keine Quelle nennt das Datum.']},gap:null,followUpQuery:null};
  expect(validateReport(report,claim,sources,chunks).verdict).toEqual(report.verdict);
 });
});

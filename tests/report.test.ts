import {describe,it,expect} from 'vitest';
import {validateReport} from '../src/evidence/report.js';
import type {Analysis, Claim, Source, SourceChunk} from '../src/schemas/contracts.js';
const claim:Claim={id:'c1',originalText:'A',normalizedText:'A',timeScope:null,locationScope:null,entities:[],checkability:'checkable'};
const sources:Source[]=[{id:'s1',requestedUrl:'https://example.org',finalUrl:'https://example.org',title:'A',publisher:'A',publishedAt:null,updatedAt:null,retrievedAt:'2026-10-21',provenanceGroup:'a',retrievalStatus:'available',truncated:false}];
const chunks:SourceChunk[]=[{id:'s1:p1',sourceId:'s1',text:'Nur im Park gilt das Verbot.',sectionLabel:'Absatz 1'}];
function report():Analysis{return {evidence:[{id:'e1',claimId:'c1',sourceId:'s1',chunkId:'s1:p1',exactQuote:'Nur im Park gilt das Verbot.',relation:'context',scopeMatch:true,limitations:[]}],verdict:{claimId:'c1',label:'Kontext fehlt',summary:'Das Verbot gilt nur im Park.',reasoningItems:[{text:'Das Verbot gilt nur im Park.',evidenceIds:['e1']}],evidenceIds:['e1'],limitations:[]},gap:null,followUpQuery:null};}
describe('registered report evidence',()=>{
 it('accepts a quote from its registered source',()=>expect(validateReport(report(),claim,sources,chunks).verdict.label).toBe('Kontext fehlt'));
 it('rejects invented quotes and source references',()=>{const r=report();r.evidence[0].exactQuote='Überall verboten';expect(()=>validateReport(r,claim,sources,chunks)).toThrow();r.evidence[0].sourceId='s99';expect(()=>validateReport(r,claim,sources,chunks)).toThrow();});
 it('does not confuse missing evidence with contradiction',()=>{const r=report();r.evidence=[];r.verdict.evidenceIds=[];r.verdict.reasoningItems=[];r.verdict.label='Widersprochen';expect(validateReport(r,claim,sources,chunks).verdict.label).toBe('Ungeklärt');});
 it('keeps conflicting direct evidence unresolved',()=>{const r=report();r.evidence[0].relation='supports';r.evidence.push({...r.evidence[0],id:'e2',relation:'contradicts'});r.verdict.label='Belegt';r.verdict.evidenceIds.push('e2');expect(validateReport(r,claim,sources,chunks).verdict.label).toBe('Ungeklärt');});
 it('rejects dangling reasoning evidence IDs',()=>{const r=report();r.verdict.reasoningItems[0].evidenceIds=['invented'];expect(()=>validateReport(r,claim,sources,chunks)).toThrow();});
});

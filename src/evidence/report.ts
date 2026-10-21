import {AnalysisSchema,type Analysis,type Claim,type Source,type SourceChunk} from '../schemas/contracts.js';
export function unresolved(claim:Claim,limitations:string[]):Analysis {
 return {evidence:[],verdict:{claimId:claim.id,label:'Ungeklärt',summary:'Die verfügbaren Belege reichen für eine belastbare Einordnung nicht aus.',reasoningItems:[],evidenceIds:[],limitations},gap:null,followUpQuery:null};
}
export function validateReport(input:unknown,claim:Claim,sources:Source[],chunks:SourceChunk[]):Analysis {
 const report=AnalysisSchema.parse(input);
 if(report.verdict.claimId!==claim.id) throw new Error('Fremde Behauptung');
 const ids=new Set<string>();
 for(const e of report.evidence){
  const source=sources.find(s=>s.id===e.sourceId && s.retrievalStatus==='available');
  const chunk=chunks.find(c=>c.id===e.chunkId && c.sourceId===e.sourceId);
  if(ids.has(e.id)||e.claimId!==claim.id||!source||!chunk||!chunk.text.includes(e.exactQuote)) throw new Error('Ungültiger Beleg oder erfundenes Zitat');
  ids.add(e.id);
 }
 if(report.verdict.evidenceIds.some(id=>!ids.has(id))||report.verdict.reasoningItems.some(r=>r.evidenceIds.some(id=>!ids.has(id)))) throw new Error('Unbekannte Belegreferenz');
 const used=report.evidence.filter(e=>report.verdict.evidenceIds.includes(e.id));
 if(report.verdict.reasoningItems.some(r=>r.evidenceIds.some(id=>!report.verdict.evidenceIds.includes(id)))) throw new Error('Begründung außerhalb der Urteilsevidenz');
 const direct=used.filter(e=>e.scopeMatch);
 const conflict=direct.some(e=>e.relation==='supports')&&direct.some(e=>e.relation==='contradicts');
 const required={Belegt:'supports',Widersprochen:'contradicts','Kontext fehlt':'context'} as const;
 const label=report.verdict.label;
 if(conflict || (label in required && (!report.verdict.reasoningItems.length || !direct.some(e=>e.relation===required[label as keyof typeof required])))) {
  report.verdict={...unresolved(claim,[conflict?'Passende Belege widersprechen sich.':'Das vorgeschlagene Urteil ist nicht ausreichend belegt.',...report.verdict.limitations]).verdict,evidenceIds:used.map(e=>e.id),reasoningItems:report.verdict.reasoningItems};
 }
 if(label==='Nicht sachlich prüfbar'&&claim.checkability==='checkable') throw new Error('Prüfbarkeit widerspricht der bestätigten Aussage');
 return report;
}

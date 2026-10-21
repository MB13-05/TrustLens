import {AnalysisSchema,type Analysis,type Claim,type Evidence,type Source,type SourceChunk} from '../schemas/contracts.js';
import {locateQuote} from './quotes.js';

/** Concrete, German, model-addressed findings. Never shown to users verbatim; they only steer the single correction step. */
export class ReportValidationError extends Error {
 constructor(readonly issues:string[]){super(issues.join(' '));this.name='ReportValidationError';}
}
const STRONG_REQUIREMENT={Belegt:'supports',Widersprochen:'contradicts','Kontext fehlt':'context'} as const;
const shorten=(text:string,max=90)=>text.length>max?text.slice(0,max)+'…':text;

export function unresolved(claim:Claim,limitations:string[]):Analysis {
 return {evidence:[],verdict:{claimId:claim.id,label:'Ungeklärt',summary:'Die verfügbaren Belege reichen für eine belastbare Einordnung nicht aus.',reasoningItems:[],evidenceIds:[],limitations},gap:null,followUpQuery:null};
}
/** The sources were read but could not be evaluated reliably. This is a software limit and says nothing about the claim. */
export function technicalFailure(claim:Claim):Analysis {
 const analysis=unresolved(claim,['Die Aussage wurde nicht inhaltlich eingeordnet. Die gelesenen Quellen sind unten aufgeführt und können selbst geprüft werden.']);
 analysis.verdict.summary='Die Quellen konnten technisch nicht zuverlässig ausgewertet werden. Das sagt nichts darüber aus, ob die Aussage stimmt.';
 return analysis;
}

function checkEvidence(e:Evidence,claim:Claim,sources:Source[],chunks:SourceChunk[],seen:Set<string>,issues:string[]):Evidence|null {
 const label=`Beleg ${e.id}`;
 if(seen.has(e.id)){issues.push(`${label}: Die ID ist doppelt vergeben.`);return null;}
 if(e.claimId!==claim.id){issues.push(`${label}: claimId muss „${claim.id}“ sein, nicht „${e.claimId}“.`);return null;}
 const source=sources.find(s=>s.id===e.sourceId);
 if(!source||source.retrievalStatus!=='available'){
  const valid=sources.filter(s=>s.retrievalStatus==='available').map(s=>s.id).join(', ')||'keine';
  issues.push(`${label}: Die Quelle „${e.sourceId}“ ist nicht registriert oder nicht abrufbar. Gültige Quellen-IDs: ${valid}.`);return null;
 }
 const cited=chunks.find(c=>c.id===e.chunkId);
 const own=chunks.filter(c=>c.sourceId===e.sourceId);
 // Prefer the cited chunk, then the source's other chunks: a mis-cited chunk ID is harmless when the quote really is in the source.
 const candidates=[...(cited&&cited.sourceId===e.sourceId?[cited]:[]),...own.filter(c=>c!==cited)];
 for(const chunk of candidates){
  const literal=locateQuote(chunk.text,e.exactQuote);
  if(literal)return {...e,chunkId:chunk.id,exactQuote:literal};
 }
 const valid=own.map(c=>c.id).join(', ')||'keine';
 issues.push(`${label}: Das Zitat „${shorten(e.exactQuote)}“ steht nicht wörtlich in den registrierten Abschnitten der Quelle ${e.sourceId} (${valid}). Zitiere einen zusammenhängenden Textabschnitt Zeichen für Zeichen aus dem Abschnittstext, ohne Auslassungen oder Umformulierung.`);
 return null;
}

export function validateReport(input:unknown,claim:Claim,sources:Source[],chunks:SourceChunk[]):Analysis {
 const parsed=AnalysisSchema.safeParse(input);
 if(!parsed.success)throw new ReportValidationError(parsed.error.issues.slice(0,5).map(i=>`Schemaverstoß bei „${i.path.join('.')||'Bericht'}“: ${i.message}`));
 const report=parsed.data;
 const issues:string[]=[];
 if(report.verdict.claimId!==claim.id)issues.push(`verdict.claimId muss „${claim.id}“ sein.`);
 const seen=new Set<string>();
 const evidence:Evidence[]=[];
 for(const item of report.evidence){
  const checked=checkEvidence(item,claim,sources,chunks,seen,issues);
  seen.add(item.id);
  if(checked)evidence.push(checked);
 }
 const known=new Set(evidence.map(e=>e.id));
 const unknown=(ids:string[])=>[...new Set(ids.filter(id=>!known.has(id)))];
 const reasoningIds=report.verdict.reasoningItems.flatMap(r=>r.evidenceIds);
 const missing=unknown([...reasoningIds,...report.verdict.evidenceIds]);
 if(missing.length&&!issues.length)issues.push(`Das Urteil verweist auf unbekannte Beleg-IDs: ${missing.join(', ')}. Gültig sind: ${[...known].join(', ')||'keine'}.`);
 if(report.verdict.label==='Nicht sachlich prüfbar'&&claim.checkability==='checkable')issues.push('Die bestätigte Aussage ist sachlich prüfbar; „Nicht sachlich prüfbar“ ist unzulässig.');
 if(issues.length)throw new ReportValidationError(issues);

 // Evidence the reasoning relies on belongs to the verdict even if the model forgot to list it.
 const verdictIds=[...new Set([...report.verdict.evidenceIds,...reasoningIds])];
 let verdict={...report.verdict,evidenceIds:verdictIds};
 const used=evidence.filter(e=>verdictIds.includes(e.id));
 const direct=used.filter(e=>e.scopeMatch);
 const conflict=direct.some(e=>e.relation==='supports')&&direct.some(e=>e.relation==='contradicts');
 const required=STRONG_REQUIREMENT[verdict.label as keyof typeof STRONG_REQUIREMENT];
 const lacksSupport=required!==undefined&&(!verdict.reasoningItems.length||!direct.some(e=>e.relation===required));
 if(conflict){
  verdict={...verdict,label:'Ungeklärt',summary:'Geeignete Quellen widersprechen sich; eine eindeutige Einordnung ist nicht möglich.',limitations:['Passende Belege stützen und widersprechen der Aussage zugleich.',...verdict.limitations]};
 }else if(lacksSupport){
  verdict={...verdict,label:'Ungeklärt',summary:'Die gefundenen Fundstellen tragen die Aussage nicht in ihrem vollen Umfang; eine belastbare Einordnung ist daher nicht möglich.',reasoningItems:[],limitations:['Die gefundenen Fundstellen belegen das vorgeschlagene Urteil nicht ausreichend.',...verdict.limitations]};
 }
 return {...report,evidence,verdict};
}

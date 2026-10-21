import type {Claim,SourceChunk} from '../schemas/contracts.js';
/** Keep exact source spans and their original positions, favoring matching passages and adjacent context. */
export function selectPassages(sourceId:string,text:string,claim:Claim):SourceChunk[]{
 const terms=[...new Set((claim.normalizedText+' '+claim.entities.join(' ')).toLocaleLowerCase('de').match(/[\p{L}\p{N}]{3,}/gu)??[])].filter(term=>!['der','die','das','ein','eine','einer','einem','einen','und','ist','sind','seit','mit','für','von','des','dem','den','hat','wird','werden','sein'].includes(term));
 const spans=Array.from({length:Math.ceil(text.length/2500)},(_,index)=>({id:`${sourceId}:p${index+1}`,sourceId,text:text.slice(index*2500,(index+1)*2500),sectionLabel:`Textabschnitt ${index+1}`,index}));
 const scores=spans.map(span=>terms.reduce((score,term)=>score+(span.text.toLocaleLowerCase('de').includes(term)?1:0),0));
 return spans.map((span,index)=>({...span,score:scores[index]+0.2*((scores[index-1]??0)+(scores[index+1]??0))})).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,6).sort((a,b)=>a.index-b.index).map(({index:_index,score:_score,...span})=>span);
}

import type {Claim,SourceChunk} from '../schemas/contracts.js';

const SPAN_LIMIT=2500;
const MAX_SPANS=6;
const STOP_WORDS=new Set(['der','die','das','ein','eine','einer','einem','einen','und','ist','sind','seit','mit','für','von','des','dem','den','hat','wird','werden','sein','the','and','was','were']);

/** Cut points prefer sentence ends, then spaces, so a quote is rarely split across two spans. */
function cutPoint(text:string,start:number):number {
 const end=start+SPAN_LIMIT;
 if(end>=text.length)return text.length;
 const window=text.slice(start,end);
 const sentence=Math.max(window.lastIndexOf('. '),window.lastIndexOf('! '),window.lastIndexOf('? '));
 if(sentence>SPAN_LIMIT/2)return start+sentence+1;
 const space=window.lastIndexOf(' ');
 return space>SPAN_LIMIT/2?start+space:end;
}
/** Contiguous spans of at most SPAN_LIMIT characters that end at line breaks where possible. Every span is an exact substring of `text`. */
function splitIntoSpans(text:string):string[] {
 const pieces=text.split(/(?<=\n)/);
 const spans:string[]=[];
 let current='';
 const flush=()=>{if(current.trim())spans.push(current.trim());current='';};
 for(const piece of pieces){
  if(current.length+piece.length<=SPAN_LIMIT){current+=piece;continue;}
  flush();
  let start=0;
  while(piece.length-start>SPAN_LIMIT){const cut=cutPoint(piece,start);spans.push(piece.slice(start,cut).trim());start=cut;}
  current=piece.slice(start);
 }
 flush();
 return spans.filter(Boolean);
}
const termsOf=(claim:Claim)=>[...new Set(`${claim.normalizedText} ${claim.entities.join(' ')} ${claim.timeScope??''} ${claim.locationScope??''}`.toLocaleLowerCase('de').match(/[\p{L}\p{N}]{3,}/gu)??[])].filter(term=>!STOP_WORDS.has(term));

/** Keep exact source spans in their original order, favoring passages that match the claim and their neighbours. */
export function selectPassages(sourceId:string,text:string,claim:Claim):SourceChunk[]{
 const terms=termsOf(claim);
 const spans=splitIntoSpans(text).map((spanText,index)=>({id:`${sourceId}:p${index+1}`,sourceId,text:spanText,sectionLabel:`Textabschnitt ${index+1}`,index}));
 const scores=spans.map(span=>{const lower=span.text.toLocaleLowerCase('de');return terms.reduce((score,term)=>score+(lower.includes(term)?1:0),0);});
 return spans.map((span,index)=>({...span,score:scores[index]!+0.2*((scores[index-1]??0)+(scores[index+1]??0))})).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,MAX_SPANS).sort((a,b)=>a.index-b.index).map(({index:_index,score:_score,...span})=>span);
}

import { z } from 'zod';
export const ModeSchema = z.enum(['live', 'demo']);
export const ClaimSchema = z.object({ id:z.string().min(1), originalText:z.string().min(1).max(8000), normalizedText:z.string().trim().min(1).max(8000), timeScope:z.string().nullable(), locationScope:z.string().nullable(), entities:z.array(z.string()), checkability:z.enum(['checkable','opinion','prediction','unclear']).describe('Prüfbarkeit, niemals Wahrheitsgehalt: checkable = sachlich anhand von Quellen prüfbare Tatsachenbehauptung, auch wenn sie falsch, negiert, umstritten oder ein behaupteter Ursache-Wirkungs-/Belegzusammenhang ist. opinion = ausschließlich subjektiver Geschmack oder Werturteil ohne prüfbaren Tatsachenkern. prediction = derzeit nicht überprüfbare Zukunftsprognose. unclear = notwendiger Bezug wie Ort, Zeit oder Akteur fehlt. Eine wissenschaftlich falsche Behauptung bleibt checkable, nicht opinion.') });
export type Claim = z.infer<typeof ClaimSchema>;
export const Labels = ['Belegt','Widersprochen','Kontext fehlt','Ungeklärt','Nicht sachlich prüfbar'] as const;
export const EvidenceSchema = z.object({id:z.string(),claimId:z.string(),sourceId:z.string(),chunkId:z.string(),exactQuote:z.string().min(1).max(1000),relation:z.enum(['supports','contradicts','context']),scopeMatch:z.boolean(),limitations:z.array(z.string())});
export type Evidence = z.infer<typeof EvidenceSchema>;
export const VerdictSchema=z.object({claimId:z.string(),label:z.enum(Labels),summary:z.string().max(2000),reasoningItems:z.array(z.object({text:z.string(),evidenceIds:z.array(z.string()).min(1)})),evidenceIds:z.array(z.string()),limitations:z.array(z.string())});
export type Verdict=z.infer<typeof VerdictSchema>;
export const AnalysisSchema=z.object({evidence:z.array(EvidenceSchema),verdict:VerdictSchema,gap:z.string().nullable(),followUpQuery:z.string().nullable()});
export type Analysis=z.infer<typeof AnalysisSchema>;
export interface Source {id:string;requestedUrl:string;finalUrl:string;title:string;publisher:string;publishedAt:string|null;updatedAt:string|null;retrievedAt:string;provenanceGroup:string;retrievalStatus:'available'|'unavailable';truncated:boolean}
export interface SourceChunk {id:string;sourceId:string;text:string;sectionLabel:string}
/** The user-supplied input a check started from. A post or image is the claim's origin, never independent evidence. */
export interface InputOrigin {kind:'text'|'image'|'post';platform?:'instagram'|'tiktok';url?:string;author?:string|null;scope?:'caption';edited:boolean}
/** `technicalNotes` are software limits (failed evaluation steps); research limits belong in `verdict.limitations`. */
export interface Result {claim:Claim;checkedAt:string;verdict:Verdict;evidence:Evidence[];sources:Source[];chunks:SourceChunk[];technicalNotes:string[];input?:InputOrigin}
export type Status='queued'|'researching'|'evaluating'|'completed'|'partial'|'failed'|'cancelled';
/** A source the run has registered so far; shown while the run is still working. */
export interface FoundSource {id:string;title:string;publisher:string;url:string;status:'available'|'unavailable'}
export interface Run {id:string;mode:'live'|'demo';status:Status;createdAt:string;expiresAt:string;deadlineAt:string;counters:{model:number;search:number;fetch:number;rounds:number};events:{id:string;at:string;message:string}[];found:FoundSource[];result:Result|null;error:string|null}

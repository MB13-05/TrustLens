import sharp, {type Metadata} from 'sharp';

/** Documented upload limits (see README). The processed image is held in memory only for the duration of one request. */
export const IMAGE_LIMITS={maxBytes:6*1024*1024,maxPixels:25_000_000,minEdge:32,outputEdge:2000,formats:['image/jpeg','image/png','image/webp']} as const;
export type ImageMime=(typeof IMAGE_LIMITS.formats)[number];
export type ImageRejection='too_large'|'not_an_image'|'unsupported_format'|'too_many_pixels'|'too_small'|'animated';
const MESSAGES:Record<ImageRejection,string>={
 too_large:'Die Datei ist größer als 6 MB.',
 not_an_image:'Die Datei ist kein lesbares Bild oder beschädigt.',
 unsupported_format:'Unterstützt werden JPEG, PNG und WebP.',
 too_many_pixels:'Das Bild hat mehr als 25 Megapixel. Bitte einen kleineren Ausschnitt oder Screenshot verwenden.',
 too_small:'Das Bild ist zu klein, um Text darin lesen zu können.',
 animated:'Animierte Bilder werden nicht unterstützt. Bitte ein Standbild oder einen Screenshot verwenden.',
};
export class ImageRejected extends Error {
 constructor(readonly code:ImageRejection){super(MESSAGES[code]);this.name='ImageRejected';}
}
export interface PreparedImage {mime:ImageMime;base64:string;width:number;height:number;bytes:number}

const FORMATS:Record<string,ImageMime>={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};

/**
 * Validates by content (never by the declared type), applies the EXIF orientation, bounds the size and re-encodes the
 * image. Re-encoding drops all metadata (EXIF, GPS, XMP, comments); the original bytes are not kept.
 */
export async function prepareImage(input:Buffer):Promise<PreparedImage> {
 if(input.length>IMAGE_LIMITS.maxBytes)throw new ImageRejected('too_large');
 if(input.length===0)throw new ImageRejected('not_an_image');
 const open=()=>sharp(input,{limitInputPixels:IMAGE_LIMITS.maxPixels,failOn:'error',animated:false});
 let info:Metadata;
 try{info=await open().metadata();}
 catch(error){throw new ImageRejected(/pixel/i.test(String(error))?'too_many_pixels':'not_an_image');}
 const mime=info.format?FORMATS[info.format]:undefined;
 if(!mime)throw new ImageRejected(info.format?'unsupported_format':'not_an_image');
 if((info.pages??1)>1)throw new ImageRejected('animated');
 if(!info.width||!info.height)throw new ImageRejected('not_an_image');
 if(info.width*info.height>IMAGE_LIMITS.maxPixels)throw new ImageRejected('too_many_pixels');
 if(Math.min(info.width,info.height)<IMAGE_LIMITS.minEdge)throw new ImageRejected('too_small');
 try{
  const pipeline=open().rotate().resize({width:IMAGE_LIMITS.outputEdge,height:IMAGE_LIMITS.outputEdge,fit:'inside',withoutEnlargement:true});
  const encoded=mime==='image/jpeg'?pipeline.jpeg({quality:88}):mime==='image/png'?pipeline.png({compressionLevel:9}):pipeline.webp({quality:88});
  const {data,info:out}=await encoded.toBuffer({resolveWithObject:true});
  return {mime,base64:data.toString('base64'),width:out.width,height:out.height,bytes:data.length};
 }catch(error){
  throw new ImageRejected(/pixel/i.test(String(error))?'too_many_pixels':'not_an_image');
 }
}

/** Real-model regression at the provider interface. Three short classification calls; no search, pages or uploads. */
import {createLiveProviders} from '../src/tools/providers.js';
import {modelConfiguration} from '../src/tools/model-config.js';
import {outputSchemas} from '../src/schemas/model.js';

const configuration=modelConfiguration();
if(!configuration.apiKey){
 console.error('Klassifikationstest übersprungen: Der konfigurierte Modellschlüssel fehlt.');
 process.exit(2);
}
const cases=[
 {text:'Kohlendioxid trägt nicht zur Erderwärmung bei.',expected:'checkable'},
 {text:'Der Einsatz von CO2-Generatoren in Gewächshäusern belegt, dass Kohlendioxid nicht klimaschädlich ist.',expected:'checkable'},
 {text:'Ich finde diese Klimapolitik schlecht.',expected:'opinion'},
] as const;
const providers=createLiveProviders({modelProvider:configuration.provider});
let failed=0;
for(const example of cases){
 const started=Date.now();
 try{
  const output=outputSchemas.extract.parse(await providers.model('extract',{text:example.text},AbortSignal.timeout(25_000)));
  const actual=output.claims.map(claim=>claim.checkability);
  const passed=actual.length>0&&actual.every(value=>value===example.expected);
  if(!passed)failed++;
  console.info(JSON.stringify({text:example.text,expected:example.expected,actual,passed,seconds:Math.round((Date.now()-started)/100)/10}));
 }catch{
  failed++;console.info(JSON.stringify({text:example.text,passed:false,error:'Die Klassifikation war nicht verfügbar oder die Antwort war ungültig.'}));
 }
}
console.info(JSON.stringify({cases:cases.length,failed,provider:configuration.provider,model:configuration.model}));
process.exitCode=failed?1:0;

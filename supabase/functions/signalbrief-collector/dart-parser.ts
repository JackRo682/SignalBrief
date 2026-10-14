import {SaxesParser} from 'npm:saxes@6.0.0';
import {Parser} from 'npm:htmlparser2@10.0.0';
import {ProviderError} from '../signalbrief-api/us-core.ts';
import {validateDartXML} from './dart-document-core.ts';
export function parseDartText(xml:string):{text:string;mode:string}{
 validateDartXML(xml);
 let text='';
 try{
  const parser=new SaxesParser({xmlns:false});
  parser.on('error',()=>{throw new Error('strict_xml_failed');});
  parser.on('text',value=>{text+=value;});parser.on('cdata',value=>{text+=value;});parser.on('closetag',()=>{text+=' ';});
  parser.write(xml).close();
  return {text:text.replace(/\s+/g,' ').trim(),mode:'strict_xml'};
 }catch{
  // Official DART documents can contain HTML-like markup, misnested tags and
  // unescaped quotes in translation attributes. Recover display text only;
  // attribute values are never evidence. Raw bytes remain immutable.
  if(!/<(?:DOCUMENT|html)(?:\s|>)/i.test(xml))throw new ProviderError('dart','unsupported_document_markup');
  text='';let suppressed=0;
  const parser=new Parser({
   onopentag(name){if(['script','style','noscript'].includes(name))suppressed++;},
   ontext(value){if(!suppressed)text+=value;},
   onclosetag(name){if(['script','style','noscript'].includes(name)&&suppressed)suppressed--;if(!suppressed)text+=' ';},
   onerror(){throw new ProviderError('dart','document_markup_failed');},
  },{decodeEntities:true,recognizeCDATA:true});
  parser.write(xml);parser.end();text=text.replace(/\s+/g,' ').trim();
  if(!text)throw new ProviderError('dart','empty_document_text');
  return {text,mode:'html_text_recovery_requires_review'};
 }
}

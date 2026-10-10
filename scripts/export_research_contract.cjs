/* Export the actual Zod request union; custom refinements remain authoritative in TypeScript. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const ts = webRequire('typescript');
const source = fs.readFileSync(path.join(root, 'apps/web/src/research/contracts.ts'), 'utf8');
const moduleObject = {exports: {}};
vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText, {require: webRequire, exports: moduleObject.exports, module: moduleObject, URL});
function schema(z) {
 const d = z._def;
 if(d.typeName === 'ZodUnion') return {oneOf: d.options.map(schema)};
 if(d.typeName === 'ZodEffects') return {...schema(d.schema),description:'Additional server-side validation applies; see research/contracts.ts.'};
 if(d.typeName === 'ZodObject') {const shape=d.shape();return {type:'object',properties:Object.fromEntries(Object.entries(shape).map(([k,v])=>[k,schema(v)])),required:Object.keys(shape),additionalProperties:false};}
 if(d.typeName === 'ZodEnum') return {type:'string',enum:d.values};
 if(d.typeName === 'ZodLiteral') return {const:d.value};
 const out={type:{ZodString:'string',ZodNumber:'number',ZodBoolean:'boolean'}[d.typeName]};
 for(const c of d.checks??[]){if(c.kind==='int')out.type='integer';if(c.kind==='min')out[out.type==='string'?'minLength':'minimum']=c.value;if(c.kind==='max')out[out.type==='string'?'maxLength':'maximum']=c.value;if(['uuid','url','date'].includes(c.kind))out.format=c.kind==='url'?'uri':c.kind;if(c.kind==='regex')out.pattern=c.regex.source;}
 return out;
}
const contract={openapi:'3.1.0',info:{title:'SignalBrief Research API',version:'1.0.0'},paths:{'/api/research':{post:{summary:'Consented research and admin operations',security:[{bearerAuth:[]}],requestBody:{required:true,content:{'application/json':{schema:schema(moduleObject.exports.researchRequest)}}},responses:{200:{description:'Validated result; unknown metrics are null'},401:{description:'Authentication required'},403:{description:'Admin, ownership, consent or MFA denied'},409:{description:'State, frozen version or split conflict'},422:{description:'Invalid input'},429:{description:'Rate or cost budget exceeded'}}}}},components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'}}}};
fs.writeFileSync(path.join(root,'packages/shared/research-openapi.json'),JSON.stringify(contract,null,2)+'\n');
console.log('Exported research API contract');

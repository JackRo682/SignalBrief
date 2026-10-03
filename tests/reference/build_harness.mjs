// Local-only component integration harness: never shipped as an application route.
import ts from '../../apps/web/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),target=path.join(root,'.reference-test');fs.mkdirSync(target,{recursive:true});
for(const name of ['controller','templates','publication']){const source=fs.readFileSync(path.join(root,'apps/web/src/reference/'+name+'.ts'),'utf8');fs.writeFileSync(path.join(target,name+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);}
for(const name of ['reference.css','overrides.css','publication.css'])fs.copyFileSync(path.join(root,'apps/web/src/reference/'+name),path.join(target,name));
fs.cpSync(path.join(root,'apps/web/public/reference-assets'),path.join(target,'reference-assets'),{recursive:true});
fs.copyFileSync(path.join(root,'tests/reference/fixture.js'),path.join(target,'fixture.js'));
fs.writeFileSync(path.join(target,'index.html'),`<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="reference.css"><link rel="stylesheet" href="overrides.css"><link rel="stylesheet" href="publication.css"><style>body{margin:0}#fixture-label{position:fixed;left:4px;bottom:1px;font-size:8px;z-index:400;color:#789;pointer-events:none}</style></head><body><div id="fixture-label">ISOLATED TEST FIXTURES · NOT LIVE DATA</div><div id="root"></div><script type="module" src="fixture.js"></script></body></html>`);
console.log(target);

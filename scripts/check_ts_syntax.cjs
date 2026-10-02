// Syntax/transpile check only. This is NOT tsc, a dependency check, or a Next production build.
const fs=require("fs"),path=require("path");
let ts;try{ts=require("typescript");}catch{try{ts=require(process.env.TYPESCRIPT_PATH||"/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript");}catch{console.error("TypeScript is not installed");process.exit(2);}}
const root=path.resolve(__dirname,"../apps/web");let checked=0,failures=[];
function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(["node_modules",".next"].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(/\.tsx?$/.test(e.name)&&!e.name.endsWith(".d.ts")){
 const r=ts.transpileModule(fs.readFileSync(p,"utf8"),{fileName:p,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,isolatedModules:true},reportDiagnostics:true});checked++;
 for(const d of r.diagnostics||[])if(d.category===ts.DiagnosticCategory.Error)failures.push({file:path.relative(root,p),error:ts.flattenDiagnosticMessageText(d.messageText," ")});
}}}
visit(root);console.log(JSON.stringify({check:"typescript_syntax_only",checked,failures,full_typecheck_executed:false,next_build_executed:false},null,2));process.exit(failures.length?1:0);

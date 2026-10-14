// @vitest-environment node
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
const require=createRequire(import.meta.url);
const pluginRequire=createRequire(require.resolve('@next/eslint-plugin-next'));
const {getRootDirs}=require(join(dirname(require.resolve('@next/eslint-plugin-next')),'utils/get-root-dirs.js'));
const cleanup:string[]=[];
afterEach(()=>{for(const directory of cleanup.splice(0))rmSync(directory,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'signalbrief-lint-'));cleanup.push(root);mkdirSync(join(root,'web'));mkdirSync(join(root,'admin'));writeFileSync(join(root,'file.txt'),'file');return root;}
describe('Next lint root glob compatibility',()=>{
 it('resolves the scoped glob dependency to pinned tinyglobby',()=>expect(pluginRequire('fast-glob/package.json')).toMatchObject({name:'tinyglobby',version:'0.2.17'}));
 it('keeps the default root when no override is configured',()=>expect(getRootDirs({cwd:'/repository',settings:{}})).toEqual(['/repository']));
 it('expands directory globs without including files',()=>{const root=fixture();const dirs=getRootDirs({cwd:root,settings:{next:{rootDir:join(root,'*')}}});expect(dirs.map((dir:string)=>resolve(dir).replaceAll('\\','/')).sort()).toEqual([join(root,'admin'),join(root,'web')].map(dir=>resolve(dir).replaceAll('\\','/')).sort());});
 it('supports literal root arrays and brace alternatives',()=>{const root=fixture();const dirs=getRootDirs({cwd:root,settings:{next:{rootDir:[join(root,'web'),join(root,'{admin,missing}')]}}});expect(dirs.map((dir:string)=>resolve(dir).replaceAll('\\','/')).sort()).toEqual([join(root,'admin'),join(root,'web')].map(dir=>resolve(dir).replaceAll('\\','/')).sort());});
 it('keeps lint rules active with the replacement',async()=>{const {ESLint}=await import('eslint');const eslint=new ESLint({cwd:process.cwd()});const results=await eslint.lintText('export default function BadImage(){return <img src="/photo.png" alt="photo"/>;}',{filePath:'src/lint-regression-fixture.tsx'});expect(results.flatMap(result=>result.messages).some(message=>message.ruleId==='@next/next/no-img-element')).toBe(true);},20000);
});

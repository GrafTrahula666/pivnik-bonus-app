
const fs=require('fs'),path=require('path')
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js')
function walk(d){if(!fs.existsSync(d))return[];return fs.readdirSync(d).flatMap(n=>{const f=path.join(d,n),s=fs.statSync(f);return s.isDirectory()?walk(f):/\.(ts|tsx)$/.test(n)?[f]:[]})}
const files=[...walk('src'),...walk('server'),...walk('e2e'),...['vite.config.ts','playwright.config.ts'].filter(fs.existsSync)]
let errors=0
for(const file of files){
 const r=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,strict:true}})
 const ds=(r.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
 if(ds.length){console.log('\n'+file);for(const d of ds)console.log(ts.flattenDiagnosticMessageText(d.messageText,'\n'));errors+=ds.length}
}
console.log(`checked=${files.length} syntaxErrors=${errors}`)
process.exitCode=errors?1:0

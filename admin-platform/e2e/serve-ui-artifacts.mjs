import http from 'node:http'
import {readFile,stat} from 'node:fs/promises'
import {extname,join,normalize} from 'node:path'

const root=join(process.cwd(),'artifacts','ui-polish')
const port=Number(process.env.PORT||8080)
const types={'.png':'image/png','.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8'}

const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url||'/',`http://${req.headers.host||'localhost'}`).pathname)
    if(pathname==='/health'){res.writeHead(200,{'content-type':'text/plain'});res.end('ok');return}
    const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '')
    const safe=normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '')
    const file=join(root,safe)
    const info=await stat(file)
    if(!info.isFile())throw new Error('not file')
    const body=await readFile(file)
    res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':'no-store'})
    res.end(body)
  }catch{
    res.writeHead(404,{'content-type':'text/plain'});res.end('not found')
  }
})
server.listen(port,'0.0.0.0',()=>console.log(`UI_ARTIFACT_SERVER_READY:${port}`))

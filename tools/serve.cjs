const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../app/src/main/assets');
http.createServer((req,res)=>{
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.resolve(root,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file,(error, data)=>{
    if(error) { res.writeHead(404); return res.end('Not found'); }
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript'})[path.extname(file)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store'); res.end(data);
  });
}).listen(4173,'127.0.0.1',()=>console.log('SquirrelFin preview: http://127.0.0.1:4173'));

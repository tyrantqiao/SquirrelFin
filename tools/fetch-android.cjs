// Download the Android platform and build tools from Google's official repository.
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
(async()=>{
 const root=path.resolve(__dirname,'../.build-tools');fs.mkdirSync(root,{recursive:true});
 const xml=await fetch('https://dl.google.com/android/repository/repository2-3.xml').then(r=>{if(!r.ok)throw Error(r.status);return r.text();});
 for(const id of ['platforms;android-35','build-tools;35.0.0']){
  const section=xml.split('<remotePackage path="'+id+'"')[1]?.split('</remotePackage>')[0];
  if(!section)throw Error('Package missing: '+id);
  const archives=[...section.matchAll(/<archive>([\s\S]*?)<\/archive>/g)].map(m=>m[1]);
  const arch=archives.find(a=>a.includes('<host-os>windows</host-os>'))||archives.find(a=>!a.includes('<host-os>'));
  const url=arch.match(/<url>([^<]+)<\/url>/)[1];
  const target=path.join(root,url);if(fs.existsSync(target)){console.log('Already downloaded',url);continue;}
  console.log('Downloading',url);const r=await fetch('https://dl.google.com/android/repository/'+url);if(!r.ok)throw Error(r.status);
  await pipeline(Readable.fromWeb(r.body),fs.createWriteStream(target));console.log('Saved',target);
 }
})().catch(e=>{console.error(e);process.exit(1)});

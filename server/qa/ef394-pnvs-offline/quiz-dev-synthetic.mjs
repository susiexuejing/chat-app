// Explicit opt-in runner only. Does not mount into the app or production auth API.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateDevConfig} from './quiz-dev-ingress.mjs';
import {makeProtectedDev} from './quiz-loopback.mjs';

export async function readPrivateDevConfig(path) {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=await file.stat();
    if(!stat.isFile() || (stat.mode&0o077)!==0 || stat.size>4096 ||
       (stat.uid!==process.getuid()&&stat.uid!==0))throw new Error('Private config must be owner-only regular file');
    return validateDevConfig(JSON.parse(await file.readFile('utf8')));
  } finally {await file.close();}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  if(process.argv.length!==4)throw new Error('Usage: quiz-dev-synthetic.mjs STATIC_DIR PRIVATE_CONFIG_JSON');
  const config=await readPrivateDevConfig(process.argv[3]);
  const app=await makeProtectedDev(process.argv[2],config);
  console.log('Protected DEV synthetic server bound to 127.0.0.1:'+config.port+'; expires '+new Date(config.expiresMs).toISOString());
  let closing;
  const close=()=>closing??=app.close().catch(()=>{process.exitCode=1;});
  const timer=setTimeout(close,Math.max(0,config.expiresMs-Date.now()));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearTimeout(timer);void close();});
}

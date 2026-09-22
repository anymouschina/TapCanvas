import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('shipped offline CLI creates, imports media, edits visual keys and validates a portable project',async()=>{
    const prefix=path.join(os.tmpdir(),'director-media-test-'),root=await fs.mkdtemp(prefix);
    const tool=fileURLToPath(new URL('../skills/director-desk/scripts/project-tool.mjs',import.meta.url));
    const file=(name:string)=>path.join(root,name),run=(...args:string[])=>execFileSync(process.execPath,[tool,...args],{encoding:'utf8'});
    try{
        run('create',file('base.director'),'--template','abstract-stage');
        const p=JSON.parse(await fs.readFile(file('base.director'),'utf8'));
        const id=p.entities.find((e:{asset:string})=>e.asset==='ground').id;
        await fs.writeFile(file('pixel.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'));
        run('import-media',file('base.director'),file('pixel.png'),file('media.director'),id);
        const imported=JSON.parse(await fs.readFile(file('media.director'),'utf8'));assert.equal(imported.media.length,1);assert.equal(imported.media[0].width,1);assert.equal(imported.media[0].name,'pixel.png');assert.ok(!JSON.stringify(imported).includes(root));
        await fs.writeFile(file('patch.json'),JSON.stringify([{operation:'add',asset:'cube',id:'offline-deform',patch:{deform:{type:'twist',amount:{keys:[{time:0,value:.23},{time:2,value:1.37}]},axis:'y',frequency:2,speed:1,seed:42}}}]));
        run('apply',file('media.director'),file('patch.json'),file('final.director'));assert.equal(JSON.parse(run('validate',file('final.director'))).ok,true);
        const final=JSON.parse(await fs.readFile(file('final.director'),'utf8'));assert.equal(final.entities.find((e:{id:string})=>e.id==='offline-deform').deform.amount.keys[1].value,1.37);
    }finally{assert.ok(path.resolve(root).startsWith(path.resolve(prefix)));await fs.rm(root,{recursive:true,force:true});}
});

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");
const { readFile, writeFile, mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("/app/node_modules/@aws-sdk/client-s3");
const exec = promisify(execFile);
const requiredEnv = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing env ${name}`);
  return value;
};
const PUB = requiredEnv("TOS_PUBLIC_BASE_URL").replace(/\/+$/,"");
const BUCKET = requiredEnv("TOS_BUCKET");
const ENDPOINT = new URL(requiredEnv("TOS_ENDPOINT_URL")).origin;
const s3 = new S3Client({ region: requiredEnv("TOS_REGION"), endpoint: ENDPOINT, forcePathStyle:false,
  credentials:{ accessKeyId: requiredEnv("TOS_ACCESS_KEY_ID"), secretAccessKey: requiredEnv("TOS_SECRET_ACCESS_KEY") }});
(async()=>{
 const url = process.argv[2];
 const wd = await mkdtemp(join(tmpdir(),"lf-"));
 try{
  const raw = join(wd,"in.mp4");
  // 下载（自有存储走 S3 GetObject）
  if(url.startsWith(PUB+"/")){const key=url.slice(PUB.length+1).split(/[?#]/)[0];
    const out=await s3.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));
    const b=await out.Body.transformToByteArray(); await writeFile(raw,Buffer.from(b));
  } else { const r=await fetch(url); await writeFile(raw,Buffer.from(await r.arrayBuffer())); }
  // 抽最后一帧（结束前 0.1s 取 1 帧）
  const png = join(wd,"last.png");
  await exec("ffmpeg",["-y","-sseof","-0.12","-i",raw,"-vframes","1","-q:v","2",png],{maxBuffer:1<<26});
  const body = await readFile(png);
  const key = `gen/images/lastframe/${new Date().toISOString().slice(0,10).replace(/-/g,"")}/${randomUUID()}.png`;
  await s3.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:body,ContentType:"image/png",CacheControl:"public, max-age=31536000, immutable"}));
  console.log("FRAME_URL "+PUB+"/"+key+" bytes="+body.length);
 } finally { await rm(wd,{recursive:true,force:true}).catch(()=>{}); }
})().catch(e=>{console.error("EXTRACT_ERR",e.message);process.exit(1)});

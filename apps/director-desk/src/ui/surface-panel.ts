import {writeChannel} from '../animation/write-channel.ts';
import type {AnimatedNumber} from '../animation/channels.ts';
import './surface-panel.css';
import type { AppContext } from '../app-context.ts';
import type { Entity } from '../model.ts';
import { assertProject } from '../model.ts';
import { defaultSurfaceLayer, FACES, MAPPINGS, type SurfaceLayer } from '../media/model.ts';
import { importMedia } from '../media/source.ts';
import { numberAt } from '../animation/channels.ts';
import { escape, options } from './common.ts';

const input=(key:string,label:string,value:number,step='.01',min='-1000',max='1000')=>`<label class="field"><span>${label}</span><input data-surface-field="${key}" type="number" value="${value}" step="any" data-increment="${step}" min="${min}" max="${max}"/></label>`;
const select=(key:string,label:string,values:[string,string][],value:string)=>`<label class="field"><span>${label}</span><select data-surface-choice="${key}">${options(values,value)}</select></label>`;
export function createSurfacePanel(ctx:AppContext){
    let layerId='',lastEntity='',appearanceKey='transmission',activeInput:HTMLInputElement|null=null;
    const layer=()=>ctx.current()?.surface?.layers.find(l=>l.id===layerId);
    const edit=(fn:(e:Entity)=>void)=>{const e=ctx.current();if(!e||e.locked||ctx.busy)return;ctx.change(()=>fn(ctx.current()!),false);};
    const put=(key:string,value:number)=>{const e=ctx.current()!;if(key.startsWith('appearance.')){const name=key.split('.')[1];e.surface??={layers:[]};Object.assign(e.surface,{[name]:name==='ior'?value:writeChannel((e.surface as unknown as Record<string,AnimatedNumber>)[name]??value,value,ctx.time)});return;}const l=layer()!;const [name,index]=key.split('.');if(index!==undefined)(l[name as keyof SurfaceLayer] as number[])[Number(index)]=value;else Object.assign(l,{[name]:name==='opacity'?writeChannel(l.opacity,value,ctx.time):value});};
    const finish=(cancel=false)=>{if(!activeInput)return;const field=activeInput;activeInput=null;try{if(cancel)throw Error('cancel');if(!field.checkValidity()||field.value==='')throw Error('请输入范围内的有效数值');assertProject(ctx.project);ctx.history.commit(ctx.project);ctx.changed(false);}catch(error){if(!cancel)ctx.toast((error as Error).message,true);ctx.project=ctx.history.rollback()??ctx.project;ctx.engine.project=ctx.project;ctx.engine.sample(ctx.time);ctx.renderPanels();}};
    window.addEventListener('blur',()=>finish());
    const host=document.querySelector('#inspector-content')!;
    host.addEventListener('input',event=>{const field=event.target as HTMLInputElement;if(!field.dataset.surfaceField||ctx.current()?.locked||ctx.busy||!field.checkValidity()||field.value==='')return;
        if(activeInput&&activeInput!==field)finish();if(!activeInput){if(ctx.history.pending)return;ctx.history.begin(ctx.project);activeInput=field;ctx.playing=false;}
        put(field.dataset.surfaceField,Number(field.value));ctx.engine.project=ctx.project;ctx.engine.sample(ctx.time);
    });
    host.addEventListener('change',event=>{const field=event.target as HTMLInputElement;if(field===activeInput){finish();return;}if(field.dataset.surfaceChoice)edit(()=>{const l=layer();if(!l)return;const k=field.dataset.surfaceChoice!;Object.assign(l,{[k]:['mesh','material'].includes(k)?Number(field.value):['unlit','loop','tile'].includes(k)?field.value==='true':field.value});});
        if(field.id==='surface-preview-quality'){ctx.engine.setPreviewQuality(field.value as 'full'|'draft');return;}
        if(field.id==='surface-appearance-key')appearanceKey=field.value;
        if(field.id==='surface-layer'){layerId=field.value;ctx.renderInspector();}
        if(field.id==='surface-library'&&field.value)edit(e=>{const l=defaultSurfaceLayer(field.value);if(e.light)e.surface={layers:[l]};else (e.surface??={layers:[]}).layers.push(l);layerId=l.id;});
    });
    host.addEventListener('focusout',event=>{if(event.target===activeInput)finish();});
    host.addEventListener('keydown',event=>{const e=event as KeyboardEvent;if(activeInput&&e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(true);}});
    host.addEventListener('pointerdown',event=>{if((event.target as HTMLElement).closest('[data-surface-action="key"]'))event.preventDefault();});
    host.addEventListener('click',event=>{const target=(event.target as HTMLElement).closest<HTMLElement>('[data-surface-action]');if(!target)return;const action=target.dataset.surfaceAction;
        if(action==='remove'){edit(e=>{e.surface!.layers=e.surface!.layers.filter(l=>l.id!==layerId);});return;}
        if(action==='reset'){edit(e=>{delete e.surface;});return;}
        if(action==='key'){
            const page=target.closest<HTMLElement>('[data-surface-section]')?.dataset.surfaceSection;
            const key=page==='appearance'?'appearance.'+appearanceKey:'opacity';
            const input=host.querySelector<HTMLInputElement>(`[data-surface-field="${key}"]`);
            if(!input||input.value===''||!input.checkValidity()){ctx.toast('请输入范围内的有效数值，尚未记录关键帧',true);input?.focus();return;}
            const value=Number(input.value),record=()=>{if(page==='appearance'){const e=ctx.current()!;e.surface??={layers:[]};const data=e.surface as unknown as Record<string,AnimatedNumber>;data[appearanceKey]=writeChannel(data[appearanceKey]??value,value,ctx.time,true);}else{const l=layer();if(l)l.opacity=writeChannel(l.opacity,value,ctx.time,true);}};
            if(activeInput){record();finish();}else edit(record);return;
        }
        if(action==='import')void choose();
    });
    async function choose(){const e=ctx.current();if(!e||e.locked||ctx.busy)return;const picker=document.createElement('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp,video/mp4,video/webm';
        picker.onchange=async()=>{const file=picker.files?.[0];if(!file)return;const project=ctx.project,id=e.id;ctx.busy=true;ctx.updateTimeUI();try{const resource=await importMedia(file);if(ctx.project!==project||ctx.current()?.id!==id||ctx.current()?.locked)throw Error('当前对象已改变，请重新导入');ctx.busy=false;edit(entity=>{ctx.project.media??=[];if(!ctx.project.media.some(r=>r.id===resource.id))ctx.project.media.push(resource);const l=defaultSurfaceLayer(resource.id);if(entity.light)entity.surface={layers:[l]};else (entity.surface??={layers:[]}).layers.push(l);layerId=l.id;});}catch(error){ctx.toast((error as Error).message,true);}finally{ctx.busy=false;ctx.updateTimeUI();}};picker.click();
    }
    return {render(e:Entity){if(lastEntity!==e.id){lastEntity=e.id;layerId='';}const s=e.surface;if(!s?.layers.some(l=>l.id===layerId))layerId=s?.layers[0]?.id??'';const l=layer();
        const resource=l&&ctx.project.media?.find(r=>r.id===l.resourceId);
        let html=`<div class="surface-panel"><div class="button-row"><button data-surface-action="import" class="primary">导入图片 / 视频</button><button data-surface-action="reset">恢复原材质</button></div>`;
        const pages:[string,string][]=e.light?[['source','媒体来源'],['layout','裁剪与排布'],['play','播放时间'],['mapping','透明度']]:[['source','媒体来源'],['target','承载表面'],['mapping','映射与透明度'],['layout','裁剪与排布'],['play','播放时间'],['appearance','光学材质']];
        html+=`<div class="surface-layer-select"><select id="surface-layer" aria-label="选择贴图层">${options((s?.layers??[]).map((l,i)=>[l.id,`${i+1} · ${ctx.project.media?.find(r=>r.id===l.resourceId)?.name??'媒体'}`]),layerId)}</select>${l?'<button data-surface-action="remove" aria-label="移除此贴图层" title="移除此贴图层">×</button>':''}</div>`;
        for(const [page,label] of pages){
        if(!l && !['source','appearance'].includes(page))continue;
        if(page==='play' && !resource?.mime.startsWith('video/'))continue;
        html+=`<section class="inspector-parameter-group" data-surface-section="${page}"><h3>${label}</h3>`;
        if(page==='source')html+=`<select id="surface-library" aria-label="复用工程媒体">${options([['','复用工程内的媒体'],...(ctx.project.media??[]).map(r=>[r.id,r.name] as [string,string])],'')}</select><p class="panel-help">同一素材共享源文件，各对象可独立裁剪。${resource?escape(resource.name)+' · '+resource.width+' × '+resource.height:''}</p><label class="field"><span>预览精度 · 导出仍用完整精度</span><select id="surface-preview-quality">${options([['full','完整'],['draft','流畅 · 视频纹理最长边 1024']],ctx.engine.previewQuality)}</select></label>`;
        else if(page==='appearance'){html+='<div class="surface-optical-grid">'+input('appearance.roughness','粗糙度',numberAt(s?.roughness,ctx.time,.7),'.01','0','1')+input('appearance.metalness','金属度',numberAt(s?.metalness,ctx.time,0),'.01','0','1')+input('appearance.transmission','透射',numberAt(s?.transmission,ctx.time,0),'.01','0','1')+input('appearance.ior','折射率',s?.ior??1.5,'.01','1','2.5')+input('appearance.opacity','整体透明度',numberAt(s?.opacity,ctx.time,1),'.01','0','1')+input('appearance.emissive','发光强度',numberAt(s?.emissive,ctx.time,0),'.1','0','20')+'</div>';}
        else if(!l)html+='<p class="panel-help">导入媒体后，选择承载表面和映射方式。图片与视频会进入摄影机画面。</p>';
        else if(page==='target'){const meshes=ctx.engine.surfaces.describe(ctx.engine.models.get(e.id)!);
            html+=select('mesh','承载模型部分',[['-1','整个对象'],...meshes.map(m=>[String(m.index),`${m.index} · ${m.name}`] as [string,string])],String(l.mesh));
            html+='<div class="field-pair">'+select('material','材质槽',[['-1','全部'],...Array.from({length:Math.max(0,...meshes.filter(m=>l.mesh===-1||m.index===l.mesh).map(m=>m.materials))},(_,i)=>[String(i),'材质 '+i] as [string,string])],String(l.material))+select('face','承载方向',Object.entries(FACES),l.face)+'</div>';
        }else if(page==='mapping'&&e.light){html+=input('opacity','投影透明度',numberAt(l.opacity,ctx.time,1),'.01','0','1')+'<button data-surface-action="key">K 透明度 · 当前时间</button><p class="panel-help">实际照明方向和强度在灯光页调整。</p>';}else if(page==='mapping'){html+='<div class="field-pair">'+select('mapping','映射方式',Object.entries(MAPPINGS),l.mapping)+select('fit','适配',[['stretch','拉伸'],['contain','适应'],['cover','填满']],l.fit)+'</div>';
            html+='<div class="field-pair">'+input('opacity','贴图透明度',numberAt(l.opacity,ctx.time,1),'.01','0','1')+select('unlit','显示方式',[['false','受场景光照'],['true','屏幕自发光']],String(l.unlit))+'</div><button data-surface-action="key">K 透明度 · 当前时间</button>';
         }else if(page==='layout'){html+='<div class="surface-arrangement"><div class="field-pair">'+input('crop.0','裁剪 X',l.crop[0],'.01','0','1')+input('crop.1','裁剪 Y',l.crop[1],'.01','0','1')+'</div><div class="field-pair">'+input('crop.2','裁剪宽',l.crop[2],'.01','.001','1')+input('crop.3','裁剪高',l.crop[3],'.01','.001','1')+'</div><div class="field-pair">'+input('offset.0','偏移 X',l.offset[0])+input('offset.1','偏移 Y',l.offset[1])+'</div><div class="field-pair">'+input('repeat.0','尺寸 X',l.repeat[0],'.1','.001')+input('repeat.1','尺寸 Y',l.repeat[1],'.1','.001')+'</div><div class="field-pair">'+input('rotation','角度 °',l.rotation,'1','-36000','36000')+select('tile','重复',[['false','关闭'],['true','平铺']],String(l.tile??false))+'</div></div>';}
        else if(page==='play'){html+=`<p class="panel-help">${escape(resource?.name??'')} · ${resource?.width} × ${resource?.height}${resource?.duration?' · '+resource.duration.toFixed(2)+' 秒':''}</p><div class="field-pair">`+input('start','戏段起播 / 秒',l.start,'.1','0','86400')+input('speed','播放倍速',l.speed,'.1','.01','100')+'</div><div class="field-pair">'+input('trimIn','素材入点 / 秒',l.trimIn,'.1','0','86400')+input('trimOut','素材出点（0 全长）',l.trimOut,'.1','0','86400')+'</div>'+select('loop','播放结束',[['true','循环'],['false','保持末帧']],String(l.loop));}
        if(page==='appearance')html+=`<div class="field-pair"><select id="surface-appearance-key" aria-label="光学关键帧参数">${options([['roughness','粗糙度'],['metalness','金属度'],['transmission','透射'],['opacity','整体透明度'],['emissive','发光强度']],appearanceKey)}</select><button data-surface-action="key">记录当前值 · ${ctx.time.toFixed(2)} 秒</button></div>`;
        html+='</section>';
        }
        return html+'</div>';
    }};
}

import type { AppContext } from '../app-context.ts';
import { assertProject, type Entity } from '../model.ts';
import { numberAt, type AnimatedNumber } from '../animation/channels.ts';
import { writeChannel } from '../animation/write-channel.ts';
import { defaultDeform } from '../visuals/deformation.ts';
import { DEFORM_TYPES } from '../visuals/model.ts';
import { escape,options } from './common.ts';
import './surface-panel.css';
const labels:Record<string,string>={size:'粒径 / 宽度',spread:'分布范围',speed:'速度',amplitude:'波动幅度',frequency:'频率',opacity:'透明度',strength:'影响强度',amount:'形变幅度'};
export function createVisualPanel(ctx:AppContext){let deformOnly=false,parameter='size',owner='',field:HTMLInputElement|null=null;
    const data=()=>{const e=ctx.current();return (deformOnly?e?.deform:e?.visual??e?.field??e?.warp??e?.deform) as unknown as Record<string,unknown>|undefined;};
    const edit=(fn:()=>void,rebuild=false)=>{if(!ctx.current()?.locked&&!ctx.busy)ctx.change(fn,rebuild);};
    const commit=(cancel=false)=>{if(!field)return;const input=field;field=null;try{if(cancel)throw Error('cancel');if(!input.value||!input.checkValidity())throw Error('请输入范围内的有效数值');assertProject(ctx.project);ctx.history.commit(ctx.project);ctx.changed(false);}catch(error){if(!cancel)ctx.toast((error as Error).message,true);ctx.project=ctx.history.rollback()??ctx.project;ctx.engine.project=ctx.project;ctx.engine.sample(ctx.time);ctx.renderPanels();}};
    window.addEventListener('blur',()=>commit());
    const host=document.querySelector('#inspector-content')!;
    host.addEventListener('input',event=>{const target=event.target as HTMLInputElement;if(target.id!=='visual-value'||ctx.busy||ctx.current()?.locked||target.value===''||!target.checkValidity())return;
        if(!field){if(ctx.history.pending)return;ctx.history.begin(ctx.project);field=target;ctx.playing=false;}const object=data()!;object[parameter]=writeChannel(object[parameter] as AnimatedNumber,Number(target.value),ctx.time);ctx.engine.project=ctx.project;ctx.engine.sample(ctx.time);
    });
    host.addEventListener('focusout',event=>{if(event.target===field)commit();});host.addEventListener('keydown',event=>{if(field&&(event as KeyboardEvent).key==='Escape'){event.stopPropagation();commit(true);}});
    host.addEventListener('change',event=>{const target=event.target as HTMLInputElement;if(target===field){commit();return;}
        if(target.id==='visual-parameter'){parameter=target.value;ctx.renderInspector();return;}
        if(target.id==='deform-type'){edit(()=>{const e=ctx.current()!;e.deform=target.value?defaultDeform(target.value as keyof typeof DEFORM_TYPES):null;});return;}
        const key=target.dataset.visualSetting;if(key){edit(()=>{const object=data()!;object[key]=target.type==='checkbox'?target.checked:target.type==='number'?Number(target.value):key==='targets'?[...host.querySelectorAll<HTMLOptionElement>('#field-targets option:checked')].map(o=>o.value):target.value;},['count','seed','text','additive','secondaryColor','quality'].includes(key));}
    });
    // Keep the input mounted until its value and key are committed together. Native blur
    // otherwise rebuilds this button between pointerdown and click, swallowing the click.
    host.addEventListener('pointerdown',event=>{if((event.target as HTMLElement).closest('#visual-key'))event.preventDefault();});
    host.addEventListener('click',event=>{
        if(!(event.target as HTMLElement).closest('#visual-key')||ctx.busy||ctx.current()?.locked)return;
        const input=host.querySelector<HTMLInputElement>('#visual-value');
        if(!input||input.value===''||!input.checkValidity()){
            ctx.toast(`请输入 ${input?.min??''} 至 ${input?.max??''} 之间的有效数值，尚未记录关键帧`,true);input?.focus();return;
        }
        const value=Number(input.value);
        const record=()=>{const object=data();if(object)object[parameter]=writeChannel(object[parameter] as AnimatedNumber,value,ctx.time,true);};
        if(field){record();commit();}else edit(record);
    });
    return {render(e:Entity,onlyDeform=false){deformOnly=onlyDeform;if(deformOnly)e={...e,visual:undefined,field:undefined,warp:undefined};if(owner!==e.id+':'+deformOnly){owner=e.id+':'+deformOnly;parameter=e.visual?'size':e.field||e.warp?'strength':'amount';}const object=data();let html='<div class="surface-panel">';
        if(!e.visual&&!e.field&&!e.warp)html+=`<div class="field-pair"><label class="field"><span>形体变化</span><select id="deform-type">${options([['','关闭'],...Object.entries(DEFORM_TYPES)],e.deform?.type??'')}</select></label>${e.deform?`<label class="field"><span>作用轴</span><select data-visual-setting="axis">${options([['x','X'],['y','Y'],['z','Z']],e.deform.axis)}</select></label>`:''}</div>`;
        if(!object)return html+'<p class="panel-help">为对象添加弯曲、扭转、膨胀或坍缩。幅度可记录关键帧。</p></div>';
        const parameters=e.visual?['size','spread','speed','amplitude','frequency','opacity']:e.field||e.warp?['strength']:['amount'];if(!parameters.includes(parameter))parameter=parameters[0];
        if(object){
            const minimum=e.warp?-2:parameter==='speed'||parameter==='strength'?-100:parameter==='amount'?-10:parameter==='size'||parameter==='spread'?.001:0;
            const maximum=parameter==='opacity'?1:parameter==='amount'?10:e.warp?2:parameter==='spread'?1000:100;
            const value=numberAt(object[parameter] as AnimatedNumber,ctx.time);
            const control=`<label class="field"><span>${labels[parameter]}</span><input id="visual-value" type="number" step="any" min="${minimum}" max="${maximum}" value="${value}"/></label>`;
            const button=`<button id="visual-key" title="记录当前值 ${value}">记录关键帧 · ${ctx.time.toFixed(2)} 秒</button>`;
            if(e.visual)html+=`<div class="field-pair"><label class="field"><span>动画参数</span><select id="visual-parameter">${options(parameters.map(p=>[p,labels[p]]),parameter)}</select></label>${control}</div>${button}`;
            else html+=`<div class="field-pair surface-key-row">${control}${button}</div>`;
        }
        const numeric=(key:string,label:string,min:number,max:number)=>`<label class="field"><span>${label}</span><input type="number" data-visual-setting="${key}" value="${object[key]}" min="${min}" max="${max}" step="${key==='count'||key==='seed'?1:'any'}"/></label>`;
        if(e.visual){if(e.visual.preset==='portal')html+=`<label class="field"><span>另一侧摄影机</span><select data-visual-setting="cameraId">${options([['','选择摄影机'],...ctx.project.entities.filter(x=>x.camera).map(x=>[x.id,x.name] as [string,string])],e.visual.cameraId??'')}</select></label>`;if(e.visual)html+='<h3 class="parameter-divider">数量与时间</h3><div class="field-pair">'+numeric('count','数量',1,50000)+numeric('seed','随机种子',0,2147483647)+'</div><div class="field-pair">'+numeric('start','开始 / 秒',0,86400)+numeric('end','结束（0 全程）',0,86400)+'</div>';
            if(e.visual)html+=numeric('lifetime','循环寿命 / 秒',.1,1000);
            if(['text','data'].includes(e.visual.preset))html+=`<label class="field"><span>内容</span><input type="text" data-visual-setting="text" maxlength="500" value="${escape(e.visual.text)}"/></label>`;
            if(e.visual)html+=`<h3 class="parameter-divider">显示效果</h3><div class="field-pair"><label class="field"><span>辅助颜色</span><input type="color" data-visual-setting="secondaryColor" value="${e.visual.secondaryColor}"/></label><label class="field"><span>细节质量</span><select data-visual-setting="quality">${options([['draft','草稿 · 1/4 粒子'],['normal','标准'],['high','完整 · 视图 2048']],e.visual.quality)}</select></label></div>`;
        }else if(e.warp){html+='<div class="field-pair">'+numeric('radius','影响半径 / 米',.01,1000)+numeric('frequency','频率',0,100)+'</div>'+numeric('speed','变化速度',-100,100)+'<p class="panel-help">在拍摄画面中作用于此区域，可与镜头畸变叠加。</p>';}else if(e.field){html+='<div class="field-pair">'+numeric('radius','作用半径 / 米',.01,1000)+numeric('falloff','边缘衰减',0,10)+'</div>';
            html+=`<label class="field"><span>作用对象（可多选，留空影响视觉元素）</span><select id="field-targets" data-visual-setting="targets" multiple size="3">${ctx.project.entities.filter(t=>t.id!==e.id&&t.kind!=='camera'&&!t.field&&!t.warp).map(t=>`<option value="${t.id}" ${e.field!.targets.includes(t.id)?'selected':''}>${escape(t.name)}</option>`).join('')}</select></label><div class="field-pair">`+numeric('start','开始 / 秒',0,86400)+numeric('end','结束（0 全程）',0,86400)+'</div>';
        }else{if(e.deform!.type==='wave')html+='<div class="field-pair">'+numeric('frequency','波动频率',0,100)+numeric('speed','波动速度',-100,100)+'</div>';html+='<p class="panel-help">在不同时间记录不同幅度，播放时自动过渡。</p>';}
        return html+'</div>';
    }};
}

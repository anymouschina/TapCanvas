import type { AssetDefinition } from './types.ts';

export const HAND_PROP_SPECS = [
    {id:'prop-cup',name:'杯子 · 空心',style:'cup',width:.10,height:.10,depth:.08,aliases:['水杯','cup']},
    {id:'prop-bowl',name:'碗',style:'bowl',width:.18,height:.09,depth:.18,aliases:['bowl']},
    {id:'prop-plate',name:'盘子',style:'plate',width:.25,height:.025,depth:.25,aliases:['碟','plate']},
    {id:'prop-bottle',name:'瓶子',style:'bottle',width:.075,height:.28,depth:.075,aliases:['水瓶','bottle']},
    {id:'prop-book',name:'书',style:'book',width:.16,height:.035,depth:.24,aliases:['书本','book']},
    {id:'prop-phone',name:'手机',style:'phone',width:.075,height:.008,depth:.155,aliases:['电话','phone']},
    {id:'prop-suitcase',name:'行李箱',style:'suitcase',width:.40,height:.60,depth:.25,aliases:['旅行箱','suitcase']},
    {id:'prop-backpack',name:'背包',style:'backpack',width:.30,height:.48,depth:.20,aliases:['书包','箱包','backpack']},
] as const;
export const HAND_PROP_ASSETS: readonly AssetDefinition[] = HAND_PROP_SPECS.map(s=>({id:s.id,name:s.name,kind:'prop',group:'生活道具',icon:'◇',family:'hand-prop-v1',aliases:s.aliases,
    capabilities:{rig:'none',actions:[],pose:false,path:true},parameters:Object.fromEntries(([['width','宽度'],['height','高度'],['depth','进深']] as const).map(([key,label])=>[key,{label,default:s[key],min:.002,max:20,step:.005,unit:'米'}]))}));

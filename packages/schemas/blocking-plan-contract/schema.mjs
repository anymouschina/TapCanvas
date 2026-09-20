import { KEYFRAME_FOCUS_KINDS, KEYFRAME_SHOT_SCALES, KEYFRAME_VISUAL_WEIGHTS, KEYFRAME_DEPTH_LAYERS, KEYFRAME_CENTER_PLACEMENTS } from '../keyframe-composition-contract/constants.mjs';
const text = {type:'string',minLength:1};
const enumeration = values => ({type:'string',enum:[...values]});
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array = items => ({type:'array',items});
export const normalizedPointSchema = {...array({type:'number',minimum:0,maximum:1}),minItems:2,maxItems:2};
export const compositionSchema = object({
  narrativeTask:{...text,maxLength:240}, focusKind:enumeration(KEYFRAME_FOCUS_KINDS),
  focusTargetNames:{...array({...text,maxLength:80}),minItems:1,maxItems:24,uniqueItems:true},
  focalPoint:normalizedPointSchema, shotScale:enumeration(KEYFRAME_SHOT_SCALES),
  environmentVisualWeight:enumeration(KEYFRAME_VISUAL_WEIGHTS),
  subjects:{...array(object({name:{...text,maxLength:80},visualWeight:enumeration(KEYFRAME_VISUAL_WEIGHTS),
    depthLayer:enumeration(KEYFRAME_DEPTH_LAYERS),centerPlacement:enumeration(KEYFRAME_CENTER_PLACEMENTS),
    maxFrameHeightRatio:{type:'number',minimum:0.05,maximum:1}})),maxItems:24},
});
export const backgroundPlanSchema = object({assetId:{...text,description:'Generation identity: repeating this ID requires identical complete backgroundPlan fields. Author distinct IDs for intentionally different background states.'},displayName:text,prompt:text,negativePrompt:text,
  referenceAssetBindings:array(object({assetId:{...text,'x-referenceSource':'project_image'},role:enumeration(['layout','content','identity','style'])}))});
const landmarkSchema = {anyOf:[
  object({kind:{const:'wall',type:'string'},from:normalizedPointSchema,to:normalizedPointSchema,label:text}),
  object({kind:{const:'door',type:'string'},at:normalizedPointSchema,orient:enumeration(['h','v']),lengthN:{type:'number',exclusiveMinimum:0,maximum:1},swing:enumeration(['in','out','none']),label:text}),
  object({kind:{const:'area',type:'string'},at:normalizedPointSchema,label:text}),
]};
export const blockingPlanFields = ['clipIndex','title','sceneName','durationSeconds','backgroundImageUrl','backgroundPlan','bg','width','height','landmarks','characters','camera','axisLine','compositionContract'];
/** Minimal complete authored transport. Optional rendering decorations stay off strict schemas. */
export const blockingPlanSchema = object({clipIndex:{type:'integer',minimum:0},title:text,sceneName:text,
  durationSeconds:{type:'number',exclusiveMinimum:0},backgroundPlan:backgroundPlanSchema,
  landmarks:array(landmarkSchema),characters:array(object({name:text,at:normalizedPointSchema,facingTo:{anyOf:[normalizedPointSchema,{type:"null"}]},moveTo:{anyOf:[normalizedPointSchema,{type:"null"}]}})),
  camera:object({at:normalizedPointSchema,lookAt:normalizedPointSchema}),compositionContract:compositionSchema});

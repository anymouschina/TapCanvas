#!/usr/bin/env node
/**
 * generate-style-reference-cards.mjs
 *
 * 生成 50 个画风参考角色卡，写入 llm_node_presets (scope=base, type=image)。
 *
 * 用法:
 *   node scripts/generate-style-reference-cards.mjs \
 *     --api http://localhost:8788 \
 *     --token <Bearer token> \
 *     [--dry-run]          # 只打印请求，不实际调用
 *     [--concurrency 3]    # 并发数，默认 3
 *     [--out-json results/style-cards.json]
 *     [--out-sql sql/patch/2026-04-24-style-reference-cards.sql]
 *
 * 产出:
 *   - results/style-cards-YYYYMMDD.json   每张卡的标题/提示词/图片URL
 *   - sql/patch/2026-04-24-style-reference-cards.sql  可直接 seed 到 prod
 *
 * 依赖: Node 18+（原生 fetch），无需额外安装包
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'

// ─── 100 种画风定义 ──────────────────────────────────────────────────────────
// 格式: { id, title, description, styleDirective }
// styleDirective 会拼入 prompt 末尾的"风格设计："字段
const STYLE_CARDS = [
  // === 日系动漫 (15) ===
  { id: 's01', title: '日式热血少年漫', description: '粗线条、强力感、夸张表情，适合动作/冒险题材', styleDirective: '日式热血少年漫画，粗线条，充满力量感，夸张动态，高对比度，男主角半身像' },
  { id: 's02', title: '日式少女恋爱漫', description: '柔和线条、星形瞳孔、粉色调，适合恋爱/青春题材', styleDirective: '日式少女漫画，柔和线条，星形瞳孔，粉色蜜桃色调，花朵光效，女主角半身像' },
  { id: 's03', title: '日式克苏鲁恐怖', description: '诡异构图、暗色渲染、触手元素，适合恐怖/悬疑题材', styleDirective: '日式克苏鲁恐怖漫画，诡异构图，暗黑压抑色调，触手与异形元素，角色痛苦表情，半身像' },
  { id: 's04', title: '日式赛博科幻漫', description: '霓虹灯+机械，适合近未来科幻题材', styleDirective: '日式赛博朋克科幻漫画，霓虹灯光，机械义肢，雨夜城市背景，角色半身像，高饱和色' },
  { id: 's05', title: '日式奇幻魔法漫', description: '魔法阵、宝石色系，适合奇幻/异世界题材', styleDirective: '日式奇幻魔法漫画，华丽魔法阵背景，宝石色系服装，魔法师角色，半身像，光芒特效' },
  { id: 's06', title: '日式温馨日常漫', description: '淡彩暖色、圆润线条，适合治愈/日常题材', styleDirective: '日式温馨日常漫画，淡彩暖色调，圆润柔和线条，咖啡馆背景，日常服装，微笑角色半身像' },
  { id: 's07', title: 'Q版萌系漫画', description: '2头身比例、超大眼睛，适合轻松/卖萌题材', styleDirective: '日式Q版萌系漫画，2头身比例，超大闪亮眼睛，圆润可爱造型，表情包式表情，全身立绘' },
  { id: 's08', title: '80年代复古手绘漫', description: '怀旧手绘感、印刷网点，适合复古/穿越题材', styleDirective: '80年代复古手绘日漫风格，印刷网点纹理，分格线条，老旧黄化纸张感，复古配色，角色半身像' },
  { id: 's09', title: '少女系水彩插画', description: '水彩晕染、梦幻透明感，适合抒情/诗意场景', styleDirective: '日式少女风水彩插画，水彩晕染透明感，花卉与蝴蝶装饰，梦幻柔美色调，女性角色半身像' },
  { id: 's10', title: '新海诚电影风', description: '超精细光影、蓝色天空背景，适合青春/情感题材', styleDirective: '新海诚动画电影风格，超精细光影渲染，蓝色光晕天空，高饱和度自然环境，青春角色侧身像' },
  { id: 's11', title: '鬼灭大正复古风', description: '大正和风、拼布图案，适合日式历史/武士题材', styleDirective: '鬼灭之刃大正时代和风漫画，拼布和服图案，民俗纹样，炭焰特效，武士角色全身立绘' },
  { id: 's12', title: '格斗动作漫画', description: '速度线、碎裂特效，适合武斗/格斗竞技题材', styleDirective: '格斗动漫风格，速度线，碎裂岩石特效，肌肉张力，战斗姿势，对比色背景，角色全身立绘' },
  { id: 's13', title: '赛马娘卡牌风', description: '闪卡质感、竞技感，适合运动/竞技题材', styleDirective: '赛马娘式运动女子漫画卡牌风格，闪亮反光卡面，彩虹光泽，运动服装，活力动态造型，全身立绘' },
  { id: 's14', title: '进击的巨人写实漫', description: '写实阴影、战争感，适合黑暗/战争题材', styleDirective: '进击的巨人风格写实漫画，写实人体比例，强烈明暗对比，破损服装，严峻表情，战场背景，半身像' },
  { id: 's15', title: '恶魔城哥特暗黑', description: '蜡烛烛光、哥特建筑背景，适合恐怖游戏改编题材', styleDirective: '哥特暗黑风格漫画，烛光渲染，哥特城堡背景，华丽暗色服装，吸血鬼气质角色，全身立绘' },

  // === 中国画风 (10) ===
  { id: 's16', title: '国风工笔画', description: '精细勾线、矿物色，适合古典/宫廷题材', styleDirective: '中国工笔画风格，精细勾线，矿物色彩，古典服饰，宫廷背景，女性角色半身像，典雅精致' },
  { id: 's17', title: '国风水墨写意', description: '水墨浓淡、留白意境，适合诗意/禅意题材', styleDirective: '中国水墨写意画风格，墨色浓淡变化，大量留白，意境深远，古风人物，文人气质，半身像' },
  { id: 's18', title: '仙侠修炼风', description: '仙气灵光、飞剑云雾，适合玄幻/修仙题材', styleDirective: '中国仙侠漫画风格，仙气灵光效果，飞剑云雾，道袍仙服，修炼者角色，全身立绘，飘逸感' },
  { id: 's19', title: '民国旗袍风', description: '老上海美学、复古暖色，适合民国/谍战题材', styleDirective: '民国风格漫画插画，旗袍女性造型，老上海街景背景，复古暖褐色调，蕾丝与绸缎质感，半身像' },
  { id: 's20', title: '国潮嘻哈风', description: '潮流汉字设计、饶舌感，适合现代国风/青年文化', styleDirective: '国潮嘻哈风格，汉字图形设计，潮牌涂鸦元素，国风与街头文化融合，年轻男性角色，全身立绘' },
  { id: 's21', title: '敦煌壁画风', description: '飞天造型、赭石色调，适合丝绸之路/历史奇幻题材', styleDirective: '敦煌壁画艺术风格，飞天造型，赭石与青金石色调，莲花与云纹装饰，历史人物，半身像' },
  { id: 's22', title: '武侠江湖风', description: '武馆与竹林背景、侠气，适合武侠小说改编题材', styleDirective: '中国武侠漫画风格，竹林或茶楼背景，武侠服饰，剑气挥洒，侠客气质，全身动作立绘' },
  { id: 's23', title: '三国战国风', description: '铠甲战马、战旗，适合历史战争题材', styleDirective: '三国战争漫画风格，汉代铠甲，战旗猎猎，战场烽烟，武将角色，全身立绘，威武气势' },
  { id: 's24', title: '现代都市国漫', description: '都市霓虹、时尚青年，适合现实题材国漫', styleDirective: '现代都市中国漫画风格，城市霓虹背景，时尚年轻人服装，高饱和流行色，当代青年角色，全身立绘' },
  { id: 's25', title: '玄幻道门风', description: '道符术法、阴阳八卦，适合东方玄幻题材', styleDirective: '东方玄幻道门风格，阴阳八卦背景，道符特效，黑白阴阳色调，道士角色，全身立绘，神秘感' },

  // === 欧美风格 (10) ===
  { id: 's26', title: '美式超级英雄漫', description: '夸张肌肉、动态构图，适合超能力/英雄题材', styleDirective: '美式超级英雄漫画风格，夸张肌肉线条，强烈透视动态，超英服装，城市背景，全身动作立绘' },
  { id: 's27', title: '欧洲写实线稿漫', description: '精细写实素描、老漫画感，适合历史/冒险题材', styleDirective: '欧洲写实风格漫画，精细铅笔素描线稿，立体明暗，历史题材服装，成熟男性角色，半身像' },
  { id: 's28', title: '赛博朋克写实风', description: '照片级渲染、赛博贫民窟，适合近未来题材', styleDirective: '赛博朋克写实风格，照片级CG渲染，贫民窟背景，机械改造身体，雨中霓虹，角色半身像' },
  { id: 's29', title: '蒸汽朋克维多利亚', description: '齿轮与气球、雾都背景，适合架空历史题材', styleDirective: '蒸汽朋克维多利亚风格，铜质齿轮与飞艇，雾都伦敦背景，蒸汽机械服装，英伦绅士气质，全身立绘' },
  { id: 's30', title: '史诗奇幻魔法风', description: '史诗龙与地下城感，适合高魔幻/西方奇幻题材', styleDirective: '西方奇幻史诗风格，中世纪魔法背景，龙族元素，宝甲圣骑士，华丽魔法特效，全身立绘' },
  { id: 's31', title: '黑色电影诺瓦尔', description: '高反差黑白、烟雾探侦感，适合黑色电影/悬疑题材', styleDirective: '黑色电影诺瓦尔风格，高对比度黑白，烟雾与阴影，硬汉侦探角色，雨夜街道，半身像' },
  { id: 's32', title: '波普艺术风', description: '网点色块、安迪沃霍感，适合流行文化题材', styleDirective: '波普艺术风格插画，网点色块，原色平涂，安迪沃霍式重复图案，当代偶像角色，半身像' },
  { id: 's33', title: '迪士尼动画风', description: '大眼、圆润、童话色彩，适合童话/亲子题材', styleDirective: '迪士尼动画风格，大圆眼，圆润造型，童话糖果色调，公主服装，表情生动，全身立绘' },
  { id: 's34', title: '卡通网络风格', description: '夸张变形、实验性设计，适合搞笑/成人动画题材', styleDirective: '卡通网络动画风格，夸张变形造型，荧光色调，实验性线条，搞怪成人动画气质，全身立绘' },
  { id: 's35', title: '漫威CG概念艺术', description: '电影级概念艺术质感，适合宇宙英雄题材', styleDirective: '漫威电影宇宙概念艺术风格，影视级CG渲染，超级英雄战甲，宇宙星云背景，角色全身立绘' },

  // === 插画/混合风格 (10) ===
  { id: 's36', title: '水彩梦幻插画', description: '水彩晕染、蝴蝶与花卉，适合奇幻/抒情题材', styleDirective: '梦幻水彩插画风格，柔和晕染，蝴蝶与花卉装饰，梦境般色彩，精灵气质角色，全身立绘' },
  { id: 's37', title: '油画厚涂写实', description: '厚重笔触、古典肖像感，适合传记/历史题材', styleDirective: '油画厚涂写实风格，厚重笔触质感，古典肖像画构图，丰富光影，历史人物气质，半身像' },
  { id: 's38', title: '极简线条风格', description: '极简单线、留白大量，适合现代/商务题材', styleDirective: '极简线条插画风格，最少笔画，大量留白，单色或双色，现代简约，角色轮廓半身像' },
  { id: 's39', title: '扁平设计风格', description: '几何形状、无阴影，适合APP/互联网内容', styleDirective: '扁平设计风格插画，几何造型，无阴影无渐变，纯色色块，现代化配色，角色全身立绘' },
  { id: 's40', title: '像素游戏风格', description: '像素颗粒感、8bit配色，适合游戏题材', styleDirective: '像素游戏风格艺术，16x16或32x32像素颗粒，复古8bit配色，游戏角色精灵图，全身立绘' },
  { id: 's41', title: '霓虹发光赛博风', description: '霓虹光效、黑暗底色，适合科幻/音乐题材', styleDirective: '霓虹发光赛博风格插画，黑色底色，霓虹紫蓝粉发光线条，电子音乐感，DJ角色，全身立绘' },
  { id: 's42', title: '哥特暗黑荧光风', description: '暗色+荧光撞色，适合暗黑/摇滚题材', styleDirective: '哥特暗黑荧光风格，暗色调与荧光绿紫撞色，骷髅与玫瑰装饰，摇滚朋克服装，角色全身立绘' },
  { id: 's43', title: '水彩童话绘本', description: '手绘暖色、儿童插图感，适合童话/儿童故事', styleDirective: '水彩童话绘本风格，手绘暖色调，质朴线条，儿童故事氛围，小精灵角色，全身可爱立绘' },
  { id: 's44', title: '超现实主义插画', description: '梦境变形、达利感，适合艺术/文学题材', styleDirective: '超现实主义插画风格，达利式梦境变形，不合逻辑的空间，精细写实与荒诞结合，人物半身像' },
  { id: 's45', title: '复古海报宣传画', description: '苏联或民国海报感，适合历史/宣传题材', styleDirective: '复古宣传海报风格，苏联或民国海报美学，平涂色块，粗体字配图，英雄主义构图，全身立绘' },

  // === 题材专属风格 (5) ===
  { id: 's46', title: '末日废土风格', description: '破败环境、求生感，适合末日/废土题材', styleDirective: '末日废土风格漫画，破败城市背景，求生装备，尘土与锈迹，硬汉角色，全身立绘，棕灰色调' },
  { id: 's47', title: '校园偶像青春风', description: '制服、校园青春光感，适合青春偶像题材', styleDirective: '校园青春偶像风格，学生制服，樱花飘散背景，青春阳光色调，帅气男生角色，全身立绘' },
  { id: 's48', title: '都市精英商战风', description: '西装笔挺、商务感，适合职场/商战题材', styleDirective: '都市商战精英风格，定制西装，摩天大楼背景，商务冷感配色，强势精英角色，半身像' },
  { id: 's49', title: '星际宇宙科幻风', description: '宇航服、星云背景，适合太空科幻题材', styleDirective: '星际宇宙科幻风格，宇航员太空服，星云与行星背景，零重力飘浮感，宇宙探险家角色，全身立绘' },
  { id: 's50', title: '洛夫克拉夫特宇宙恐怖', description: '古神异形、非欧几何，适合克苏鲁恐怖题材', styleDirective: '洛夫克拉夫特宇宙恐怖风格，古神与触手，非欧几里得几何空间，深海与宇宙恐怖，角色半身像' },

  // === 韩国/亚洲特色 (5) ===
  { id: 's51', title: '韩系Webtoon条漫风', description: '竖向长条分镜、韩系美型，适合都市恋爱/青春题材', styleDirective: '韩系Webtoon竖条漫画，长条版面分镜构图，清晰流畅线条，韩系精致美型脸庞，时尚都市服装，简洁留白背景，角色半身正面像' },
  { id: 's52', title: '韩系甜美治愈插画', description: '棉花糖色调、素净手绘感，适合日常治愈/轻松题材', styleDirective: '韩系甜美治愈插画，棉花糖粉蜜桃色调，圆润温柔线条，日常咖啡馆背景，淡妆素颜女性角色，手绘质感，半身像' },
  { id: 's53', title: '东南亚神话传说风', description: '泰缅金箔纹样、热带鲜艳色，适合东南亚神话/传说题材', styleDirective: '东南亚神话传说插画，泰国或缅甸传统金箔纹样装饰，鲜艳热带色彩，神话仙女舞者造型，华丽盘发与金银首饰，全身立绘' },
  { id: 's54', title: '印度莫卧儿细密画风', description: '精密彩绘、莲花孔雀纹样，适合印度宫廷/神话题材', styleDirective: '印度莫卧儿细密画风格，精密彩绘装饰边框，丰富植物纹样，宫廷服饰与珠宝，莲花与孔雀图案，古典舞者造型，全身立绘' },
  { id: 's55', title: '日本平安朝宫廷风', description: '十二单衣、大和绘柔美，适合日本古典/宫廷题材', styleDirective: '日本平安时代宫廷风格，十二单衣层叠服装，大和绘柔美线条，宫廷贵族气质，和歌文学氛围，雅致女性角色，半身像' },

  // === 更多日系 (8) ===
  { id: 's56', title: '热血运动竞技漫', description: '汗水飞溅、球场热血，适合运动/竞技题材', styleDirective: '日系热血运动竞技漫画，篮球或足球场背景，汗水飞溅特效，运动制服，顶级竞技状态，充满胜负欲的男性角色，全身动作立绘' },
  { id: 's57', title: '乙女恋爱游戏CG风', description: '游戏竖立绘、唯美光效，适合恋爱模拟/乙女游戏题材', styleDirective: '乙女恋爱模拟游戏CG立绘风格，竖版立绘格式，游戏UI光晕框，丰富光效背景，浪漫场景，温柔绅士男性主角，全身立绘' },
  { id: 's58', title: '日系推理本格悬疑风', description: '侦探西装、冷峻智慧，适合本格推理/悬疑题材', styleDirective: '日系推理本格悬疑漫画，暗色调阴影，侦探西装礼帽，线索与密码装饰图案，冷峻智慧气质，福尔摩斯式角色，半身像' },
  { id: 's59', title: '异世界转生轻小说封面风', description: '系统界面特效、异世界幻境，适合异世界转生/轻小说题材', styleDirective: '日系异世界转生轻小说封面风格，魔法光效满屏，华丽系统界面边框，转生主角异世界服装，奇幻仙境背景，全身立绘' },
  { id: 's60', title: 'JRPG角色设计风', description: '职业框、技能图标，适合日系RPG/游戏改编题材', styleDirective: '日系JRPG角色设计风格，游戏人物展示构图，技能图标边框装饰，华丽职业冒险者服装，全身正面立绘，精细轮廓线' },
  { id: 's61', title: '虚拟偶像歌姬风', description: '全息投影、声波纹路，适合虚拟偶像/音乐题材', styleDirective: '虚拟偶像歌姬风格，全息投影半透明感，电子音符与声波纹路装饰，未来派演唱服，科技感少女气质，全身立绘，发光特效' },
  { id: 's62', title: '日式怪谈灵异恐怖', description: '白发遮面、幽灵阴冷感，适合日式怪谈/灵异题材', styleDirective: '日式怪谈灵异恐怖漫画，白发长发遮面，幽灵半透明感，暗夜墓地背景，阴冷诡异气质，女鬼角色，全身立绘' },
  { id: 's63', title: '赛博和风融合风', description: '和服与电路板融合、东西混搭，适合赛博和风/科幻历史题材', styleDirective: '赛博和风混合风格，和服与电路板纹样融合，赛博霓虹与传统鸟居背景，东西融合美学，武装和服角色，全身立绘' },

  // === 中国民族/地域特色 (3) ===
  { id: 's64', title: '苗族银饰刺绣风', description: '苗绣几何纹、银制头饰，适合西南民族/苗族文化题材', styleDirective: '苗族银饰刺绣风格，苗绣几何纹样，银制头饰与项圈，鲜艳彩色刺绣服装，西南民族气质，贵州山野背景，全身立绘' },
  { id: 's65', title: '西藏唐卡金箔风', description: '金线描边、佛教纹样，适合藏族文化/宗教题材', styleDirective: '西藏唐卡金箔绘画风格，金色线描轮廓，佛教装饰纹样，五彩莲花台座，法器与宝冠，菩萨造型，全身立绘' },
  { id: 's66', title: '皮影剪纸民俗风', description: '剪纸镂空、皮影侧轮廓，适合中国民俗/非遗题材', styleDirective: '中国皮影剪纸民俗风格，剪纸镂空装饰，皮影侧面轮廓，红橙灯光暖背景，传统戏曲人物，民俗工艺质感，全身侧面立绘' },

  // === 西方/全球 (9) ===
  { id: 's67', title: '美式独立漫画风', description: '粗糙手绘、油墨质感，适合独立漫画/黑色故事题材', styleDirective: '美国独立漫画Indie Comics风格，粗糙手绘线条，油墨印刷质感，硬派黑色故事氛围，有瑕疵的日常英雄，街头角色，半身像' },
  { id: 's68', title: '英伦图像小说风', description: '成熟写实素描、厚重叙事感，适合成人图像小说/悬疑题材', styleDirective: '英国图像小说Graphic Novel风格，精细写实素描，成熟暗沉色调，浓厚叙事感，伦敦街头背景，成熟男女角色，半身像' },
  { id: 's69', title: '法国BD欧陆漫画风', description: '欧陆写实比例、细腻钢笔线条，适合欧陆冒险/写实漫画题材', styleDirective: '法国BD欧陆漫画风格，写实人体比例，细腻钢笔线条，欧洲城市街头背景，欧美成熟气质角色，冒险家造型，半身像' },
  { id: 's70', title: '墨西哥亡灵节彩色风', description: '骷髅花卉彩绘、鲜橙紫蓝，适合亡灵节/拉美文化题材', styleDirective: '墨西哥亡灵节艺术风格，骷髅面孔花卉彩绘，鲜橙紫蓝色彩，万寿菊装饰，节日盛装角色，全身立绘' },
  { id: 's71', title: '阿拉伯天方夜谭风', description: '伊斯兰几何纹样、金色装饰，适合阿拉伯神话/奇幻题材', styleDirective: '阿拉伯天方夜谭插画风格，伊斯兰几何纹样，金色装饰边框，阿拉伯宫殿背景，绚丽绸缎服装，神秘女性角色，全身立绘' },
  { id: 's72', title: '北欧维京神话风', description: '卢恩文字、女武神铠甲，适合北欧神话/史诗题材', styleDirective: '北欧维京神话风格，北欧卢恩文字装饰，皮草铠甲，霜雪与极光背景，女武神Valkyrie气质，武装女性角色，全身立绘' },
  { id: 's73', title: '俄罗斯民俗彩绘风', description: '花卉漩涡图案、木雕彩绘感，适合俄罗斯民俗/童话题材', styleDirective: '俄罗斯民间彩绘艺术风格，花卉漩涡图案，鲜艳红蓝绿色调，木雕彩绘质感，民俗盛装角色，全身立绘' },
  { id: 's74', title: '美国50年代复古广告风', description: '波普复古色调、50s美式风，适合复古/美式文化题材', styleDirective: '美国1950年代复古广告风格，复古海报配色，粉红天蓝鲜艳色调，50s美式波普风，复古家庭主妇或飞行员角色，半身像' },
  { id: 's75', title: '拉丁魔幻现实风', description: '热带丛林幻境叠加、民俗纹样，适合魔幻现实主义/拉美题材', styleDirective: '拉丁美洲魔幻现实主义插画，热带丛林与幻境叠加，拉美民俗纹样，色彩斑斓超现实场景，神秘女性角色，半身像' },

  // === 游戏/数字艺术 (8) ===
  { id: 's76', title: '魂系暗黑幻想风', description: '破损铠甲、腐蚀特效，适合类魂游戏/黑暗奇幻题材', styleDirective: '魂系暗黑高难度幻想风格，破损沉重铠甲，腐蚀与火焰特效，废墟教堂背景，不死战士气质，黑暗骑士角色，全身立绘' },
  { id: 's77', title: 'MOBA英雄概念艺术', description: '技能光效爆发、战甲精细设计，适合MOBA游戏/英雄题材', styleDirective: 'MOBA英雄概念艺术风格，技能特效光芒爆发，精细战甲设计，对位战斗姿势，游戏宣传海报质感，英雄角色，全身立绘' },
  { id: 's78', title: '二次元开放世界游戏风', description: '元素法阵特效、明亮梦幻色，适合原神系/开放世界游戏题材', styleDirective: '二次元开放世界游戏风格，元素法阵特效，明亮梦幻配色，奇幻风旅行者服装，游戏任务NPC质感，角色全身立绘' },
  { id: 's79', title: '机甲娘赛博格风', description: '金属皮肤共存、蓝色能量光，适合机甲娘/赛博格题材', styleDirective: '机甲娘赛博格机械风格，金属外壳与人体皮肤共存，机械手臂与发光眼睛，工业感赛博机器人娘，蓝色能量发光，全身立绘' },
  { id: 's80', title: '虚幻引擎写实游戏风', description: '影视级3D渲染、高精度材质，适合写实AAA游戏/电影改编题材', styleDirective: '虚幻引擎写实游戏角色风格，影视级3D渲染质感，高精度面部细节，写实材质服装，现代战术装备，角色半身像' },
  { id: 's81', title: '奇幻TCG卡牌艺术风', description: '华丽魔法框边、史诗奇幻插图，适合卡牌游戏/桌游题材', styleDirective: '奇幻TCG卡牌艺术风格，万智牌级奇幻插图，华丽魔法边框，中世纪幻想英雄，精细奇幻插画质感，全身竖版立绘' },
  { id: 's82', title: '像素Roguelike游戏风', description: '精细像素颗粒、地牢探险感，适合Roguelike/地牢游戏题材', styleDirective: '像素Roguelike游戏风格，32x32精细像素艺术，地牢探险者装备，暗色地下城背景，复古像素质感，全身像素立绘' },
  { id: 's83', title: '策略战棋单位设计风', description: '俯视角立绘、徽章盔甲设计，适合策略/战棋游戏题材', styleDirective: '策略战棋RTS单位设计风格，俯视角小兵立绘，国家阵营徽章，精细盔甲装备，文明帝国风格，全身立绘图标风格' },

  // === 经典艺术运动 (10) ===
  { id: 's84', title: '法国印象派光影风', description: '莫奈式破碎笔触、户外自然光，适合唯美抒情/艺术题材', styleDirective: '法国印象派光影风格插画，莫奈式破碎笔触，光线在物体表面跳动，柔软模糊轮廓，户外自然光，梦幻柔和色调，角色半身像' },
  { id: 's85', title: '德国表现主义情绪风', description: '蒙克式扭曲、强烈情感张力，适合心理/压抑题材', styleDirective: '德国表现主义情绪插画，蒙克式扭曲变形，强烈情感张力，粗犷笔触，黄绿紫不安色调，痛苦或惊恐的角色，半身像' },
  { id: 's86', title: '新艺术运动曲线风', description: '藤蔓曲线装饰、缪斯女神气质，适合优雅/女性美题材', styleDirective: '新艺术运动Art Nouveau插画风格，藤蔓曲线装饰边框，缪斯女神气质，长发与自然元素融合，金黄柔绿色调，优雅女性角色，全身立绘' },
  { id: 's87', title: '立体主义多视角风', description: '毕加索式碎片化、几何解构，适合前卫艺术/实验题材', styleDirective: '立体主义多视角风格插画，毕加索式碎片化面孔，多角度叠加透视，几何解构人体，蓝褐中性色调，前卫艺术肖像，半身像' },
  { id: 's88', title: '浮世绘木版画风', description: '葛饰北斋线条、蓝白印染感，适合日本江户/历史题材', styleDirective: '日本江户浮世绘木版画风格，葛饰北斋式流畅线条，波浪纹与雷文装饰，蓝白印染质感，武士或花魁造型，全身立绘' },
  { id: 's89', title: '维多利亚讽刺漫画风', description: '夸张五官、钢笔素描感，适合历史讽刺/英伦题材', styleDirective: '维多利亚时代英国讽刺漫画风格，夸张五官比例，钢笔素描质感，黑白双色印刷感，绅士议员造型，半身像' },
  { id: 's90', title: '包豪斯几何构成风', description: '三原色几何分割、工业美学，适合现代设计/理性题材', styleDirective: '包豪斯几何构成风格，三原色红黄蓝分割，几何形状构成，工业设计美学，无机形态人物，现代海报风格，全身简化立绘' },
  { id: 's91', title: 'Art Deco装饰艺术黄金风', description: '几何奢华装饰、1920s爵士时代，适合摩登/黄金年代题材', styleDirective: '装饰艺术Art Deco黄金年代风格，几何奢华装饰，金黑配色，多边形网格背景，1920s爵士时代，摩登女性角色，全身立绘' },
  { id: 's92', title: '城市街头涂鸦艺术风', description: '喷漆笔触、嘻哈街头文化，适合嘻哈/街头文化题材', styleDirective: '城市街头涂鸦嘻哈艺术风格，喷漆笔触，霓虹涂鸦字体，砖墙背景，街头文化服装，嘻哈说唱角色，全身立绘' },
  { id: 's93', title: '北欧斯堪极简设计风', description: '自然色调、细线精准轮廓，适合北欧/简约生活题材', styleDirective: '北欧斯堪的纳维亚极简设计风格，自然色调米白灰绿，细线条精确轮廓，北欧家居美学，简洁现代角色，全身极简立绘' },

  // === 特色/独特风格 (7) ===
  { id: 's94', title: '全息彩虹光感科技风', description: '彩虹全息反光、光谱分散，适合未来科技/赛博题材', styleDirective: '全息彩虹光感科技插画，彩虹反光全息纸质感，光谱分散效果，未来主义科技感，AR/VR概念角色，透明光泽感半身像' },
  { id: 's95', title: '织锦刺绣华贵纹样风', description: '云纹锦缎、金线刺绣质感，适合宫廷华贵/传统工艺题材', styleDirective: '中国传统织锦刺绣纹样风格，云纹锦缎花纹，金线刺绣质感，宫廷华服色彩，大红大紫大金色调，华贵宫装角色，全身立绘' },
  { id: 's96', title: '深渊暗黑深海生物风', description: '蓝黑深渊色调、生物荧光，适合深海恐怖/暗黑科幻题材', styleDirective: '深海暗黑深渊生物风格，蓝黑深渊色调，生物荧光发光纹路，海洋触手与礁岩，深海探险家造型，暗黑奇异角色，全身立绘' },
  { id: 's97', title: '森林精灵自然系风', description: '翠绿苔藓、叶脉花朵装饰，适合精灵/自然系奇幻题材', styleDirective: '森林精灵自然系风格，翠绿苔藓自然色调，尖耳精灵特征，叶脉与花朵装饰服装，林间光斑背景，精灵弓箭手角色，全身立绘' },
  { id: 's98', title: '冷战间谍特工黑色风', description: '风衣阔帽、城市阴影灯光，适合谍战/冷战题材', styleDirective: '冷战间谍特工黑色电影风格，50-70年代谍战美学，黑白棕色调，风衣阔帽，城市阴影与灯光，神秘特工角色，半身像' },
  { id: 's99', title: '武学秘籍古籍拓印风', description: '宣纸拓印感、功夫图解，适合武侠武学/功夫秘籍题材', styleDirective: '中国武学秘籍古籍拓印风格，宣纸质感，水墨拓印效果，武功招式分解图解，功夫人物动作，草书题字装饰，线描全身动作立绘' },
  { id: 's100', title: '末世霓虹废墟孤独风', description: '废墟混凝土+霓虹孤独感，适合末日废土/孤独生存题材', styleDirective: '末世霓虹废墟孤独风格，破败混凝土废墟，残留霓虹灯光，孤独旅人气质，末日荒野装束，冷暖色强烈对比，全身立绘' },
]

// ─── CLI 参数解析 ─────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    api:          { type: 'string',  default: 'http://localhost:8788' },
    token:        { type: 'string',  default: '' },
    'dry-run':    { type: 'boolean', default: false },
    concurrency:  { type: 'string',  default: '3' },
    'out-json':   { type: 'string',  default: '' },
    'out-sql':    { type: 'string',  default: '' },
    start:        { type: 'string',  default: '1' },
    end:          { type: 'string',  default: '9999' },
    'sql-update': { type: 'boolean', default: false },
  },
  strict: false,
})

const API_BASE    = (args.api || 'http://localhost:8788').replace(/\/$/, '')
const TOKEN       = args.token || process.env.TAPCANVAS_TOKEN || ''
const DRY_RUN     = args['dry-run'] ?? false
const CONCURRENCY = Math.max(1, Math.min(10, Number(args.concurrency) || 3))
const START_NUM   = parseInt(args.start || '1', 10)
const END_NUM     = parseInt(args.end || '9999', 10)
const SQL_UPDATE  = args['sql-update'] ?? false
const dateStr     = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const OUT_JSON    = args['out-json'] || `results/style-cards-${dateStr}.json`
const OUT_SQL     = args['out-sql']  || `sql/patch/${new Date().toISOString().slice(0, 10)}-style-reference-cards.sql`

const ACTIVE_CARDS = STYLE_CARDS.filter(s => {
  const n = parseInt(s.id.slice(1), 10)
  return n >= START_NUM && n <= END_NUM
})

if (!TOKEN && !DRY_RUN) {
  console.error('缺少 --token 参数或 TAPCANVAS_TOKEN 环境变量')
  process.exit(1)
}

// ─── 核心请求 ─────────────────────────────────────────────────────────────────
/**
 * 对一种画风发起生图请求，返回生成的图片 URL（取第一张）。
 * gpt-image-2 是同步接口，response 里直接有 assets。
 */
async function generateCard(style) {
  const prompt = [
    '一个年轻角色，角色卡格式，干净留白背景，高细节精绘，半身正面像',
    `风格设计：${style.styleDirective}`,
  ].join('\n')

  const body = {
    request: {
      kind: 'text_to_image',
      prompt,
      extras: {
        nodeKind: 'image',
        modelKey: 'gpt-image-2',
        resolution: '1k',
        quality: 'high',
        size: '1:1',
      },
    },
  }

  if (DRY_RUN) {
    console.log(`[DRY-RUN] ${style.id} ${style.title}`)
    console.log(JSON.stringify(body, null, 2))
    return { ...style, imageUrl: null, prompt, status: 'dry-run' }
  }

  try {
    const res = await fetch(`${API_BASE}/public/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[ERROR] ${style.id} HTTP ${res.status}: ${text.slice(0, 200)}`)
      return { ...style, imageUrl: null, prompt, status: 'http_error', error: res.status }
    }

    const data = await res.json()
    // response may be wrapped: { result: { assets: [...] } } or flat: { assets: [...] }
    const rawAssets = data?.result?.assets ?? data?.assets
    const assets = Array.isArray(rawAssets) ? rawAssets : []
    const imageUrl = assets.find(a => typeof a?.url === 'string' && a.url.trim())?.url?.trim() ?? null

    if (!imageUrl) {
      console.warn(`[WARN] ${style.id} 未返回图片，响应: ${JSON.stringify(data).slice(0, 200)}`)
      return { ...style, imageUrl: null, prompt, status: 'no_image', raw: data }
    }

    console.log(`[OK] ${style.id} ${style.title} → ${imageUrl}`)
    return { ...style, imageUrl, prompt, status: 'ok' }
  } catch (err) {
    console.error(`[ERROR] ${style.id} ${err.message}`)
    return { ...style, imageUrl: null, prompt, status: 'error', error: err.message }
  }
}

// ─── 并发控制 ─────────────────────────────────────────────────────────────────
async function runWithConcurrency(tasks, concurrency) {
  const results = []
  let idx = 0
  async function worker() {
    while (idx < tasks.length) {
      const task = tasks[idx++]
      results.push(await task())
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

// ─── SQL 生成 ─────────────────────────────────────────────────────────────────
function escape(str) {
  return str.replace(/'/g, "''")
}

function toNowIso() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '+00')
}

function buildUpdateSql(results) {
  const now = toNowIso()
  const stmts = results
    .filter(r => r.imageUrl)
    .map(r => {
      const meta = escape(JSON.stringify({ referenceImageUrl: r.imageUrl, styleId: r.id }))
      return `UPDATE llm_node_presets SET meta = '${meta}', updated_at = '${now}' WHERE (meta::jsonb)->>'styleId' = '${r.id}' AND scope = 'base';`
    })
  if (stmts.length === 0) return '-- 无成功生成的图片\n'
  return `-- update referenceImageUrl for style cards (${new Date().toISOString().slice(0, 10)})\n${stmts.join('\n')}\n`
}

function buildSql(results) {
  const now = toNowIso()
  const rows = results
    .filter(r => r.imageUrl)
    .map(r => {
      const id        = randomUUID()
      const title     = escape(r.title)
      const prompt    = escape(r.prompt)
      const desc      = escape(r.description)
      const meta      = escape(JSON.stringify({ referenceImageUrl: r.imageUrl, styleId: r.id }))
      return `  ('${id}', NULL, 'base', 'image', '${title}', '${prompt}', '${desc}', '${meta}', 1, NULL, '${now}', '${now}')`
    })

  if (rows.length === 0) return '-- 无成功生成的图片，SQL 为空\n'

  return `-- ${new Date().toISOString().slice(0, 10)}-style-reference-cards.sql
-- Purpose: seed art style reference cards into llm_node_presets (scope=base, type=image).
-- Each row stores the generated reference image URL in the meta JSON column.
-- Idempotent: ON CONFLICT DO NOTHING (keyed on id).
-- Run via: node scripts/seed-postgres-patches.mjs (or psql directly)

INSERT INTO llm_node_presets
  (id, owner_id, scope, preset_type, title, prompt, description, meta, enabled, sort_order, created_at, updated_at)
VALUES
${rows.join(',\n')}
ON CONFLICT (id) DO NOTHING;
`
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n开始生成 ${ACTIVE_CARDS.length} 个画风参考卡 (s${START_NUM}–s${END_NUM})`)
  console.log(`   API: ${API_BASE}  并发: ${CONCURRENCY}  dry-run: ${DRY_RUN}  sql-update: ${SQL_UPDATE}`)
  console.log(`   输出 JSON: ${OUT_JSON}`)
  console.log(`   输出 SQL:  ${OUT_SQL}\n`)

  const tasks = ACTIVE_CARDS.map(style => () => generateCard(style))
  const results = await runWithConcurrency(tasks, CONCURRENCY)

  const ok    = results.filter(r => r.status === 'ok').length
  const fail  = results.filter(r => r.status !== 'ok' && r.status !== 'dry-run').length
  console.log(`\n完成: ${ok} 成功 / ${fail} 失败`)

  // 写 JSON
  const jsonDir = path.dirname(OUT_JSON)
  if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true })
  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2), 'utf-8')
  console.log(`JSON 已写入: ${OUT_JSON}`)

  // 写 SQL
  const sql = SQL_UPDATE ? buildUpdateSql(results) : buildSql(results)
  const sqlDir = path.dirname(OUT_SQL)
  if (!fs.existsSync(sqlDir)) fs.mkdirSync(sqlDir, { recursive: true })
  fs.writeFileSync(OUT_SQL, sql, 'utf-8')
  console.log(`SQL 已写入: ${OUT_SQL}`)

  if (fail > 0) {
    console.warn(`\n⚠️  有 ${fail} 个画风生成失败，可检查 ${OUT_JSON} 后补充重试`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

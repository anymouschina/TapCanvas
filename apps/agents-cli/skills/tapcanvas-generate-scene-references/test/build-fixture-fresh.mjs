#!/usr/bin/env node
// 构造一个 generate_scene_references intent 的真实调用 prompt，模拟"画布上已有 5 张参考图"的差量补全场景。
// 输出文件：fixture-incremental.json （直接 curl 给 agents-cli /chat）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chapterText = `第一章七十二变
李老头死了。
消息如同石子投入池塘，些许有些波澜。
李老头在方圆几里地里也是个有名的人物，不仅因为是个老知识分子，更是因为脾气又硬又犟。
好些年前，有开发商看起村里的地盘，要建成一片高档小区。其他村民陆续拿了拆迁款走人，唯独李老头死活不肯挪窝，眼瞧着一栋栋富丽堂皇的楼盘拔地而起，李老头的两层小洋楼却如同钉子一样定在中央。
现如今，老头双腿一蹬撒手人寰，开放商便立即反应过来，一手开来了挖掘机，一手拉来一帮"黑西装"，要趁机来个先斩后奏。
挖掘机开上了房前的小坝，厚重的轮胎压碎了坝子，铲斗就要挨上砖墙。
忽然，一阵锣鼓唢呐喧嚣，斜刺里杀出一队披麻戴孝的人马。
黑西装们正要上前阻拦，几个披麻戴孝的远远就扔过来几串鞭炮，噼里啪啦顿时炸得黑西装们一阵鸡飞狗跳。
趁这兵荒马乱的功夫，几个身强体壮的抬着一大家伙"Duang"的堵在了铲斗跟前，细眼一瞧，却是一个没盖的厚木棺材。
………
双方很快就互相扯皮扯出了个具体数目，开发商害怕日后出什么幺蛾子，干脆让人在银行提了现金过来，这边李家人也不含糊，当场就吵吵闹闹分起钱来。
你一点我一点，到了李长安手面上，就只剩下皱巴巴几张毛爷爷。
分钱的大伯颇有些不好意思，旁边抱着孩子的大伯母赶紧说道："长安，你也莫嫌少，我们这都是按着人头来分的。"
"不用了。"李长安把票子推了回去。"我等下在屋里挑点东西就行了。"
"那要得！"大伯母一把将钱抢了过去，笑嘻嘻地塞进兜里。
………
"一、二、三，起！" 几个正值壮年的叔伯喊着号子抬起了棺材。
一帮人披麻戴孝地杀将过来，又带着从屋里搜刮出来的锅瓦瓢盆、桌子板凳杀将回去。
走在一帮心满意足眉开眼笑人们中的李长安回头望去。在挖掘机的轰鸣声中，那座承载了他许多回忆的小楼倒塌成一堆废墟。
………
是夜，灵堂前宴席方散。年纪大的呼朋唤友要搓麻将，年纪小的聚在一起玩手机看电视。
李长安独自一人缩在一间卧室里，手里捧着一本陈旧的线装书。
李长安翻开第一页。上面密密麻麻写着些小字。"通幽、驱神、担山、禁水、借风、布雾、祈晴、祷雨……"
"这不就是道家的地煞七十二术吗？"
李长安翻了翻后面的书页，却惊讶地发现全都是一片空白。
突然，就在目光离开书页的一刹那，耳边"嗡"的一声响，李长安脑子一下子变得昏昏沉沉。
他只觉得头晕目眩，眼前的一切形状都开始扭曲。
可就当他就要撑不住时，眼前耳边都突然一清，他赶紧扶住桌子，大口呼吸几阵，好不容易缓了过来……咦？桌子？刚才不是还躺在床上吗？哪儿来的桌子？他一下子抬起头，却是目瞪口呆……我的天，这是哪儿？
李长安发现自己身处一个狭小简陋的房子里，房子的墙面粗糙却泛着土黄色，隐约可瞧见墙里的竹蔑。
抬头瞧去，几根原木搭起屋顶，屋顶的瓦片却大多没了踪影，清冷的月光撒下来，照得李长安一脸懵逼。
"难不成？" 他呆呆地嘟嚷了一声，低下头。`;

const sourceNodeId = "chapter-seed-book-test-ch1";
const chapterId = "book-test-ch1";
const projectId = "test-project";
const bookId = "test-book";

// Baseline fresh canvas：仅有章节种子节点，无预填参考图。
// 用于验证 SKILL 在 0→N 场景下能否按字数表上限正确生成全套场景图 + 角色卡。
const existingNodes = [
  {
    id: sourceNodeId,
    kind: "text",
    preset: "chapter-info",
    data: { label: "第一章七十二变", chapterTitle: "第一章七十二变" },
  },
];

const existingEdges = [];

// 模拟 hono-api 的 buildIntentPromptPayload 输出（精简版）
const promptPayload = {
  intent: "generate_scene_references",
  sourceNodeId,
  chapterContext: {
    projectId,
    bookId,
    chapterId,
    sourceNode: {
      id: sourceNodeId,
      kind: "text",
      preset: "chapter-info",
      data: { label: "第一章七十二变", chapterTitle: "第一章七十二变" },
    },
    flowSummary: {
      nodeCount: existingNodes.length,
      edgeCount: existingEdges.length,
      nodes: existingNodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        ...(n.preset ? { preset: n.preset } : {}),
        ...(n.data.label ? { label: n.data.label } : {}),
        ...(n.data.chapterTitle ? { title: n.data.chapterTitle } : {}),
        ...(n.data.productionLayer ? { productionLayer: n.data.productionLayer } : {}),
        ...(n.data.referenceType ? { referenceType: n.data.referenceType } : {}),
      })),
      edges: existingEdges,
    },
  },
  chapterText,
  userHints: "imageModel=gpt-image-2 imageSize=1K",
  globalStyleGuide: {
    referenceImages: [
      "https://file.beqlee.icu/gen/images/test/style-bible-01.png",
    ],
    styleName: "古风半写实厚涂插画",
    visualDirectives: [
      "古风半写实厚涂插画风格",
      "线条轮廓清晰锐利，细节鲜明",
    ],
    consistencyRules: [],
    negativeDirectives: [],
  },
};

const requestBody = {
  prompt: JSON.stringify(promptPayload),
  requiredSkills: ["tapcanvas-generate-scene-references"],
  stream: true,
  compactPrelude: true,
  maxTurns: 24,
};

const outPath = path.join(__dirname, "fixture-fresh.json");
fs.writeFileSync(outPath, JSON.stringify(requestBody, null, 2), "utf8");
console.log(`fixture written: ${outPath}`);
console.log(`promptChars=${requestBody.prompt.length}`);
console.log(`existingScenes=0 existingChars=0`);
console.log(`expected: agent should add 4-6 scenes + 3-5 characters (full coverage of chapter 1)`);

export function buildPublicChatResponsePolicyPrompt(input?: {
	canGenerateImages?: boolean;
}): string {
	// The image-first policy only makes sense when the chat is attached to a
	// canvas flow, because tapcanvas_image_generate_to_canvas writes nodes into
	// that flow. Without a flow there is nothing to generate into, so stay empty
	// (the prompt remains thin for plain/global chats).
	if (!input?.canGenerateImages) return "";
	return [
		"## Response Policy",
		"- 视觉优先：当用户想“看”任何东西（户型图/参考图/概念图/示意图/布局/风格/效果/对比/示例），或一张图比一段文字更能说清楚时，直接调用 tapcanvas_image_generate_to_canvas 生成图片到画布，而不是用文字描述代替。图片交付的优先级高于文字解说。",
		"- 用户点名要图（“给我图”“找几张”“看效果”“画一下”“示意一下”“有没有更好的图”）时，必须本轮就生图，不要用“我可以帮你找”“建议你看看”等文字搪塞；需要多个方向时一次生成多张供挑选。",
		"- 当你给出多张图让用户二选一/多选一（如几个户型/风格/效果方向）时，用 request_user_input 并为每个选项填 imageUrl，渲染成可点击的图片卡片；不要只把图片链接堆在正文里让用户自己描述“我选第二张”。",
		"- 文字只承担：生图前必要的关键澄清/取证提问，以及生图后的简短说明与下一步建议。能用图说明的部分不要堆文字。",
		"- 仅在确实无法生图（用户明确只要文字、纯逻辑问答、或当前无可用画布/生图能力）时才纯文本回答。",
	].join("\n");
}

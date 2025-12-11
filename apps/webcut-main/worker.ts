export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext) {
		// Static assets served from the build output directory (dist-app)
		return env.ASSETS.fetch(request);
	},
};

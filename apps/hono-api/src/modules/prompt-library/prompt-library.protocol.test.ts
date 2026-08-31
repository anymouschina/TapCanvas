import { describe, expect, it } from "vitest";
import {
	PromptSyncProtocolSchema,
	assertPromptSyncRobots,
	discoverPromptUrlsFromDocuments,
	parsePersistedPromptSyncProtocol,
	serializePromptSyncProtocol,
} from "./prompt-library.protocol";

const protocol = PromptSyncProtocolSchema.parse({
	protocolVersion: "tapcanvas.prompt-sync/v1",
	batch: { maxItems: 25, strategy: "round_robin" },
	sources: [{
		id: "open-nana",
		displayName: "OpenNana",
		origin: "https://opennana.com",
		robotsUrl: "https://opennana.com/robots.txt",
		discoveryUrls: ["https://opennana.com/sitemap.xml", "https://opennana.com/awesome-prompt-gallery"],
		detailPathPrefix: "/awesome-prompt-gallery/",
		detailParser: { kind: "builtin", adapter: "opennana-jsonld-flight-v1" },
	}],
});

describe("editable prompt sync protocol", () => {
	it("round-trips the protocol through the existing durable crawl field", () => {
		expect(parsePersistedPromptSyncProtocol(serializePromptSyncProtocol(protocol))).toEqual(protocol);
	});

	it("extracts only same-origin detail links inside the declared path boundary", () => {
		expect(discoverPromptUrlsFromDocuments(protocol.sources[0], [{
			url: "https://opennana.com/awesome-prompt-gallery",
			body: [
				'<a href="/awesome-prompt-gallery/one?from=home">One</a>',
				'<loc>https://opennana.com/awesome-prompt-gallery/two</loc>',
				'<a href="https://api.opennana.com/api/prompts/3">Forbidden host</a>',
				'<a href="/pricing">Outside path</a>',
			].join(""),
		}])).toEqual([
			"https://opennana.com/awesome-prompt-gallery/two",
			"https://opennana.com/awesome-prompt-gallery/one",
		]);
	});

	it("stops when robots disallows a declared protocol path", () => {
		expect(() => assertPromptSyncRobots(protocol.sources[0], "User-agent: *\nAllow: /\nDisallow: /awesome-prompt-gallery/"))
			.toThrow("robots.txt 禁止协议路径");
	});

	it("rejects cross-origin discovery configuration", () => {
		expect(() => PromptSyncProtocolSchema.parse({
			...protocol,
			sources: [{ ...protocol.sources[0], discoveryUrls: ["https://example.com/sitemap.xml"] }],
		})).toThrow("share the declared origin");
	});
});

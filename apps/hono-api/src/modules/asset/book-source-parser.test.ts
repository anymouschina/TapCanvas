import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import {
	BookSourceParseError,
	parseBookSource,
	requireBookSourceMetadataV1,
} from "./book-source-parser";

function zipTextEntries(entries: Record<string, string>): Uint8Array {
	return zipSync(
		Object.fromEntries(
			Object.entries(entries).map(([name, content]) => [name, strToU8(content)]),
		),
	);
}

function expectBookSourceParseError(
	operation: () => unknown,
	code: BookSourceParseError["code"],
): void {
	try {
		operation();
		throw new Error(`expected BookSourceParseError with code ${code}`);
	} catch (error) {
		expect(error).toBeInstanceOf(BookSourceParseError);
		expect(error).toMatchObject({ code });
	}
}

describe("book-source-parser", () => {
	it("extracts DOCX paragraphs and preserves structural breaks", () => {
		const bytes = zipTextEntries({
			"word/document.xml": [
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
				"<w:body>",
				"<w:p><w:r><w:t>第一章 门外雨声</w:t></w:r></w:p>",
				"<w:p><w:r><w:t>林舟</w:t><w:tab/><w:t>推开门。</w:t><w:br/><w:t>灯灭了。</w:t></w:r></w:p>",
				"</w:body>",
				"</w:document>",
			].join(""),
		});

		const parsed = parseBookSource({ fileName: "story.docx", bytes });

		expect(parsed.text).toBe("第一章 门外雨声\n\n林舟\t推开门。\n灯灭了。");
		expect(parsed.metadata).toMatchObject({
			schemaVersion: "book-source/v1",
			originalFileName: "story.docx",
			format: "docx",
			sourceEncoding: "package-xml",
			extractedDocumentCount: 1,
		});
		expect(parsed.metadata.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(parsed.metadata.sourceTextSha256).toMatch(/^[a-f0-9]{64}$/u);
	});

	it("uses EPUB OPF spine order and excludes manifest nav documents", () => {
		const bytes = zipTextEntries({
			"META-INF/container.xml": [
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
				'<rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles>',
				"</container>",
			].join(""),
			"OPS/book.opf": [
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<package xmlns="http://www.idpf.org/2007/opf">',
				"<manifest>",
				'<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
				'<item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>',
				'<item id="c2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>',
				"</manifest>",
				'<spine><itemref idref="nav"/><itemref idref="c2"/><itemref idref="c1"/></spine>',
				"</package>",
			].join(""),
			"OPS/nav.xhtml":
				'<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><p>目录不应进入正文</p></nav></body></html>',
			"OPS/chapter-1.xhtml":
				'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>一</title></head><body><h1>第一章 雨</h1><p>第一章正文。</p></body></html>',
			"OPS/chapter-2.xhtml":
				'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章 灯</h1><p>第二章正文。<br/>仍在继续。</p></body></html>',
		});

		const parsed = parseBookSource({ fileName: "story.epub", bytes });

		expect(parsed.text).toContain("第二章 灯\n第二章正文。\n仍在继续。");
		expect(parsed.text.indexOf("第二章 灯")).toBeLessThan(
			parsed.text.indexOf("第一章 雨"),
		);
		expect(parsed.text).not.toContain("目录不应进入正文");
		expect(parsed.text).not.toContain("一\n");
		expect(parsed.metadata).toMatchObject({
			format: "epub",
			extractedDocumentCount: 2,
		});
	});

	it("rejects unsupported extensions instead of guessing from bytes", () => {
		expectBookSourceParseError(
			() =>
			parseBookSource({
				fileName: "story.pdf",
				bytes: strToU8("第一章"),
			}),
			"book_source_unsupported_type",
		);
	});

	it("fails explicitly for non-UTF-8 plain text", () => {
		expectBookSourceParseError(
			() =>
			parseBookSource({
				fileName: "legacy.txt",
				bytes: new Uint8Array([0xff, 0xfe, 0xfd]),
			}),
			"book_source_invalid_utf8",
		);
	});

	it("fails explicitly when DOCX has no document.xml", () => {
		const bytes = zipTextEntries({ "[Content_Types].xml": "<Types/>" });
		expectBookSourceParseError(
			() => parseBookSource({ fileName: "empty.docx", bytes }),
			"book_source_docx_document_missing",
		);
	});

	it("validates persisted source metadata before rebuilding derived evidence", () => {
		const parsed = parseBookSource({
			fileName: "story.md",
			bytes: strToU8("第一章\n\n雨停了。"),
		});
		expect(
			requireBookSourceMetadataV1({
				...parsed.metadata,
				storedPath: "project-data/books/book-1/source/original.txt",
			}),
		).toMatchObject({
			schemaVersion: "book-source/v1",
			format: "plain_text",
			sourceTextSha256: parsed.metadata.sourceTextSha256,
		});
		expectBookSourceParseError(
			() =>
				requireBookSourceMetadataV1({
					...parsed.metadata,
					sourceTextSha256: "tampered",
				}),
			"book_source_metadata_invalid",
		);
	});
});

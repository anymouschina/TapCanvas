import path from "node:path";

import { DOMParser } from "@xmldom/xmldom";
import { unzipSync, type UnzipFileInfo } from "fflate";

import { sha256Hex } from "./book-content-hash";

const MAX_ARCHIVE_ENTRIES = 4_096;
const MAX_SELECTED_ARCHIVE_BYTES = 160 * 1024 * 1024;
const MAX_SINGLE_ARCHIVE_ENTRY_BYTES = 96 * 1024 * 1024;

const EPUB_DOCUMENT_MEDIA_TYPES = new Set([
	"application/xhtml+xml",
	"application/xml",
	"text/html",
	"text/xml",
]);

const EPUB_BLOCK_ELEMENTS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"dd",
	"div",
	"dl",
	"dt",
	"figcaption",
	"figure",
	"footer",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"li",
	"main",
	"ol",
	"p",
	"pre",
	"section",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"ul",
]);

const EPUB_IGNORED_ELEMENTS = new Set([
	"head",
	"nav",
	"noscript",
	"script",
	"style",
	"svg",
]);

export type BookSourceFormat = "plain_text" | "docx" | "epub";

export type BookSourceMetadataV1 = {
	schemaVersion: "book-source/v1";
	originalFileName: string;
	format: BookSourceFormat;
	mediaType: string;
	sourceByteLength: number;
	sourceSha256: string;
	sourceTextSha256: string;
	sourceEncoding: "utf-8" | "package-xml";
	extractedDocumentCount: number;
	storedPath?: string;
};

export type ParsedBookSource = {
	text: string;
	metadata: BookSourceMetadataV1;
};

export type BookSourceParseErrorCode =
	| "book_source_archive_invalid"
	| "book_source_archive_limit_exceeded"
	| "book_source_docx_document_empty"
	| "book_source_docx_document_missing"
	| "book_source_empty"
	| "book_source_epub_container_missing"
	| "book_source_epub_document_empty"
	| "book_source_epub_package_invalid"
	| "book_source_epub_package_missing"
	| "book_source_epub_spine_empty"
	| "book_source_epub_spine_item_missing"
	| "book_source_invalid_utf8"
	| "book_source_metadata_invalid"
	| "book_source_size_mismatch"
	| "book_source_unsupported_type"
	| "book_source_upload_read_failed"
	| "book_source_xml_invalid";

export class BookSourceParseError extends Error {
	readonly code: BookSourceParseErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(
		code: BookSourceParseErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "BookSourceParseError";
		this.code = code;
		this.details = details;
	}
}

type EpubManifestItem = {
	id: string;
	href: string;
	mediaType: string;
	properties: ReadonlySet<string>;
};

function normalizedExtension(fileName: string): string {
	return path.extname(String(fileName || "").trim()).toLowerCase();
}

export function isSupportedBookSourceFileName(fileName: string): boolean {
	const extension = normalizedExtension(fileName);
	return (
		extension === ".txt" ||
		extension === ".text" ||
		extension === ".md" ||
		extension === ".markdown" ||
		extension === ".docx" ||
		extension === ".epub"
	);
}

function normalizeArchivePath(value: string): string {
	const slashNormalized = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
	return path.posix.normalize(slashNormalized).replace(/^\.\//, "");
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new BookSourceParseError(
			"book_source_invalid_utf8",
			`${label} 不是有效 UTF-8 文本；请先转换为 UTF-8 后重试`,
			{ label },
		);
	}
}

function normalizeExtractedText(value: string): string {
	const withoutBom = String(value || "").replace(/^\uFEFF/, "");
	if (withoutBom.includes("\u0000")) {
		throw new BookSourceParseError(
			"book_source_invalid_utf8",
			"书籍正文包含 NUL 字符，无法作为文本导入",
		);
	}
	return withoutBom
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t\f\v]+\n/g, "\n")
		.replace(/\n[ \t\f\v]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function ensureNonEmptyText(value: string, code: BookSourceParseErrorCode, message: string): string {
	const normalized = normalizeExtractedText(value);
	if (!normalized) {
		throw new BookSourceParseError(code, message);
	}
	return normalized;
}

function unzipSelected(
	bytes: Uint8Array,
	shouldExtract: (normalizedName: string) => boolean,
): Map<string, Uint8Array> {
	let entryCount = 0;
	let selectedBytes = 0;
	let archive: Record<string, Uint8Array>;
	try {
		archive = unzipSync(bytes, {
			filter: (entry: UnzipFileInfo): boolean => {
				entryCount += 1;
				if (entryCount > MAX_ARCHIVE_ENTRIES) {
					throw new BookSourceParseError(
						"book_source_archive_limit_exceeded",
						`书籍压缩包条目超过 ${MAX_ARCHIVE_ENTRIES} 个，已拒绝解析`,
					);
				}
				const normalizedName = normalizeArchivePath(entry.name);
				if (!shouldExtract(normalizedName)) return false;
				if (entry.originalSize > MAX_SINGLE_ARCHIVE_ENTRY_BYTES) {
					throw new BookSourceParseError(
						"book_source_archive_limit_exceeded",
						"书籍压缩包内单个文档过大，已拒绝解析",
						{ entry: normalizedName, originalSize: entry.originalSize },
					);
				}
				selectedBytes += entry.originalSize;
				if (selectedBytes > MAX_SELECTED_ARCHIVE_BYTES) {
					throw new BookSourceParseError(
						"book_source_archive_limit_exceeded",
						"书籍压缩包解压后的正文超过安全上限，已拒绝解析",
						{ selectedBytes },
					);
				}
				return true;
			},
		});
	} catch (error) {
		if (error instanceof BookSourceParseError) throw error;
		throw new BookSourceParseError(
			"book_source_archive_invalid",
			"书籍文件不是有效的 ZIP 容器",
			{ reason: error instanceof Error ? error.message : String(error) },
		);
	}

	const byNormalizedPath = new Map<string, Uint8Array>();
	for (const [entryName, entryBytes] of Object.entries(archive)) {
		const normalizedName = normalizeArchivePath(entryName).toLowerCase();
		if (byNormalizedPath.has(normalizedName)) {
			throw new BookSourceParseError(
				"book_source_archive_invalid",
				"书籍压缩包包含大小写冲突的重复路径",
				{ entry: normalizedName },
			);
		}
		byNormalizedPath.set(normalizedName, entryBytes);
	}
	return byNormalizedPath;
}

function parseDocument(
	xml: string,
	label: string,
	mimeType: "application/xml" | "text/html" = "application/xml",
): Document {
	const parseErrors: string[] = [];
	const collectError = (message: unknown): void => {
		parseErrors.push(String(message));
	};
	const document = new DOMParser({
		errorHandler: {
			warning: () => undefined,
			error: collectError,
			fatalError: collectError,
		},
	}).parseFromString(xml, mimeType);
	if (!document.documentElement || parseErrors.length > 0) {
		throw new BookSourceParseError(
			"book_source_xml_invalid",
			`${label} XML 结构无效`,
			{ label, errors: parseErrors.slice(0, 8) },
		);
	}
	return document;
}

function localNameOf(node: Node): string {
	if (node.nodeType !== node.ELEMENT_NODE) return "";
	const element = node as Element;
	return String(element.localName || element.tagName || "")
		.split(":")
		.pop()
		?.toLowerCase() || "";
}

function elementsByLocalName(root: Document | Element, localName: string): Element[] {
	const normalizedLocalName = localName.toLowerCase();
	const candidates = root.getElementsByTagName("*");
	const elements: Element[] = [];
	for (let index = 0; index < candidates.length; index += 1) {
		const element = candidates.item(index);
		if (element && localNameOf(element) === normalizedLocalName) {
			elements.push(element);
		}
	}
	return elements;
}

function collectDocxParagraphText(paragraph: Element): string {
	const parts: string[] = [];
	const visit = (node: Node): void => {
		if (node.nodeType === node.TEXT_NODE) {
			parts.push(node.nodeValue || "");
			return;
		}
		const localName = localNameOf(node);
		if (localName === "tab") {
			parts.push("\t");
			return;
		}
		if (localName === "br" || localName === "cr") {
			parts.push("\n");
			return;
		}
		for (let child = node.firstChild; child; child = child.nextSibling) {
			visit(child);
		}
	};
	visit(paragraph);
	return parts.join("").trim();
}

function extractDocxText(bytes: Uint8Array): { text: string; documentCount: number } {
	const archive = unzipSelected(
		bytes,
		(normalizedName) => normalizedName.toLowerCase() === "word/document.xml",
	);
	const documentBytes = archive.get("word/document.xml");
	if (!documentBytes) {
		throw new BookSourceParseError(
			"book_source_docx_document_missing",
			"DOCX 缺少 word/document.xml，无法提取正文",
		);
	}
	const documentXml = decodeUtf8(documentBytes, "word/document.xml");
	const document = parseDocument(documentXml, "word/document.xml");
	const paragraphs = elementsByLocalName(document, "p")
		.map(collectDocxParagraphText)
		.filter((paragraph) => paragraph.length > 0);
	const text = ensureNonEmptyText(
		paragraphs.join("\n\n"),
		"book_source_docx_document_empty",
		"DOCX 正文为空",
	);
	return { text, documentCount: 1 };
}

function resolveEpubHref(opfPath: string, href: string): string {
	const withoutFragment = String(href || "").split("#", 1)[0]?.split("?", 1)[0] || "";
	let decodedHref = "";
	try {
		decodedHref = decodeURIComponent(withoutFragment);
	} catch {
		throw new BookSourceParseError(
			"book_source_epub_package_invalid",
			"EPUB manifest 包含无法解码的 href",
			{ href },
		);
	}
	const normalized = normalizeArchivePath(path.posix.join(path.posix.dirname(opfPath), decodedHref));
	if (!normalized || normalized === "." || normalized.startsWith("../")) {
		throw new BookSourceParseError(
			"book_source_epub_package_invalid",
			"EPUB manifest href 越出压缩包根目录",
			{ href },
		);
	}
	return normalized.toLowerCase();
}

function extractEpubElementText(document: Document): string {
	const parts: string[] = [];
	const appendBoundary = (): void => {
		if (parts[parts.length - 1] !== "\n") parts.push("\n");
	};
	const visit = (node: Node): void => {
		if (node.nodeType === node.TEXT_NODE) {
			parts.push(node.nodeValue || "");
			return;
		}
		const localName = localNameOf(node);
		if (EPUB_IGNORED_ELEMENTS.has(localName)) return;
		if (localName === "br") {
			appendBoundary();
			return;
		}
		const isBlock = EPUB_BLOCK_ELEMENTS.has(localName);
		if (isBlock) appendBoundary();
		for (let child = node.firstChild; child; child = child.nextSibling) {
			visit(child);
		}
		if (isBlock) appendBoundary();
	};
	visit(document.documentElement);
	return normalizeExtractedText(
		parts
			.join("")
			.replace(/[ \t\f\v]+/g, " ")
			.replace(/ *\n */g, "\n"),
	);
}

function extractEpubText(bytes: Uint8Array): { text: string; documentCount: number } {
	const archive = unzipSelected(bytes, (normalizedName) => {
		const lowerName = normalizedName.toLowerCase();
		return (
			lowerName === "meta-inf/container.xml" ||
			lowerName.endsWith(".opf") ||
			lowerName.endsWith(".xhtml") ||
			lowerName.endsWith(".html") ||
			lowerName.endsWith(".htm") ||
			lowerName.endsWith(".xml")
		);
	});
	const containerBytes = archive.get("meta-inf/container.xml");
	if (!containerBytes) {
		throw new BookSourceParseError(
			"book_source_epub_container_missing",
			"EPUB 缺少 META-INF/container.xml",
		);
	}
	const containerDocument = parseDocument(
		decodeUtf8(containerBytes, "META-INF/container.xml"),
		"META-INF/container.xml",
	);
	const rootfile = elementsByLocalName(containerDocument, "rootfile")[0];
	const opfPath = normalizeArchivePath(rootfile?.getAttribute("full-path") || "").toLowerCase();
	if (!opfPath) {
		throw new BookSourceParseError(
			"book_source_epub_package_missing",
			"EPUB container 未声明 OPF package 路径",
		);
	}
	const opfBytes = archive.get(opfPath);
	if (!opfBytes) {
		throw new BookSourceParseError(
			"book_source_epub_package_missing",
			"EPUB 声明的 OPF package 文件不存在",
			{ opfPath },
		);
	}
	const packageDocument = parseDocument(decodeUtf8(opfBytes, opfPath), opfPath);
	const manifest = new Map<string, EpubManifestItem>();
	for (const element of elementsByLocalName(packageDocument, "item")) {
		const id = String(element.getAttribute("id") || "").trim();
		const href = String(element.getAttribute("href") || "").trim();
		if (!id || !href) continue;
		const properties = new Set(
			String(element.getAttribute("properties") || "")
				.split(/\s+/)
				.map((item) => item.trim().toLowerCase())
				.filter(Boolean),
		);
		manifest.set(id, {
			id,
			href,
			mediaType: String(element.getAttribute("media-type") || "").trim().toLowerCase(),
			properties,
		});
	}
	if (manifest.size === 0) {
		throw new BookSourceParseError(
			"book_source_epub_package_invalid",
			"EPUB OPF manifest 为空",
		);
	}

	const orderedDocumentPaths: string[] = [];
	const seenPaths = new Set<string>();
	for (const itemRef of elementsByLocalName(packageDocument, "itemref")) {
		if (String(itemRef.getAttribute("linear") || "").trim().toLowerCase() === "no") continue;
		const idref = String(itemRef.getAttribute("idref") || "").trim();
		const item = manifest.get(idref);
		if (!item || item.properties.has("nav")) continue;
		if (item.mediaType && !EPUB_DOCUMENT_MEDIA_TYPES.has(item.mediaType)) continue;
		const documentPath = resolveEpubHref(opfPath, item.href);
		if (!archive.has(documentPath)) {
			throw new BookSourceParseError(
				"book_source_epub_spine_item_missing",
				"EPUB spine 引用的正文文件不存在",
				{ idref, documentPath },
			);
		}
		if (!seenPaths.has(documentPath)) {
			seenPaths.add(documentPath);
			orderedDocumentPaths.push(documentPath);
		}
	}
	if (orderedDocumentPaths.length === 0) {
		throw new BookSourceParseError(
			"book_source_epub_spine_empty",
			"EPUB spine 没有可读取的正文文档",
		);
	}

	const extractedDocuments: string[] = [];
	for (const documentPath of orderedDocumentPaths) {
		const documentBytes = archive.get(documentPath);
		if (!documentBytes) {
			throw new BookSourceParseError(
				"book_source_epub_spine_item_missing",
				"EPUB 正文文件在解析阶段丢失",
				{ documentPath },
			);
		}
		const document = parseDocument(
			decodeUtf8(documentBytes, documentPath),
			documentPath,
			"text/html",
		);
		const documentText = extractEpubElementText(document);
		if (documentText) extractedDocuments.push(documentText);
	}
	const text = ensureNonEmptyText(
		extractedDocuments.join("\n\n"),
		"book_source_epub_document_empty",
		"EPUB spine 文档均未提取到正文",
	);
	return { text, documentCount: extractedDocuments.length };
}

function mediaTypeForFormat(format: BookSourceFormat): string {
	if (format === "docx") {
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
	}
	if (format === "epub") return "application/epub+zip";
	return "text/plain";
}

export function parseBookSource(input: {
	fileName: string;
	bytes: Uint8Array;
}): ParsedBookSource {
	const originalFileName = path.basename(String(input.fileName || "").trim());
	const extension = normalizedExtension(originalFileName);
	if (!originalFileName || !extension) {
		throw new BookSourceParseError(
			"book_source_unsupported_type",
			"书籍源文件必须带有受支持的扩展名",
		);
	}
	if (input.bytes.byteLength === 0) {
		throw new BookSourceParseError("book_source_empty", "书籍源文件为空");
	}

	let format: BookSourceFormat;
	let text: string;
	let extractedDocumentCount: number;
	if (extension === ".txt" || extension === ".text" || extension === ".md" || extension === ".markdown") {
		format = "plain_text";
		text = ensureNonEmptyText(
			decodeUtf8(input.bytes, originalFileName),
			"book_source_empty",
			"书籍源文件没有可导入的正文",
		);
		extractedDocumentCount = 1;
	} else if (extension === ".docx") {
		format = "docx";
		const extracted = extractDocxText(input.bytes);
		text = extracted.text;
		extractedDocumentCount = extracted.documentCount;
	} else if (extension === ".epub") {
		format = "epub";
		const extracted = extractEpubText(input.bytes);
		text = extracted.text;
		extractedDocumentCount = extracted.documentCount;
	} else {
		throw new BookSourceParseError(
			"book_source_unsupported_type",
			`不支持的书籍源格式：${extension}`,
			{ extension },
		);
	}

	return {
		text,
		metadata: {
			schemaVersion: "book-source/v1",
			originalFileName,
			format,
			mediaType: mediaTypeForFormat(format),
			sourceByteLength: input.bytes.byteLength,
			sourceSha256: sha256Hex(input.bytes),
			sourceTextSha256: sha256Hex(text),
			sourceEncoding: format === "plain_text" ? "utf-8" : "package-xml",
			extractedDocumentCount,
		},
	};
}

export function storedBookSourceFileName(format: BookSourceFormat): string {
	if (format === "docx") return "original.docx";
	if (format === "epub") return "original.epub";
	return "original.txt";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function requireBookSourceMetadataV1(value: unknown): BookSourceMetadataV1 {
	if (!isRecord(value)) {
		throw new BookSourceParseError(
			"book_source_metadata_invalid",
			"书籍来源元数据不是有效对象",
		);
	}
	const format = value.format;
	if (format !== "plain_text" && format !== "docx" && format !== "epub") {
		throw new BookSourceParseError(
			"book_source_metadata_invalid",
			"书籍来源元数据包含无效格式",
			{ format },
		);
	}
	const expectedEncoding = format === "plain_text" ? "utf-8" : "package-xml";
	const originalFileName =
		typeof value.originalFileName === "string" ? value.originalFileName.trim() : "";
	const storedPath = typeof value.storedPath === "string" ? value.storedPath.trim() : "";
	const sourceByteLength = Number(value.sourceByteLength);
	const extractedDocumentCount = Number(value.extractedDocumentCount);
	const sourceSha256 = isSha256(value.sourceSha256) ? value.sourceSha256 : "";
	const sourceTextSha256 = isSha256(value.sourceTextSha256)
		? value.sourceTextSha256
		: "";
	const invalidFields: string[] = [];
	if (value.schemaVersion !== "book-source/v1") invalidFields.push("schemaVersion");
	if (!originalFileName) invalidFields.push("originalFileName");
	if (value.mediaType !== mediaTypeForFormat(format)) invalidFields.push("mediaType");
	if (!Number.isInteger(sourceByteLength) || sourceByteLength <= 0) {
		invalidFields.push("sourceByteLength");
	}
	if (!sourceSha256) invalidFields.push("sourceSha256");
	if (!sourceTextSha256) invalidFields.push("sourceTextSha256");
	if (value.sourceEncoding !== expectedEncoding) invalidFields.push("sourceEncoding");
	if (!Number.isInteger(extractedDocumentCount) || extractedDocumentCount <= 0) {
		invalidFields.push("extractedDocumentCount");
	}
	if (value.storedPath !== undefined && !storedPath) invalidFields.push("storedPath");
	if (invalidFields.length > 0) {
		throw new BookSourceParseError(
			"book_source_metadata_invalid",
			"书籍来源元数据不完整或已损坏",
			{ invalidFields },
		);
	}
	return {
		schemaVersion: "book-source/v1",
		originalFileName,
		format,
		mediaType: mediaTypeForFormat(format),
		sourceByteLength,
		sourceSha256,
		sourceTextSha256,
		sourceEncoding: expectedEncoding,
		extractedDocumentCount,
		storedPath: storedPath || undefined,
	};
}

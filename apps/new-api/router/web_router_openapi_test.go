package router

import (
	"errors"
	"io/fs"
	"testing"
	"testing/fstest"
)

func TestReadOpenAPIDocumentUsesAuthoritativeSource(t *testing.T) {
	documentFS := fstest.MapFS{
		"docs/openapi/relay.json":     &fstest.MapFile{Data: []byte(`{"version":"current"}`)},
		"web/dist/openapi/relay.json": &fstest.MapFile{Data: []byte(`{"version":"stale"}`)},
	}

	document, err := readOpenAPIDocument(documentFS, "relay.json")

	if err != nil {
		t.Fatalf("read relay document: %v", err)
	}
	if string(document) != `{"version":"current"}` {
		t.Fatalf("unexpected document: %s", document)
	}
}

func TestReadOpenAPIDocumentRejectsUnknownDocument(t *testing.T) {
	documentFS := fstest.MapFS{}

	_, err := readOpenAPIDocument(documentFS, "../secrets.json")

	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("expected fs.ErrNotExist, got %v", err)
	}
}

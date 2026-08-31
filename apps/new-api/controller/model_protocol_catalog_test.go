package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
)

func TestBuildModelProtocolCatalogPublishesProtocolModelSuggestions(t *testing.T) {
	catalog, err := buildModelProtocolCatalog()
	if err != nil {
		t.Fatalf("buildModelProtocolCatalog() error = %v", err)
	}
	if len(catalog) == 0 {
		t.Fatal("protocol catalog is empty")
	}

	seen := make(map[string]struct{}, len(catalog))
	var nativeMidjourney *modelProtocolCatalogItem
	for index := range catalog {
		item := &catalog[index]
		if _, exists := seen[item.ID]; exists {
			t.Fatalf("duplicate protocol id %q", item.ID)
		}
		seen[item.ID] = struct{}{}
		if item.Models == nil {
			t.Fatalf("protocol %q serialized model suggestions as null", item.ID)
		}
		if item.EndpointTypes == nil {
			t.Fatalf("protocol %q serialized endpoint_types as null", item.ID)
		}
		if item.ID == constant.ProtocolNativeMJ {
			nativeMidjourney = item
		}
	}

	if nativeMidjourney == nil {
		t.Fatal("native Midjourney protocol is missing")
	}
	if len(nativeMidjourney.Models) == 0 {
		t.Fatal("native Midjourney protocol has no model suggestions")
	}
}

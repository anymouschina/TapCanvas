package model

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

func TestClonePricingCatalogSnapshotDoesNotExposeMutableCacheValues(t *testing.T) {
	modelSupportEndpointsLock.Lock()
	previousPricing := pricingMap
	previousVendors := vendorsList
	previousEndpoints := supportedEndpointMap
	defer func() {
		pricingMap = previousPricing
		vendorsList = previousVendors
		supportedEndpointMap = previousEndpoints
		modelSupportEndpointsLock.Unlock()
	}()

	cacheRatio := 0.25
	pricingMap = []Pricing{
		{
			ModelName:              "snapshot-model",
			CacheRatio:             &cacheRatio,
			EnableGroup:            []string{"default"},
			SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI},
			ParamPricing: &ParamPricing{
				Results: []ParamPricingResult{{SpecKey: "default"}},
			},
		},
	}
	vendorsList = []PricingVendor{{ID: 1, Name: "Snapshot Vendor"}}
	supportedEndpointMap = map[string]common.EndpointInfo{
		"openai": {Path: "/v1/chat/completions", Method: "POST"},
	}

	snapshot := clonePricingCatalogSnapshotLocked()
	*snapshot.Pricing[0].CacheRatio = 0.5
	snapshot.Pricing[0].EnableGroup[0] = "mutated"
	snapshot.Pricing[0].SupportedEndpointTypes[0] = constant.EndpointTypeGemini
	snapshot.Pricing[0].ParamPricing.Results[0].SpecKey = "mutated"
	snapshot.Vendors[0].Name = "Mutated Vendor"
	snapshot.SupportedEndpoints["openai"] = common.EndpointInfo{Path: "/mutated", Method: "GET"}

	if *pricingMap[0].CacheRatio != 0.25 {
		t.Fatalf("cache ratio was mutated through snapshot: %f", *pricingMap[0].CacheRatio)
	}
	if pricingMap[0].EnableGroup[0] != "default" {
		t.Fatalf("enable groups were mutated through snapshot: %#v", pricingMap[0].EnableGroup)
	}
	if pricingMap[0].SupportedEndpointTypes[0] != constant.EndpointTypeOpenAI {
		t.Fatalf("endpoint types were mutated through snapshot: %#v", pricingMap[0].SupportedEndpointTypes)
	}
	if pricingMap[0].ParamPricing.Results[0].SpecKey != "default" {
		t.Fatalf("param pricing was mutated through snapshot: %#v", pricingMap[0].ParamPricing.Results)
	}
	if vendorsList[0].Name != "Snapshot Vendor" {
		t.Fatalf("vendors were mutated through snapshot: %#v", vendorsList)
	}
	if supportedEndpointMap["openai"].Path != "/v1/chat/completions" {
		t.Fatalf("endpoint map was mutated through snapshot: %#v", supportedEndpointMap)
	}
}

func TestPricingCatalogSnapshotConcurrentReadAndPublish(t *testing.T) {
	updatePricingLock.Lock()
	modelSupportEndpointsLock.Lock()
	previousPricing := pricingMap
	previousVendors := vendorsList
	previousEndpoints := supportedEndpointMap
	previousRefreshTime := lastGetPricingTime
	pricingMap = []Pricing{{ModelName: "model-a"}}
	vendorsList = []PricingVendor{{ID: 1, Name: "vendor-a"}}
	supportedEndpointMap = map[string]common.EndpointInfo{
		"openai": {Path: "/a", Method: "POST"},
	}
	lastGetPricingTime = time.Now()
	modelSupportEndpointsLock.Unlock()
	updatePricingLock.Unlock()

	defer func() {
		updatePricingLock.Lock()
		modelSupportEndpointsLock.Lock()
		pricingMap = previousPricing
		vendorsList = previousVendors
		supportedEndpointMap = previousEndpoints
		lastGetPricingTime = previousRefreshTime
		modelSupportEndpointsLock.Unlock()
		updatePricingLock.Unlock()
	}()

	publish := func(suffix string) {
		updatePricingLock.Lock()
		modelSupportEndpointsLock.Lock()
		pricingMap = []Pricing{{ModelName: "model-" + suffix}}
		vendorsList = []PricingVendor{{ID: 1, Name: "vendor-" + suffix}}
		supportedEndpointMap = map[string]common.EndpointInfo{
			"openai": {Path: "/" + suffix, Method: "POST"},
		}
		lastGetPricingTime = time.Now()
		modelSupportEndpointsLock.Unlock()
		updatePricingLock.Unlock()
	}

	errCh := make(chan error, 1)
	recordError := func(err error) {
		select {
		case errCh <- err:
		default:
		}
	}

	var waitGroup sync.WaitGroup
	waitGroup.Add(5)
	go func() {
		defer waitGroup.Done()
		for iteration := 0; iteration < 500; iteration++ {
			if iteration%2 == 0 {
				publish("a")
			} else {
				publish("b")
			}
		}
	}()
	for reader := 0; reader < 4; reader++ {
		go func() {
			defer waitGroup.Done()
			for iteration := 0; iteration < 500; iteration++ {
				snapshot, err := GetPricingCatalogSnapshotWithError()
				if err != nil {
					recordError(err)
					return
				}
				if len(snapshot.Pricing) != 1 || len(snapshot.Vendors) != 1 {
					recordError(fmt.Errorf("incomplete snapshot: %#v", snapshot))
					return
				}
				suffix := snapshot.Pricing[0].ModelName[len("model-"):]
				if snapshot.Vendors[0].Name != "vendor-"+suffix || snapshot.SupportedEndpoints["openai"].Path != "/"+suffix {
					recordError(fmt.Errorf("mixed cache versions in snapshot: %#v", snapshot))
					return
				}
			}
		}()
	}
	waitGroup.Wait()

	select {
	case err := <-errCh:
		t.Fatal(err)
	default:
	}
}

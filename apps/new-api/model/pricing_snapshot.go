package model

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

// PricingCatalogSnapshot keeps every cache value used by the public pricing
// response on the same version. Callers receive deep-enough copies and cannot
// mutate the process-wide cache through returned slices, maps, or pointers.
type PricingCatalogSnapshot struct {
	Pricing            []Pricing
	Vendors            []PricingVendor
	SupportedEndpoints map[string]common.EndpointInfo
}

func pricingCacheNeedsRefreshLocked() bool {
	return time.Since(lastGetPricingTime) > time.Minute || len(pricingMap) == 0
}

func cloneFloat64Pointer(value *float64) *float64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneStrings(values []string) []string {
	if values == nil {
		return nil
	}
	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}

func cloneEndpointTypes(values []constant.EndpointType) []constant.EndpointType {
	if values == nil {
		return nil
	}
	cloned := make([]constant.EndpointType, len(values))
	copy(cloned, values)
	return cloned
}

func clonePricingItems(values []Pricing) []Pricing {
	if values == nil {
		return nil
	}
	cloned := make([]Pricing, len(values))
	for index, value := range values {
		item := value
		item.CacheRatio = cloneFloat64Pointer(value.CacheRatio)
		item.CreateCacheRatio = cloneFloat64Pointer(value.CreateCacheRatio)
		item.ImageRatio = cloneFloat64Pointer(value.ImageRatio)
		item.AudioRatio = cloneFloat64Pointer(value.AudioRatio)
		item.AudioCompletionRatio = cloneFloat64Pointer(value.AudioCompletionRatio)
		item.EnableGroup = cloneStrings(value.EnableGroup)
		item.SupportedEndpointTypes = cloneEndpointTypes(value.SupportedEndpointTypes)
		if value.ParamPricing != nil {
			paramPricing := *value.ParamPricing
			if value.ParamPricing.Results != nil {
				paramPricing.Results = make([]ParamPricingResult, len(value.ParamPricing.Results))
				copy(paramPricing.Results, value.ParamPricing.Results)
			}
			item.ParamPricing = &paramPricing
		}
		cloned[index] = item
	}
	return cloned
}

func clonePricingVendors(values []PricingVendor) []PricingVendor {
	if values == nil {
		return nil
	}
	cloned := make([]PricingVendor, len(values))
	copy(cloned, values)
	return cloned
}

func cloneSupportedEndpoints(values map[string]common.EndpointInfo) map[string]common.EndpointInfo {
	cloned := make(map[string]common.EndpointInfo, len(values))
	for endpointType, info := range values {
		cloned[endpointType] = info
	}
	return cloned
}

// clonePricingCatalogSnapshotLocked must be called while
// modelSupportEndpointsLock is held for reading or writing.
func clonePricingCatalogSnapshotLocked() PricingCatalogSnapshot {
	return PricingCatalogSnapshot{
		Pricing:            clonePricingItems(pricingMap),
		Vendors:            clonePricingVendors(vendorsList),
		SupportedEndpoints: cloneSupportedEndpoints(supportedEndpointMap),
	}
}

// GetPricingCatalogSnapshotWithError refreshes stale pricing data when needed,
// then returns pricing, vendors, and endpoint descriptors from one locked cache
// version. The fast path only takes a shared read lock.
func GetPricingCatalogSnapshotWithError() (PricingCatalogSnapshot, error) {
	modelSupportEndpointsLock.RLock()
	if !pricingCacheNeedsRefreshLocked() {
		snapshot := clonePricingCatalogSnapshotLocked()
		modelSupportEndpointsLock.RUnlock()
		return snapshot, nil
	}
	modelSupportEndpointsLock.RUnlock()

	updatePricingLock.Lock()
	defer updatePricingLock.Unlock()

	modelSupportEndpointsLock.Lock()
	defer modelSupportEndpointsLock.Unlock()

	previousSnapshot := clonePricingCatalogSnapshotLocked()
	if pricingCacheNeedsRefreshLocked() {
		if err := updatePricing(); err != nil {
			return previousSnapshot, err
		}
	}
	return clonePricingCatalogSnapshotLocked(), nil
}

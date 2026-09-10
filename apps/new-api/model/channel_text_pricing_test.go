package model

import (
	"github.com/QuantumNous/new-api/dto"
	"math"
	"testing"
)

func TestChannelTextProcurementRates(t *testing.T) {
	settings := dto.ChannelSettings{TextSaleMultiplier: 2, TextCostPerMillionCNY: map[string]dto.TextTokenCostCNY{"test": {Input: 3.15, Output: 9.45, CacheRead: .105, CacheWrite: 3.15}}}
	rate, ok, err := ChannelTextRetail(settings, "test")
	if err != nil || !ok || math.Abs(rate.Input-6.3) > 1e-9 || math.Abs(rate.Output-18.9) > 1e-9 || math.Abs(rate.CacheRead-.21) > 1e-9 {
		t.Fatalf("unexpected rate %+v %v", rate, err)
	}
	if _, ok, err := ChannelTextRetail(settings, "other"); ok || err != nil {
		t.Fatal("channel rate leaked to other model")
	}
	settings.PriceRatio = 2
	if _, _, err := ChannelTextRetail(settings, "test"); err == nil {
		t.Fatal("accepted conflicting multiplier")
	}
	settings.PriceRatio = 0
	settings.TextSaleMultiplier = math.NaN()
	if _, _, err := ChannelTextRetail(settings, "test"); err == nil {
		t.Fatal("accepted NaN")
	}
}

func TestChannelTextPublishedQuoteCoversAllChannels(t *testing.T) {
	cache := .1
	p := Pricing{ModelRatio: 1, CompletionRatio: 4, CacheRatio: &cache}
	applyChannelTextQuotes(&p, []ChannelTextPrice{{Input: 6.3, Output: 18.9, CacheRead: .21, CacheWrite: 6.3}})
	if math.Abs(p.ModelRatio*2-6.3) > 1e-9 || math.Abs(p.ModelRatio*2*p.CompletionRatio-18.9) > 1e-9 || math.Abs(p.ModelRatio*2**p.CacheRatio-.21) > 1e-9 {
		t.Fatalf("bad quote %+v", p)
	}
}

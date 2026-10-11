package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestDroidRefreshSerializesCollectionForOneAccountPool(t *testing.T) {
	previousDB, previousCache := model.DB, common.MemoryCacheEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.Channel{}))
	model.DB, common.MemoryCacheEnabled = db, false
	t.Cleanup(func() {
		model.DB, common.MemoryCacheEnabled = previousDB, previousCache
		require.NoError(t, sqlDB.Close())
	})
	firstStarted, releaseFirst := make(chan struct{}), make(chan struct{})
	var queries atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/billing/limits":
			ordinal := queries.Add(1)
			if ordinal == 1 {
				close(firstStarted)
				<-releaseFirst
			}
			fmt.Fprintf(w, `{"limits":{"standard":{"weekly":{"usedPercent":%d}}}}`, ordinal)
		case "/api/app/auth/me":
			fmt.Fprint(w, droidSubscriptionFixture)
		case "/api/organization/subscription/usage":
			fmt.Fprint(w, droidTotalsFixture)
		case "/api/factory-api-key/list":
			fmt.Fprint(w, `[{"fingerprint":"fixture-key"}]`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	channel := model.Channel{Id: 9607, Type: constant.ChannelTypeDroid, Key: "fixture-key", BaseURL: &server.URL, ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeySize: 1}}
	require.NoError(t, db.Create(&channel).Error)
	firstFinished, secondFinished := make(chan error, 1), make(chan error, 1)
	go func() { _, err := RefreshDroidChannelUsage(context.Background(), channel.Id); firstFinished <- err }()
	<-firstStarted
	secondInvoked := make(chan struct{})
	go func() {
		close(secondInvoked)
		_, err := RefreshDroidChannelUsage(context.Background(), channel.Id)
		secondFinished <- err
	}()
	<-secondInvoked
	time.Sleep(50 * time.Millisecond)
	observed := queries.Load()
	close(releaseFirst)
	require.Equal(t, int32(1), observed, "a second refresh cannot collect a newer snapshot while the first is still pending")
	require.NoError(t, <-firstFinished)
	require.NoError(t, <-secondFinished)
	stored, err := model.GetChannelById(channel.Id, true)
	require.NoError(t, err)
	require.Equal(t, float64(2), *stored.ChannelInfo.MultiKeyUsage[0].QuotaWindows[0].UsedPercent)
}

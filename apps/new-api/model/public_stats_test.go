package model

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestPublicModelHealthStatus(t *testing.T) {
	tests := []struct {
		name         string
		available    bool
		callCount    int64
		successCount int64
		want         string
	}{
		{name: "unavailable", available: false, callCount: 100, successCount: 100, want: "unavailable"},
		{name: "no data", available: true, callCount: 0, successCount: 0, want: "no_data"},
		{name: "operational", available: true, callCount: 100, successCount: 98, want: "operational"},
		{name: "degraded", available: true, callCount: 100, successCount: 90, want: "degraded"},
		{name: "unstable", available: true, callCount: 100, successCount: 89, want: "unstable"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := publicModelHealthStatus(test.available, test.callCount, test.successCount)
			if got != test.want {
				t.Fatalf("health status = %q, want %q", got, test.want)
			}
		})
	}
}

func TestPublicModelSpecifications(t *testing.T) {
	raw := `{
		"currency":"CNY",
		"billing_mode":"fixed_by_spec",
		"specs":[
			{"spec_key":"standard","resolution":"720p","duration_seconds":5,"price_cny":1.2},
			{"spec_key":"pro","resolution":"1080p","duration_seconds":10,"price_cny":2.4}
		]
	}`

	got, err := publicModelSpecifications(raw)
	if err != nil {
		t.Fatalf("publicModelSpecifications returned error: %v", err)
	}
	want := []string{"standard · 720p · 5s", "pro · 1080p · 10s"}
	if len(got) != len(want) {
		t.Fatalf("specification count = %d, want %d", len(got), len(want))
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("specification[%d] = %q, want %q", index, got[index], want[index])
		}
	}
}

func TestParsePublicModelCategory(t *testing.T) {
	for _, category := range []PublicModelCategory{
		PublicModelCategoryAll,
		PublicModelCategoryText,
		PublicModelCategoryVideo,
		PublicModelCategoryImage,
	} {
		got, err := ParsePublicModelCategory(string(category))
		if err != nil {
			t.Fatalf("ParsePublicModelCategory(%q) returned error: %v", category, err)
		}
		if got != category {
			t.Fatalf("ParsePublicModelCategory(%q) = %q", category, got)
		}
	}
	if _, err := ParsePublicModelCategory("audio"); err == nil {
		t.Fatal("ParsePublicModelCategory(audio) returned nil error")
	}
}

func TestGetPublicModelStatsReturnsTopTenWithRuntimeFacts(t *testing.T) {
	oldDB := DB
	oldLogDB := LOG_DB
	t.Cleanup(func() {
		DB = oldDB
		LOG_DB = oldLogDB
	})

	var err error
	DB, err = gorm.Open(sqlite.Open("file:"+t.Name()+"-main?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open main database: %v", err)
	}
	LOG_DB, err = gorm.Open(sqlite.Open("file:"+t.Name()+"-logs?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open log database: %v", err)
	}
	if err := DB.AutoMigrate(&Model{}, &Ability{}); err != nil {
		t.Fatalf("migrate main database: %v", err)
	}
	if err := LOG_DB.AutoMigrate(&Log{}); err != nil {
		t.Fatalf("migrate log database: %v", err)
	}

	modelName := "public-stats-model"
	if err := DB.Create(&Model{ModelName: modelName, Kind: "chat", Status: ModelMetaStatusEnabled}).Error; err != nil {
		t.Fatalf("create model: %v", err)
	}
	priority := int64(0)
	if err := DB.Create(&Ability{Group: "default", Model: modelName, ChannelId: 1, Enabled: true, Priority: &priority}).Error; err != nil {
		t.Fatalf("create ability: %v", err)
	}
	now := time.Now().Unix()
	logs := []Log{
		{CreatedAt: now, Type: LogTypeConsume, ModelName: modelName, UseTime: 2, PromptTokens: 100, CompletionTokens: 20},
		{CreatedAt: now, Type: LogTypeConsume, ModelName: modelName, UseTime: 4, PromptTokens: 300, CompletionTokens: 40},
		{CreatedAt: now, Type: LogTypeError, ModelName: modelName, UseTime: 6},
	}
	if err := LOG_DB.Create(&logs).Error; err != nil {
		t.Fatalf("create logs: %v", err)
	}

	stats, err := GetPublicModelStats(PublicModelCategoryAll)
	if err != nil {
		t.Fatalf("GetPublicModelStats returned error: %v", err)
	}
	if len(stats) != 1 {
		t.Fatalf("stats count = %d, want 1", len(stats))
	}
	stat := stats[0]
	if stat.CallCount != 3 || stat.SuccessCount != 2 {
		t.Fatalf("counts = (%d, %d), want (3, 2)", stat.CallCount, stat.SuccessCount)
	}
	if stat.AverageLatencySeconds != 4 || stat.MaximumLatencySeconds != 6 {
		t.Fatalf("latencies = (%v, %d), want (4, 6)", stat.AverageLatencySeconds, stat.MaximumLatencySeconds)
	}
	if stat.AveragePromptTokens != 200 || stat.AverageCompletionTokens != 30 {
		t.Fatalf("token averages = (%v, %v), want (200, 30)", stat.AveragePromptTokens, stat.AverageCompletionTokens)
	}
	if !stat.Available || stat.HealthStatus != "unstable" || stat.ModelKind != "chat" {
		t.Fatalf("runtime facts = available:%v status:%q kind:%q", stat.Available, stat.HealthStatus, stat.ModelKind)
	}
}

func TestGetPublicModelStatsRanksEachCategoryByCallCount(t *testing.T) {
	oldDB := DB
	oldLogDB := LOG_DB
	t.Cleanup(func() {
		DB = oldDB
		LOG_DB = oldLogDB
	})

	var err error
	DB, err = gorm.Open(sqlite.Open("file:"+t.Name()+"-main?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open main database: %v", err)
	}
	LOG_DB, err = gorm.Open(sqlite.Open("file:"+t.Name()+"-logs?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open log database: %v", err)
	}
	if err := DB.AutoMigrate(&Model{}, &Ability{}); err != nil {
		t.Fatalf("migrate main database: %v", err)
	}
	if err := LOG_DB.AutoMigrate(&Log{}); err != nil {
		t.Fatalf("migrate log database: %v", err)
	}

	models := []Model{
		{ModelName: "chat-low", Kind: "chat", Status: ModelMetaStatusEnabled},
		{ModelName: "text-high", Kind: "text", Status: ModelMetaStatusEnabled},
		{ModelName: "image-high", Kind: "image", Status: ModelMetaStatusEnabled},
		{ModelName: "video-medium", Kind: "video", Status: ModelMetaStatusEnabled},
		{ModelName: "audio-highest", Kind: "audio", Status: ModelMetaStatusEnabled},
	}
	if err := DB.Create(&models).Error; err != nil {
		t.Fatalf("create models: %v", err)
	}

	now := time.Now().Unix()
	callCounts := map[string]int{
		"chat-low":      2,
		"text-high":     7,
		"image-high":    9,
		"video-medium":  5,
		"audio-highest": 12,
	}
	logs := make([]Log, 0)
	for modelName, callCount := range callCounts {
		for index := 0; index < callCount; index++ {
			logs = append(logs, Log{CreatedAt: now, Type: LogTypeConsume, ModelName: modelName, UseTime: 1})
		}
	}
	if err := LOG_DB.Create(&logs).Error; err != nil {
		t.Fatalf("create logs: %v", err)
	}

	allStats, err := GetPublicModelStats(PublicModelCategoryAll)
	if err != nil {
		t.Fatalf("GetPublicModelStats(all) returned error: %v", err)
	}
	wantAll := []string{"audio-highest", "image-high", "text-high", "video-medium", "chat-low"}
	assertPublicModelOrder(t, allStats, wantAll)

	textStats, err := GetPublicModelStats(PublicModelCategoryText)
	if err != nil {
		t.Fatalf("GetPublicModelStats(text) returned error: %v", err)
	}
	assertPublicModelOrder(t, textStats, []string{"text-high", "chat-low"})

	imageStats, err := GetPublicModelStats(PublicModelCategoryImage)
	if err != nil {
		t.Fatalf("GetPublicModelStats(image) returned error: %v", err)
	}
	assertPublicModelOrder(t, imageStats, []string{"image-high"})

	videoStats, err := GetPublicModelStats(PublicModelCategoryVideo)
	if err != nil {
		t.Fatalf("GetPublicModelStats(video) returned error: %v", err)
	}
	assertPublicModelOrder(t, videoStats, []string{"video-medium"})
}

func assertPublicModelOrder(t *testing.T, stats []PublicModelStat, want []string) {
	t.Helper()
	if len(stats) != len(want) {
		t.Fatalf("stats count = %d, want %d", len(stats), len(want))
	}
	for index, modelName := range want {
		if stats[index].ModelName != modelName {
			t.Fatalf("stats[%d].ModelName = %q, want %q", index, stats[index].ModelName, modelName)
		}
		if index > 0 && stats[index-1].CallCount < stats[index].CallCount {
			t.Fatalf("stats are not ordered by call count descending: %d before %d", stats[index-1].CallCount, stats[index].CallCount)
		}
	}
}

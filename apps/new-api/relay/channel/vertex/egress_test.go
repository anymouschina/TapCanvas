package vertex

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func testEgressSettings(cells []dto.VertexEgressCell) dto.ChannelSettings {
	return dto.ChannelSettings{
		Proxy:                        "socks5://legacy-proxy.example.com:1080",
		VertexEgressIsolationEnabled: true,
		VertexEgressCells:            cells,
	}
}

func TestApplyDedicatedEgressDisabledForcesDirectConnection(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ApiKey: "vertex-api-key-a",
		ChannelSetting: dto.ChannelSettings{
			Proxy: "socks5://legacy-proxy.example.com:1080",
		},
		ChannelOtherSettings: dto.ChannelOtherSettings{VertexKeyType: dto.VertexKeyTypeAPIKey},
	}}

	selection, err := ApplyDedicatedEgress(info)
	require.NoError(t, err)
	require.Empty(t, selection.CellID)
	require.Empty(t, selection.ProxyURL)
	require.Empty(t, info.ChannelSetting.Proxy)
	require.Empty(t, info.EgressCellID)
}

func TestResolveDedicatedEgressIsStableAcrossCellOrdering(t *testing.T) {
	t.Parallel()

	cells := []dto.VertexEgressCell{
		{ID: "tokyo-01", ProxyURL: "https://proxy-01.example.com"},
		{ID: "tokyo-02", ProxyURL: "https://proxy-02.example.com"},
		{ID: "tokyo-03", ProxyURL: "socks5://proxy-03.example.com:1080"},
	}
	reordered := []dto.VertexEgressCell{cells[2], cells[0], cells[1]}

	first, err := ResolveDedicatedEgress(testEgressSettings(cells), dto.VertexKeyTypeAPIKey, "vertex-api-key-a", "")
	require.NoError(t, err)
	second, err := ResolveDedicatedEgress(testEgressSettings(reordered), dto.VertexKeyTypeAPIKey, "vertex-api-key-a", "")
	require.NoError(t, err)
	require.Equal(t, first, second)
}

func TestResolveDedicatedEgressServiceAccountIdentityIgnoresPrivateKeyRotation(t *testing.T) {
	t.Parallel()

	settings := testEgressSettings([]dto.VertexEgressCell{
		{ID: "tokyo-01", ProxyURL: "https://proxy-01.example.com"},
		{ID: "tokyo-02", ProxyURL: "https://proxy-02.example.com"},
	})
	credentialA := `{"project_id":"project-a","client_email":"svc@project-a.iam.gserviceaccount.com","private_key":"key-a"}`
	credentialB := `{"private_key":"key-b","client_email":"svc@project-a.iam.gserviceaccount.com","project_id":"project-a"}`

	first, err := ResolveDedicatedEgress(settings, dto.VertexKeyTypeJSON, credentialA, "")
	require.NoError(t, err)
	second, err := ResolveDedicatedEgress(settings, dto.VertexKeyTypeJSON, credentialB, "")
	require.NoError(t, err)
	require.Equal(t, first.CellID, second.CellID)
}

func TestResolveDedicatedEgressHonorsPersistedTaskCell(t *testing.T) {
	t.Parallel()

	settings := testEgressSettings([]dto.VertexEgressCell{
		{ID: "tokyo-01", ProxyURL: "https://proxy-01.example.com"},
		{ID: "tokyo-02", ProxyURL: "https://proxy-02.example.com"},
	})

	selection, err := ResolveDedicatedEgress(settings, dto.VertexKeyTypeAPIKey, "vertex-api-key-a", "tokyo-02")
	require.NoError(t, err)
	require.Equal(t, EgressSelection{CellID: "tokyo-02", ProxyURL: "https://proxy-02.example.com"}, selection)
}

func TestResolveDedicatedEgressDoesNotFallbackWhenPersistedCellIsMissing(t *testing.T) {
	t.Parallel()

	settings := testEgressSettings([]dto.VertexEgressCell{
		{ID: "tokyo-01", ProxyURL: "https://proxy-01.example.com"},
	})

	_, err := ResolveDedicatedEgress(settings, dto.VertexKeyTypeAPIKey, "vertex-api-key-a", "tokyo-removed")
	require.ErrorContains(t, err, "拒绝回退直连")
}

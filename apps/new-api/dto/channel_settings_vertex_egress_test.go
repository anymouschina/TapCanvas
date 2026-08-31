package dto

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateVertexEgressAllowsDisabledPool(t *testing.T) {
	t.Parallel()

	settings := ChannelSettings{
		VertexEgressIsolationEnabled: false,
		VertexEgressCells: []VertexEgressCell{
			{ID: "", ProxyURL: "not-a-proxy"},
		},
	}

	require.NoError(t, settings.ValidateVertexEgress())
}

func TestValidateVertexEgressRequiresConfiguredUniqueCells(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		cells    []VertexEgressCell
		contains string
	}{
		{name: "empty", contains: "未配置出口单元"},
		{
			name:     "duplicate id",
			cells:    []VertexEgressCell{{ID: "tokyo-01", ProxyURL: "https://proxy-a.example.com"}, {ID: "tokyo-01", ProxyURL: "socks5://proxy-b.example.com:1080"}},
			contains: "出口 ID 重复",
		},
		{
			name:     "unsupported scheme",
			cells:    []VertexEgressCell{{ID: "tokyo-01", ProxyURL: "ftp://proxy-a.example.com"}},
			contains: "代理协议必须",
		},
		{
			name:     "missing host",
			cells:    []VertexEgressCell{{ID: "tokyo-01", ProxyURL: "socks5://"}},
			contains: "缺少主机",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			settings := ChannelSettings{
				VertexEgressIsolationEnabled: true,
				VertexEgressCells:            test.cells,
			}
			require.ErrorContains(t, settings.ValidateVertexEgress(), test.contains)
		})
	}
}

func TestValidateVertexEgressAcceptsSupportedProxySchemes(t *testing.T) {
	t.Parallel()

	settings := ChannelSettings{
		VertexEgressIsolationEnabled: true,
		VertexEgressCells: []VertexEgressCell{
			{ID: "tokyo-http", ProxyURL: "http://proxy-a.example.com:8080"},
			{ID: "tokyo-https", ProxyURL: "https://user:pass@proxy-b.example.com"},
			{ID: "tokyo-socks", ProxyURL: "socks5h://proxy-c.example.com:1080"},
		},
	}

	require.NoError(t, settings.ValidateVertexEgress())
}

package model

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestInitTaskPersistsVertexAccountAndEgressCell(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ProtocolID:   constant.ProtocolTaskVertex,
		ApiKey:       `{"project_id":"project-a"}`,
		EgressCellID: "tokyo-07",
	}}

	task := InitTask(constant.TaskPlatformVertex, info)
	require.Equal(t, info.ApiKey, task.PrivateData.Key)
	require.Equal(t, "tokyo-07", task.PrivateData.EgressCellID)
}

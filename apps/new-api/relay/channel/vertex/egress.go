package vertex

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

type EgressSelection struct {
	CellID   string
	ProxyURL string
}

// ApplyDedicatedEgress enforces the Vertex channel's explicit network mode.
// Disabled means direct even if the generic channel proxy has a value.
// Enabled means exactly one configured cell is selected; errors are returned
// to the caller and never trigger an implicit direct connection.
func ApplyDedicatedEgress(info *relaycommon.RelayInfo) (EgressSelection, error) {
	if info == nil || info.ChannelMeta == nil {
		return EgressSelection{}, fmt.Errorf("Vertex relay info is missing")
	}
	selection, err := ResolveDedicatedEgress(
		info.ChannelSetting,
		info.ChannelOtherSettings.VertexKeyType,
		info.ApiKey,
		info.EgressCellID,
	)
	if err != nil {
		return EgressSelection{}, err
	}
	info.ChannelSetting.Proxy = selection.ProxyURL
	info.EgressCellID = selection.CellID
	return selection, nil
}

// ResolveDedicatedEgress uses rendezvous hashing so each account remains
// sticky to a cell and cell ordering does not affect assignments. A persisted
// preferredCellID (used by asynchronous tasks) takes precedence.
func ResolveDedicatedEgress(
	setting dto.ChannelSettings,
	keyType dto.VertexKeyType,
	credential string,
	preferredCellID string,
) (EgressSelection, error) {
	if !setting.VertexEgressIsolationEnabled {
		return EgressSelection{}, nil
	}
	if err := setting.ValidateVertexEgress(); err != nil {
		return EgressSelection{}, err
	}

	preferredCellID = strings.TrimSpace(preferredCellID)
	if preferredCellID != "" {
		for _, cell := range setting.VertexEgressCells {
			if strings.TrimSpace(cell.ID) == preferredCellID {
				return normalizeEgressSelection(cell), nil
			}
		}
		return EgressSelection{}, fmt.Errorf(
			"Vertex Dedicated Egress 出口 %s 已不存在，拒绝回退直连",
			preferredCellID,
		)
	}

	identity, err := vertexCredentialIdentity(keyType, credential)
	if err != nil {
		return EgressSelection{}, err
	}

	var selected dto.VertexEgressCell
	var selectedScore uint64
	for index, cell := range setting.VertexEgressCells {
		score := rendezvousScore(identity, strings.TrimSpace(cell.ID))
		if index == 0 || score > selectedScore ||
			(score == selectedScore && strings.TrimSpace(cell.ID) < strings.TrimSpace(selected.ID)) {
			selected = cell
			selectedScore = score
		}
	}
	return normalizeEgressSelection(selected), nil
}

func vertexCredentialIdentity(keyType dto.VertexKeyType, credential string) (string, error) {
	credential = strings.TrimSpace(credential)
	if credential == "" {
		return "", fmt.Errorf("Vertex Dedicated Egress 无法为缺失的账号凭证分配出口")
	}
	if keyType == dto.VertexKeyTypeAPIKey {
		sum := sha256.Sum256([]byte(credential))
		return fmt.Sprintf("api-key:%x", sum[:]), nil
	}

	credentials := Credentials{}
	if err := common.Unmarshal([]byte(credential), &credentials); err != nil {
		return "", fmt.Errorf("Vertex Dedicated Egress 无法解析服务账号身份: %w", err)
	}
	projectID := strings.TrimSpace(credentials.ProjectID)
	clientEmail := strings.TrimSpace(credentials.ClientEmail)
	if projectID == "" || clientEmail == "" {
		return "", fmt.Errorf("Vertex Dedicated Egress 服务账号必须包含 project_id 和 client_email")
	}
	return "service-account:" + projectID + "\x00" + clientEmail, nil
}

func rendezvousScore(identity string, cellID string) uint64 {
	sum := sha256.Sum256([]byte(identity + "\x00" + cellID))
	return binary.BigEndian.Uint64(sum[:8])
}

func normalizeEgressSelection(cell dto.VertexEgressCell) EgressSelection {
	return EgressSelection{
		CellID:   strings.TrimSpace(cell.ID),
		ProxyURL: strings.TrimSpace(cell.ProxyURL),
	}
}

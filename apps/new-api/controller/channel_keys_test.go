package controller

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGetLineSeparatedKeysNormalizesAndDeduplicates(t *testing.T) {
	t.Parallel()

	keys, err := getLineSeparatedKeys("  key-a  \n\nkey-b\nkey-a\n")
	require.NoError(t, err)
	require.Equal(t, []string{"key-a", "key-b"}, keys)
}

func TestGetLineSeparatedKeysRejectsEmptyInput(t *testing.T) {
	t.Parallel()

	_, err := getLineSeparatedKeys(" \n\t\n")
	require.EqualError(t, err, "批量添加的密钥不能为空")
}

func TestGetVertexArrayKeysNormalizesObjectsAndDeduplicates(t *testing.T) {
	t.Parallel()

	keys, err := getVertexArrayKeys(`[
        {"type":"service_account","project_id":"project-a"},
        {"type":"service_account","project_id":"project-a"},
        {"type":"service_account","project_id":"project-b"}
    ]`)
	require.NoError(t, err)
	require.Equal(t, []string{
		`{"project_id":"project-a","type":"service_account"}`,
		`{"project_id":"project-b","type":"service_account"}`,
	}, keys)
}

func TestGetVertexArrayKeysRejectsEmptyArray(t *testing.T) {
	t.Parallel()

	_, err := getVertexArrayKeys(`[]`)
	require.EqualError(t, err, "批量添加 Vertex AI 的 keys 不能为空")
}

func TestMergeUniqueKeysPreservesOrderAndAddsOnlyNewAccounts(t *testing.T) {
	t.Parallel()

	keys := mergeUniqueKeys(
		[]string{"key-a", " key-b ", ""},
		[]string{"key-b", "key-c", " key-a ", "key-d"},
	)

	require.Equal(t, []string{"key-a", "key-b", "key-c", "key-d"}, keys)
}

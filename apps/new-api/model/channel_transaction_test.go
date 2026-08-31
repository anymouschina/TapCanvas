package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func insertChannelTransactionFixture(
	t *testing.T,
	name string,
	tag string,
	modelName string,
	group string,
) Channel {
	t.Helper()
	if err := DB.AutoMigrate(&Channel{}, &Ability{}); err != nil {
		t.Fatalf("failed to migrate channel transaction fixtures: %v", err)
	}
	tagValue := tag
	channel := Channel{
		Key:    "transaction-test-key",
		Name:   name,
		Models: modelName,
		Group:  group,
		Status: common.ChannelStatusEnabled,
		Tag:    &tagValue,
	}
	if err := channel.Insert(); err != nil {
		t.Fatalf("failed to insert channel transaction fixture: %v", err)
	}
	t.Cleanup(func() {
		if err := DB.Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error; err != nil {
			t.Errorf("failed to clean channel abilities: %v", err)
		}
		if err := DB.Delete(&Channel{}, channel.Id).Error; err != nil {
			t.Errorf("failed to clean channel fixture: %v", err)
		}
	})
	return channel
}

func TestEditChannelByTagRebuildsAbilitiesInOneTransaction(t *testing.T) {
	const (
		originalTag   = "channel-transaction-edit-original"
		updatedTag    = "channel-transaction-edit-updated"
		originalModel = "channel-transaction-old-model"
		updatedModel  = "channel-transaction-new-model"
		updatedGroup  = "channel-transaction-new-group"
	)
	channel := insertChannelTransactionFixture(
		t,
		"channel-transaction-edit",
		originalTag,
		originalModel,
		"default",
	)
	priority := int64(0)
	weight := uint(0)

	if err := EditChannelByTag(
		originalTag,
		stringPointer(updatedTag),
		nil,
		stringPointer(updatedModel),
		stringPointer(updatedGroup),
		&priority,
		&weight,
		nil,
		nil,
	); err != nil {
		t.Fatalf("tag edit failed: %v", err)
	}

	var stored Channel
	if err := DB.First(&stored, channel.Id).Error; err != nil {
		t.Fatalf("reload edited channel failed: %v", err)
	}
	if stored.Tag == nil || *stored.Tag != updatedTag {
		t.Fatalf("stored channel tag = %#v, want %q", stored.Tag, updatedTag)
	}
	if stored.Models != updatedModel || stored.Group != updatedGroup {
		t.Fatalf(
			"stored channel routing = model %q group %q, want model %q group %q",
			stored.Models,
			stored.Group,
			updatedModel,
			updatedGroup,
		)
	}

	var abilities []Ability
	if err := DB.Where("channel_id = ?", channel.Id).Find(&abilities).Error; err != nil {
		t.Fatalf("load rebuilt abilities failed: %v", err)
	}
	if len(abilities) != 1 {
		t.Fatalf("rebuilt ability count = %d, want 1", len(abilities))
	}
	ability := abilities[0]
	if ability.Tag == nil || *ability.Tag != updatedTag {
		t.Fatalf("ability tag = %#v, want %q", ability.Tag, updatedTag)
	}
	if ability.Model != updatedModel || ability.Group != updatedGroup {
		t.Fatalf(
			"ability routing = model %q group %q, want model %q group %q",
			ability.Model,
			ability.Group,
			updatedModel,
			updatedGroup,
		)
	}
}

func TestBatchSetChannelTagUsesUpdatedChannelStateForAbilities(t *testing.T) {
	const (
		originalTag = "channel-transaction-batch-original"
		updatedTag  = "channel-transaction-batch-updated"
	)
	channel := insertChannelTransactionFixture(
		t,
		"channel-transaction-batch",
		originalTag,
		"channel-transaction-batch-model",
		"default",
	)

	if err := BatchSetChannelTag([]int{channel.Id}, stringPointer(updatedTag)); err != nil {
		t.Fatalf("batch tag update failed: %v", err)
	}

	var ability Ability
	if err := DB.Where("channel_id = ?", channel.Id).First(&ability).Error; err != nil {
		t.Fatalf("load updated ability failed: %v", err)
	}
	if ability.Tag == nil || *ability.Tag != updatedTag {
		t.Fatalf("ability tag = %#v, want %q", ability.Tag, updatedTag)
	}
}

func TestChannelDeleteRemovesDerivedAbilitiesAtomically(t *testing.T) {
	channel := insertChannelTransactionFixture(
		t,
		"channel-transaction-delete",
		"channel-transaction-delete-tag",
		"channel-transaction-delete-model",
		"default",
	)

	if err := channel.Delete(); err != nil {
		t.Fatalf("channel delete failed: %v", err)
	}

	var channelCount int64
	if err := DB.Model(&Channel{}).Where("id = ?", channel.Id).Count(&channelCount).Error; err != nil {
		t.Fatalf("count deleted channel failed: %v", err)
	}
	var abilityCount int64
	if err := DB.Model(&Ability{}).Where("channel_id = ?", channel.Id).Count(&abilityCount).Error; err != nil {
		t.Fatalf("count deleted abilities failed: %v", err)
	}
	if channelCount != 0 || abilityCount != 0 {
		t.Fatalf(
			"delete left channel_count=%d ability_count=%d, want both zero",
			channelCount,
			abilityCount,
		)
	}
}

func stringPointer(value string) *string {
	return &value
}

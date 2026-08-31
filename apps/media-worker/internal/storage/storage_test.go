package storage

import (
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

func TestObjectNotFoundRecognizesStructuredS3Errors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "typed not found", err: &types.NotFound{}, want: true},
		{name: "generic no such key", err: &smithy.GenericAPIError{Code: "NoSuchKey"}, want: true},
		{name: "authorization failure", err: &smithy.GenericAPIError{Code: "AccessDenied"}, want: false},
		{name: "ordinary error", err: errors.New("storage unavailable"), want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := objectNotFound(test.err); got != test.want {
				t.Fatalf("objectNotFound() = %t, want %t", got, test.want)
			}
		})
	}
}

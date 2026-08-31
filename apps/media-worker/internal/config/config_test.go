package config

import "testing"

func clearStorageEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"OBJECT_STORAGE_PROVIDER",
		"TOS_ACCESS_KEY_ID", "TOS_SECRET_ACCESS_KEY", "TOS_ENDPOINT_URL",
		"TOS_REGION", "TOS_BUCKET", "TOS_PUBLIC_BASE_URL", "TOS_SESSION_TOKEN",
		"R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT_URL",
		"R2_REGION", "R2_BUCKET", "R2_PUBLIC_BASE_URL", "R2_SESSION_TOKEN",
	} {
		t.Setenv(k, "")
	}
}

func TestResolveStorageUnconfigured(t *testing.T) {
	clearStorageEnv(t)
	if got := ResolveStorage(); got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
}

func TestResolveStorageTOS(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("OBJECT_STORAGE_PROVIDER", "tos")
	t.Setenv("TOS_ACCESS_KEY_ID", "ak")
	t.Setenv("TOS_SECRET_ACCESS_KEY", "sk")
	t.Setenv("TOS_ENDPOINT_URL", "https://tos-s3-cn-guangzhou.volces.com/")
	t.Setenv("TOS_REGION", "cn-guangzhou")
	t.Setenv("TOS_BUCKET", "tanvas-ai")
	t.Setenv("TOS_PUBLIC_BASE_URL", "https://tanvas-ai.tos-cn-guangzhou.volces.com/")

	s := ResolveStorage()
	if s == nil {
		t.Fatal("expected storage config")
	}
	if s.Provider != "tos" {
		t.Fatalf("provider = %q", s.Provider)
	}
	if s.Bucket != "tanvas-ai" {
		t.Fatalf("bucket = %q", s.Bucket)
	}
	if s.Endpoint != "https://tos-s3-cn-guangzhou.volces.com" {
		t.Fatalf("endpoint = %q", s.Endpoint)
	}
	if s.Region != "cn-guangzhou" {
		t.Fatalf("region = %q", s.Region)
	}
	if s.ForcePathStyle {
		t.Fatal("TOS must not force path style")
	}
	if s.PublicBase != "https://tanvas-ai.tos-cn-guangzhou.volces.com" {
		t.Fatalf("publicBase = %q", s.PublicBase)
	}
	if got := s.PublicURL("gen/thumbnails/u/x.jpg"); got != "https://tanvas-ai.tos-cn-guangzhou.volces.com/gen/thumbnails/u/x.jpg" {
		t.Fatalf("PublicURL = %q", got)
	}
}

func TestResolveStorageRejectsIncompleteTOS(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("OBJECT_STORAGE_PROVIDER", "tos")
	t.Setenv("TOS_ACCESS_KEY_ID", "ak")
	defer func() {
		if recover() == nil {
			t.Fatal("expected incomplete TOS configuration to panic")
		}
	}()
	ResolveStorage()
}

func TestResolveStorageRejectsNativeTOSEndpoint(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("OBJECT_STORAGE_PROVIDER", "tos")
	t.Setenv("TOS_ACCESS_KEY_ID", "ak")
	t.Setenv("TOS_SECRET_ACCESS_KEY", "sk")
	t.Setenv("TOS_ENDPOINT_URL", "https://tos-cn-guangzhou.volces.com")
	t.Setenv("TOS_REGION", "cn-guangzhou")
	t.Setenv("TOS_BUCKET", "tanvas-ai")
	t.Setenv("TOS_PUBLIC_BASE_URL", "https://tanvas-ai.tos-cn-guangzhou.volces.com")
	defer func() {
		if recover() == nil {
			t.Fatal("expected native TOS endpoint to panic")
		}
	}()
	ResolveStorage()
}

func TestResolveStorageR2(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("OBJECT_STORAGE_PROVIDER", "r2")
	t.Setenv("R2_ACCESS_KEY_ID", "r2-ak")
	t.Setenv("R2_SECRET_ACCESS_KEY", "r2-sk")
	t.Setenv("R2_ENDPOINT_URL", "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com/")
	t.Setenv("R2_REGION", "auto")
	t.Setenv("R2_BUCKET", "canvas-pro")
	t.Setenv("R2_PUBLIC_BASE_URL", "https://file.beqlee.icu/")

	s := ResolveStorage()
	if s == nil || s.Provider != "r2" {
		t.Fatalf("expected R2 storage, got %+v", s)
	}
	if s.Endpoint != "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com" {
		t.Fatalf("endpoint = %q", s.Endpoint)
	}
	if got := s.PublicURL("gen/x.mp4"); got != "https://file.beqlee.icu/gen/x.mp4" {
		t.Fatalf("PublicURL = %q", got)
	}
}

func TestResolveStorageR2RequiresAutoRegion(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("OBJECT_STORAGE_PROVIDER", "r2")
	t.Setenv("R2_ACCESS_KEY_ID", "r2-ak")
	t.Setenv("R2_SECRET_ACCESS_KEY", "r2-sk")
	t.Setenv("R2_ENDPOINT_URL", "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com")
	t.Setenv("R2_REGION", "us-east-1")
	t.Setenv("R2_BUCKET", "canvas-pro")
	t.Setenv("R2_PUBLIC_BASE_URL", "https://file.beqlee.icu")
	defer func() {
		if recover() == nil {
			t.Fatal("expected non-auto R2 region to panic")
		}
	}()
	ResolveStorage()
}

func TestResolveStorageRequiresProvider(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("TOS_ACCESS_KEY_ID", "ak")
	defer func() {
		if recover() == nil {
			t.Fatal("expected missing provider to panic")
		}
	}()
	ResolveStorage()
}

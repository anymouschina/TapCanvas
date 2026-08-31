package dto

import "testing"

func TestValidateAIStudioImporter(t *testing.T) {
	valid := ChannelSettings{
		AIStudioImporterURL:         "https://studio-import.example.com",
		AIStudioImporterUsername:    "admin",
		AIStudioImporterPasswordEnv: "AISTUDIO_IMPORTER_PASSWORD",
	}
	if err := valid.ValidateAIStudioImporter(); err != nil {
		t.Fatalf("ValidateAIStudioImporter() error = %v", err)
	}

	invalid := valid
	invalid.AIStudioImporterURL = "http://studio-import.example.com"
	if err := invalid.ValidateAIStudioImporter(); err == nil {
		t.Fatal("ValidateAIStudioImporter() accepted an insecure URL")
	}

	invalid = valid
	invalid.AIStudioImporterPasswordEnv = "bad-env-name"
	if err := invalid.ValidateAIStudioImporter(); err == nil {
		t.Fatal("ValidateAIStudioImporter() accepted an invalid password env name")
	}
}

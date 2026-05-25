package system_setting

import "os"

var ServerAddress = func() string {
	return os.Getenv("SERVER_ADDRESS")
}()
var WorkerUrl = ""
var WorkerValidKey = ""
var WorkerAllowHttpImageRequestEnabled = false

func EnableWorker() bool {
	return WorkerUrl != ""
}

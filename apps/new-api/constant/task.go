package constant

type TaskPlatform string

const (
	TaskPlatformSuno       TaskPlatform = "suno"
	TaskPlatformMidjourney TaskPlatform = "mj"
	TaskPlatformAli        TaskPlatform = ProtocolTaskAli
	TaskPlatformKling      TaskPlatform = ProtocolTaskKling
	TaskPlatformJimeng     TaskPlatform = ProtocolTaskJimeng
	TaskPlatformVertex     TaskPlatform = ProtocolTaskVertex
	TaskPlatformVidu       TaskPlatform = ProtocolTaskVidu
	TaskPlatformDoubao     TaskPlatform = ProtocolTaskDoubao
	TaskPlatformSora       TaskPlatform = ProtocolTaskSora
	TaskPlatformGemini     TaskPlatform = ProtocolTaskGemini
	TaskPlatformMiniMax    TaskPlatform = ProtocolTaskMiniMax
	TaskPlatformMiniMaxV2  TaskPlatform = ProtocolTaskMiniMaxV2
	TaskPlatformWuyinkeji  TaskPlatform = ProtocolTaskWuyinkeji
	TaskPlatformAPIMart    TaskPlatform = ProtocolTaskAPIMart
	TaskPlatformEvolink    TaskPlatform = ProtocolTaskEvolink
	TaskPlatformFunAI      TaskPlatform = ProtocolTaskFunAI
	TaskPlatformMegaby     TaskPlatform = ProtocolTaskMegaby
	TaskPlatformMagic666   TaskPlatform = ProtocolTaskMagic666
	TaskPlatformMediaKit   TaskPlatform = ProtocolTaskMediaKit
)

const (
	SunoActionMusic  = "MUSIC"
	SunoActionLyrics = "LYRICS"

	TaskActionGenerate          = "generate"
	TaskActionTextGenerate      = "textGenerate"
	TaskActionFirstTailGenerate = "firstTailGenerate"
	TaskActionReferenceGenerate = "referenceGenerate"
	TaskActionRemix             = "remixGenerate"
)

var SunoModel2Action = map[string]string{
	"suno_music":  SunoActionMusic,
	"suno_lyrics": SunoActionLyrics,
}

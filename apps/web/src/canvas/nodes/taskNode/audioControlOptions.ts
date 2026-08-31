// MiniMax system voices. Keep these controls independent from AudioContent so
// selecting an audio model does not eagerly load WaveSurfer and the player UI.
export const AUDIO_VOICE_OPTIONS = [
  { value: 'male-qn-qingse', label: '青涩男声' },
  { value: 'male-qn-jingying', label: '精英男声' },
  { value: 'male-qn-badao', label: '霸道男声' },
  { value: 'female-shaonv', label: '少女音' },
  { value: 'female-yujie', label: '御姐音' },
  { value: 'female-chengshu', label: '成熟女声' },
  { value: 'female-tianmei', label: '甜美女声' },
  { value: 'presenter_male', label: '男主持' },
  { value: 'presenter_female', label: '女主持' },
  { value: 'audiobook_male_1', label: '有声书·男1' },
  { value: 'audiobook_male_2', label: '有声书·男2' },
  { value: 'audiobook_female_1', label: '有声书·女1' },
  { value: 'audiobook_female_2', label: '有声书·女2' },
] as const

export const AUDIO_EMOTION_OPTIONS = [
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'fearful', label: '恐惧' },
  { value: 'disgusted', label: '厌恶' },
  { value: 'surprised', label: '惊讶' },
  { value: 'calm', label: '平静' },
  { value: 'fluent', label: '流畅' },
  { value: 'whisper', label: '耳语' },
] as const

export const AUDIO_LYRICS_MODE_OPTIONS = [
  { value: 'instrumental', label: '纯音乐' },
  { value: 'auto', label: '自适应填词' },
  { value: 'custom', label: '自定义歌词' },
] as const

export const DOUBAO_SPEECH_RATE_OPTIONS = [
  { value: '-50', label: '0.5x' },
  { value: '-25', label: '0.75x' },
  { value: '0', label: '正常' },
  { value: '25', label: '1.25x' },
  { value: '50', label: '1.5x' },
  { value: '100', label: '2x' },
] as const

export const DOUBAO_PITCH_RATE_OPTIONS = [
  { value: '-12', label: '低沉' },
  { value: '-6', label: '偏低' },
  { value: '0', label: '正常' },
  { value: '6', label: '偏高' },
  { value: '12', label: '高亢' },
] as const

export const DOUBAO_LOUDNESS_RATE_OPTIONS = [
  { value: '-50', label: '轻' },
  { value: '0', label: '正常' },
  { value: '50', label: '响' },
  { value: '100', label: '最响' },
] as const

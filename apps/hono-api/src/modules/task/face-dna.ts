// Legacy module path retained only for the existing voice-card callers. The former
// role-card FaceDna generator, cast-repel tables, prompt suffixes, negative terms,
// feature flag and persistence contract were deleted when character cards moved to
// the agents-cli tapcanvas-character-card single track.

const FEMALE_RE =
  /女|妈|娘|姨(?!父|夫|丈)|婶|姑(?!父|爷|丈)|婆|嫂|妹(?!夫)|姐(?!夫)|母|妻|媳|妃|奶奶|姥姥|夫人|太太|皇后|太后|嬷|婢|丫鬟|\bwoman\b|\bwomen\b|\bfemale\b|\bgirl\b|\blady\b|\bshe\b|\bher\b/i;
const MALE_RE =
  /男|爸|爹|叔|舅(?!妈|母)|伯(?!母)|爷|哥(?!特)|兄|弟|父|夫(?!人)|公子|先生|少爷|老爷|王子|太子|皇帝|皇上|国王|\bman\b|\bmen\b|\bmale\b|\bboy\b|\bgentleman\b|\bhe\b|\bhis\b/i;

/**
 * Existing voice-selection helper. It does not participate in character-card
 * design, image prompting, identity generation, asset selection, or delivery.
 */
export function inferCharacterGender(text: string): "male" | "female" | undefined {
  const normalized = String(text ?? "");
  const female = FEMALE_RE.test(normalized);
  const male = MALE_RE.test(normalized);
  if (male && !female) return "male";
  if (female && !male) return "female";
  return undefined;
}

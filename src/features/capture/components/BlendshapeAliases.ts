/**
 * BlendshapeAliases.ts
 * 
 * ARKit standart blendshape isimlerini, popüler 3D modellerin (ReadyPlayerMe, Mixamo,
 * Apple ARKit, MetaHuman) kullandığı tüm varyasyonlara eşleyen statik sözlük.
 * 
 * MediaPipe/ARKit ismi → Olası model isimleri dizisi
 * İlk frame'de model taranırken bu sözlük kullanılarak O(1) index cache oluşturulur.
 */

export const BLENDSHAPE_ALIASES: Record<string, readonly string[]> = {
  // ─── Eyes ───
  eyeBlinkLeft:       ["eyeBlinkLeft", "EyeBlinkLeft", "eyeBlink_L", "eye_blink_left", "EyeBlink_L", "blinkLeft"],
  eyeBlinkRight:      ["eyeBlinkRight", "EyeBlinkRight", "eyeBlink_R", "eye_blink_right", "EyeBlink_R", "blinkRight"],
  eyeLookDownLeft:    ["eyeLookDownLeft", "EyeLookDownLeft", "eyeLookDown_L", "eye_look_down_left"],
  eyeLookDownRight:   ["eyeLookDownRight", "EyeLookDownRight", "eyeLookDown_R", "eye_look_down_right"],
  eyeLookInLeft:      ["eyeLookInLeft", "EyeLookInLeft", "eyeLookIn_L", "eye_look_in_left"],
  eyeLookInRight:     ["eyeLookInRight", "EyeLookInRight", "eyeLookIn_R", "eye_look_in_right"],
  eyeLookOutLeft:     ["eyeLookOutLeft", "EyeLookOutLeft", "eyeLookOut_L", "eye_look_out_left"],
  eyeLookOutRight:    ["eyeLookOutRight", "EyeLookOutRight", "eyeLookOut_R", "eye_look_out_right"],
  eyeLookUpLeft:      ["eyeLookUpLeft", "EyeLookUpLeft", "eyeLookUp_L", "eye_look_up_left"],
  eyeLookUpRight:     ["eyeLookUpRight", "EyeLookUpRight", "eyeLookUp_R", "eye_look_up_right"],
  eyeSquintLeft:      ["eyeSquintLeft", "EyeSquintLeft", "eyeSquint_L", "eye_squint_left"],
  eyeSquintRight:     ["eyeSquintRight", "EyeSquintRight", "eyeSquint_R", "eye_squint_right"],
  eyeWideLeft:        ["eyeWideLeft", "EyeWideLeft", "eyeWide_L", "eye_wide_left"],
  eyeWideRight:       ["eyeWideRight", "EyeWideRight", "eyeWide_R", "eye_wide_right"],

  // ─── Jaw ───
  jawForward:  ["jawForward", "JawForward", "jaw_forward"],
  jawLeft:     ["jawLeft", "JawLeft", "jaw_left"],
  jawRight:    ["jawRight", "JawRight", "jaw_right"],
  jawOpen:     ["jawOpen", "JawOpen", "jaw_open"],

  // ─── Mouth ───
  mouthClose:         ["mouthClose", "MouthClose", "mouth_close"],
  mouthFunnel:        ["mouthFunnel", "MouthFunnel", "mouth_funnel"],
  mouthPucker:        ["mouthPucker", "MouthPucker", "mouth_pucker"],
  mouthLeft:          ["mouthLeft", "MouthLeft", "mouth_left"],
  mouthRight:         ["mouthRight", "MouthRight", "mouth_right"],
  mouthSmileLeft:     ["mouthSmileLeft", "MouthSmileLeft", "mouthSmile_L", "mouth_smile_left"],
  mouthSmileRight:    ["mouthSmileRight", "MouthSmileRight", "mouthSmile_R", "mouth_smile_right"],
  mouthFrownLeft:     ["mouthFrownLeft", "MouthFrownLeft", "mouthFrown_L", "mouth_frown_left"],
  mouthFrownRight:    ["mouthFrownRight", "MouthFrownRight", "mouthFrown_R", "mouth_frown_right"],
  mouthDimpleLeft:    ["mouthDimpleLeft", "MouthDimpleLeft", "mouthDimple_L", "mouth_dimple_left"],
  mouthDimpleRight:   ["mouthDimpleRight", "MouthDimpleRight", "mouthDimple_R", "mouth_dimple_right"],
  mouthStretchLeft:   ["mouthStretchLeft", "MouthStretchLeft", "mouthStretch_L", "mouth_stretch_left"],
  mouthStretchRight:  ["mouthStretchRight", "MouthStretchRight", "mouthStretch_R", "mouth_stretch_right"],
  mouthRollLower:     ["mouthRollLower", "MouthRollLower", "mouth_roll_lower"],
  mouthRollUpper:     ["mouthRollUpper", "MouthRollUpper", "mouth_roll_upper"],
  mouthShrugLower:    ["mouthShrugLower", "MouthShrugLower", "mouth_shrug_lower"],
  mouthShrugUpper:    ["mouthShrugUpper", "MouthShrugUpper", "mouth_shrug_upper"],
  mouthPressLeft:     ["mouthPressLeft", "MouthPressLeft", "mouthPress_L", "mouth_press_left"],
  mouthPressRight:    ["mouthPressRight", "MouthPressRight", "mouthPress_R", "mouth_press_right"],
  mouthLowerDownLeft: ["mouthLowerDownLeft", "MouthLowerDownLeft", "mouthLowerDown_L", "mouth_lower_down_left"],
  mouthLowerDownRight:["mouthLowerDownRight", "MouthLowerDownRight", "mouthLowerDown_R", "mouth_lower_down_right"],
  mouthUpperUpLeft:   ["mouthUpperUpLeft", "MouthUpperUpLeft", "mouthUpperUp_L", "mouth_upper_up_left"],
  mouthUpperUpRight:  ["mouthUpperUpRight", "MouthUpperUpRight", "mouthUpperUp_R", "mouth_upper_up_right"],

  // ─── Brow ───
  browDownLeft:       ["browDownLeft", "BrowDownLeft", "browDown_L", "brow_down_left"],
  browDownRight:      ["browDownRight", "BrowDownRight", "browDown_R", "brow_down_right"],
  browInnerUp:        ["browInnerUp", "BrowInnerUp", "brow_inner_up"],
  browOuterUpLeft:    ["browOuterUpLeft", "BrowOuterUpLeft", "browOuterUp_L", "brow_outer_up_left"],
  browOuterUpRight:   ["browOuterUpRight", "BrowOuterUpRight", "browOuterUp_R", "brow_outer_up_right"],

  // ─── Cheek ───
  cheekPuff:    ["cheekPuff", "CheekPuff", "cheek_puff"],
  cheekSquintLeft:  ["cheekSquintLeft", "CheekSquintLeft", "cheekSquint_L", "cheek_squint_left"],
  cheekSquintRight: ["cheekSquintRight", "CheekSquintRight", "cheekSquint_R", "cheek_squint_right"],

  // ─── Nose ───
  noseSneerLeft:  ["noseSneerLeft", "NoseSneerLeft", "noseSneer_L", "nose_sneer_left"],
  noseSneerRight: ["noseSneerRight", "NoseSneerRight", "noseSneer_R", "nose_sneer_right"],

  // ─── Tongue ───
  tongueOut: ["tongueOut", "TongueOut", "tongue_out"],
};

// Hızlı mimikler (göz kırpma gibi) ve yavaş mimikler (gülümseme gibi) için farklı lerp hızları
const FAST_BLENDSHAPES = new Set([
  "eyeBlinkLeft", "eyeBlinkRight",
  "eyeWideLeft", "eyeWideRight",
  "jawOpen",
]);

/**
 * Verilen blendshape isminin hızlı (göz kırpma) mı yoksa yavaş (gülümseme) mi olduğunu belirler.
 * Hızlı mimikler için lerp faktörü daha yüksek olmalıdır.
 */
export function blendshapeLerpFactor(name: string, delta: number): number {
  if (FAST_BLENDSHAPES.has(name)) {
    return Math.min(1, 25 * delta); // Göz kırpma anında olmalı
  }
  return Math.min(1, 12 * delta); // Gülümseme gibi mimikler daha yumuşak
}

/**
 * Bir mesh'in morphTargetDictionary'sini tarayarak ARKit isimlerinden mesh index'lerine
 * bir ön-hesaplanmış cache oluşturur. Bu fonksiyon sadece bir kez çağrılır.
 */
export function buildBlendshapeIndexCache(
  morphTargetDictionary: Record<string, number>,
): Map<string, number> {
  const cache = new Map<string, number>();

  for (const [arkitName, aliases] of Object.entries(BLENDSHAPE_ALIASES)) {
    for (const alias of aliases) {
      if (alias in morphTargetDictionary) {
        cache.set(arkitName, morphTargetDictionary[alias]);
        break; // İlk eşleşmeyi al
      }
    }
  }

  return cache;
}

import { COLORS } from "@/constants/colors";
import { avatarSvgDataUri } from "@/utils/avatarSvg";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

interface AvatarDiscProps {
  /** Seeds the generated face, so one name always draws the same one. */
  seed: string;
  /** The picture Jellyfin holds for this user; it covers the face once loaded. */
  uri?: string;
  size: number;
}

/** The round face of an account: the generated tile stands in until the photo is in, then the
 * photo replaces it. The two never show at once — a photo with transparency would let the
 * generated face bleed through behind it, so the placeholder is hidden once the photo loads. */
export function AvatarDisc({ seed, uri, size }: AvatarDiscProps) {
  const [loaded, setLoaded] = useState(false);
  const face = useMemo(() => avatarSvgDataUri(seed), [seed]);
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }]} collapsable={false}>
      <Image source={{ uri: face }} style={[styles.image, uri && loaded && styles.imagePending]} contentFit="cover" transition={0} accessible={false} />
      {uri ? (
        <Image source={{ uri }} style={[styles.image, !loaded && styles.imagePending]} contentFit="cover" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} accessible={false} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    overflow: "hidden",
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  image: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  imagePending: {
    opacity: 0,
  },
});

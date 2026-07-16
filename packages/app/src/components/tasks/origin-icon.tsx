import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export type OriginProviderId = "jira" | "azure" | "gitlab" | "linear";

export const ORIGIN_PROVIDER_LABELS: Record<OriginProviderId, string> = {
  jira: "Jira",
  azure: "Azure Boards",
  gitlab: "GitLab",
  linear: "Linear",
};

// Brand-recognizable initials on the provider's primary color. We do not ship
// trademarked logos; a colored monogram keeps rows scannable like Kepler's.
const PROVIDER_GLYPHS: Record<OriginProviderId, { glyph: string; color: string }> = {
  jira: { glyph: "J", color: "#0052CC" },
  azure: { glyph: "A", color: "#0078D4" },
  gitlab: { glyph: "G", color: "#FC6D26" },
  linear: { glyph: "L", color: "#5E6AD2" },
};

export function parseOriginProvider(origin: string | undefined): OriginProviderId | null {
  if (!origin) return null;
  const provider = origin.slice(0, origin.indexOf(":"));
  if (
    provider === "jira" ||
    provider === "azure" ||
    provider === "gitlab" ||
    provider === "linear"
  ) {
    return provider;
  }
  return null;
}

export function originKey(origin: string | undefined): string {
  if (!origin) return "";
  return origin.slice(origin.indexOf(":") + 1);
}

export function OriginIcon({
  provider,
  size = 18,
}: {
  provider: OriginProviderId | null;
  size?: number;
}): ReactElement {
  const glyph = provider ? PROVIDER_GLYPHS[provider] : null;
  const badgeStyle = useMemo(
    () => [
      styles.badge,
      glyph ? { backgroundColor: glyph.color } : styles.badgeUnknown,
      { width: size, height: size, borderRadius: size / 4 },
    ],
    [glyph, size],
  );
  const glyphStyle = useMemo(() => [styles.glyph, { fontSize: size * 0.6 }], [size]);

  return (
    <View style={badgeStyle}>{glyph ? <Text style={glyphStyle}>{glyph.glyph}</Text> : null}</View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    alignItems: "center",
    justifyContent: "center",
  },
  badgeUnknown: {
    backgroundColor: theme.colors.surface3,
  },
  glyph: {
    color: "#FFFFFF",
    fontWeight: theme.fontWeight.medium,
  },
}));

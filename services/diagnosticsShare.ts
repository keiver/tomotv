/**
 * Two exits for the diagnostics log on iOS: the share sheet with the log as a text file, so Mail
 * attaches it, and a Mail draft with the log in the body. tvOS has neither (React Native
 * compiles the share module out), so callers gate both.
 */
import { Directory, File, Paths } from "expo-file-system";
import { Linking, Share } from "react-native";

const SHARE_DIR = "diagnostics";

export async function shareLog(text: string, fileName: string): Promise<void> {
  const directory = new Directory(Paths.cache, SHARE_DIR);
  if (!directory.exists) directory.create({ intermediates: true });
  const file = new File(directory, fileName);
  file.write(text);
  await Share.share({ url: file.uri, title: fileName });
}

export function mailtoUrl(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function mailLog(text: string, subject: string): Promise<void> {
  await Linking.openURL(mailtoUrl(subject, text));
}

/**
 * Hands the diagnostics log to the iOS share sheet as a text file, so Mail attaches it.
 * tvOS has no share sheet (React Native compiles the module out), so callers gate this.
 */
import { Directory, File, Paths } from "expo-file-system";
import { Share } from "react-native";

const SHARE_DIR = "diagnostics";

export async function shareLog(text: string, fileName: string): Promise<void> {
  const directory = new Directory(Paths.cache, SHARE_DIR);
  if (!directory.exists) directory.create({ intermediates: true });
  const file = new File(directory, fileName);
  file.write(text);
  await Share.share({ url: file.uri, title: fileName });
}

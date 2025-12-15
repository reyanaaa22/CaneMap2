import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export async function mobileDownloadFile(filename, base64Data) {
    try {
        // Save inside app storage
        const result = await Filesystem.writeFile({
            path: filename,
            data: base64Data,
            directory: Directory.Documents,
        });

await Share.share({
            title: "Download File",
            text: "File downloaded: " + filename,
            url: result.uri,
            dialogTitle: "Save or share file",
        });

        return true;
    } catch (err) {
        console.error("Download failed:", err);
        return false;
    }
}

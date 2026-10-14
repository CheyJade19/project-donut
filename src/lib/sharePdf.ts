import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { EntryResult } from './results';
import { scoreSheetHtml, sheetFileName } from './sheetPdf';

/** Shares a rider's score sheets as a PDF. */
export function shareScoreSheet(result: EntryResult, placing: { place: number | null; shared: boolean } | null) {
  return shareHtmlAsPdf(scoreSheetHtml(result, placing), sheetFileName(result));
}

/**
 * Turns the HTML into a PDF and opens the share sheet (save to Files, email,
 * AirDrop, print...). In a browser it opens the print dialog for that HTML,
 * where "Save as PDF" is one of the printers.
 */
export async function shareHtmlAsPdf(html: string, title: string) {
  if (Platform.OS === 'web') {
    printInBrowser(html);
    return;
  }
  // A4 at 72 points per inch.
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
  } else {
    await Print.printAsync({ uri });
  }
}

function printInBrowser(html: string) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

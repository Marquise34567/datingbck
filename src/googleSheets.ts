import { google } from 'googleapis';

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY || '';
const sheetId = process.env.GOOGLE_SHEET_ID;
const sheetTab = process.env.GOOGLE_SHEET_TAB || 'Sheet1';

function getJwtClient() {
  if (!serviceAccountEmail || !privateKeyRaw) return null;
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
  const jwt = new google.auth.JWT(serviceAccountEmail, undefined, privateKey, ['https://www.googleapis.com/auth/spreadsheets']);
  return jwt;
}

export async function appendPurchaseRow(row: string[]) {
  if (!sheetId) {
    console.warn('googleSheets: no sheet id configured');
    return false;
  }
  const jwt = getJwtClient();
  if (!jwt) return false;
  try {
    await jwt.authorize();
    const sheets = google.sheets({ version: 'v4', auth: jwt });
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${sheetTab}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });
    return true;
  } catch (e) {
    console.warn('googleSheets append failed', e);
    return false;
  }
}

/**
 * Export CaneMap Firestore to JSON (Firefoo-compatible) in System Database/database/
 *
 * Auth (first match wins):
 *   1. GOOGLE_APPLICATION_CREDENTIALS → service account
 *   2. firebase login → uses ~/.config/configstore/firebase-tools.json
 *   3. Application default credentials
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const PROJECT_ID = 'canemap-system';
const DATABASE_ID = '(default)';
const SYSTEM_DB_DIR = path.join(__dirname, '..', 'System Database');
const DATABASE_DIR = path.join(SYSTEM_DB_DIR, 'database');
const PAGE_SIZE = 300;
const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  '';

const FIREBASE_CLI_OAUTH = {
  client_id: '563584335869-fgrlmrichjnqfmhpplnlfpnjkbndmff',
  client_secret: 'j9pHscaJSY9MEEg1yWU1Wf',
};

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

// --- HTTP helpers ---

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${options.token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body ? JSON.parse(body) : {});
            return;
          }
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function loadFirebaseCliTokens() {
  const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
  if (!fs.existsSync(configPath)) return null;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.tokens?.refresh_token) return null;
  return {
    refresh_token: config.tokens.refresh_token,
    access_token: config.tokens.access_token,
    expires_at: config.tokens.expires_at,
  };
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    ...FIREBASE_CLI_OAUTH,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data).access_token);
            return;
          }
          reject(new Error(`Token refresh failed (${res.statusCode}): ${data}`));
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  if (SERVICE_ACCOUNT_PATH) {
    const keyPath = path.resolve(SERVICE_ACCOUNT_PATH);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Service account not found: ${keyPath}`);
    }
    const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(sa),
        projectId: sa.project_id || PROJECT_ID,
      });
    }
    const { access_token } = await admin.credential.cert(sa).getAccessToken();
    console.log('Auth: service account key\n');
    return access_token;
  }

  const cli = loadFirebaseCliTokens();
  if (cli) {
    const stillValid = cli.expires_at && Date.now() < cli.expires_at - 60_000;
    const token = stillValid && cli.access_token
      ? cli.access_token
      : await refreshAccessToken(cli.refresh_token);
    console.log('Auth: Firebase CLI login (firebase login)\n');
    return token;
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const { access_token } = await admin.app().options.credential.getAccessToken();
  console.log('Auth: application default credentials\n');
  return access_token;
}

// --- Firestore REST value conversion (Firefoo-like) ---

function decodeValue(field) {
  if (field == null) return null;
  if ('nullValue' in field) return null;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return field.doubleValue;
  if ('stringValue' in field) return field.stringValue;
  if ('timestampValue' in field) {
    const d = new Date(field.timestampValue);
    return { _seconds: Math.floor(d.getTime() / 1000), _nanoseconds: (d.getTime() % 1000) * 1e6 };
  }
  if ('geoPointValue' in field) {
    return {
      __lat__: field.geoPointValue.latitude,
      __lon__: field.geoPointValue.longitude,
    };
  }
  if ('bytesValue' in field) {
    return { __type__: 'bytes', base64: field.bytesValue };
  }
  if ('referenceValue' in field) {
    const ref = field.referenceValue;
    const prefix = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/`;
    return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
  }
  if ('arrayValue' in field) {
    return (field.arrayValue.values || []).map(decodeValue);
  }
  if ('mapValue' in field) {
    return decodeFields(field.mapValue.fields || {});
  }
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [key, val] of Object.entries(fields)) {
    out[key] = decodeValue(val);
  }
  return out;
}

function documentPathFromName(name) {
  const prefix = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

// --- Export via REST API ---

async function listCollectionIds(token, parentPath = '') {
  const parent = parentPath
    ? `${FIRESTORE_BASE}/${parentPath}`
    : FIRESTORE_BASE.replace(/\/documents$/, '');
  const url = parentPath
    ? `${FIRESTORE_BASE}/${parentPath}:listCollectionIds`
    : `${FIRESTORE_BASE.replace(/\/documents$/, '')}/documents:listCollectionIds`;

  const ids = [];
  let pageToken;
  do {
    const body = { pageSize: PAGE_SIZE, ...(pageToken ? { pageToken } : {}) };
    const res = await requestJson(url, { method: 'POST', token, body });
    ids.push(...(res.collectionIds || []));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return ids;
}

async function listDocuments(token, collectionPath) {
  const docs = [];
  let pageToken;
  const baseUrl = `${FIRESTORE_BASE}/${collectionPath}`;

  do {
    const sep = pageToken ? '&' : '?';
    const url = `${baseUrl}${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '?pageSize=' + PAGE_SIZE}`;
    const res = await requestJson(url, { token });
    if (res.documents) docs.push(...res.documents);
    pageToken = res.nextPageToken;
  } while (pageToken);

  return docs;
}

async function exportDocumentTree(token, docPath) {
  const docUrl = `${FIRESTORE_BASE}/${docPath}`;
  let data = {};
  try {
    const doc = await requestJson(docUrl, { token });
    if (doc.fields) data = decodeFields(doc.fields);
  } catch (e) {
    if (!String(e.message).includes('404')) throw e;
  }

  const subcolIds = await listCollectionIds(token, docPath);
  if (subcolIds.length > 0) {
    data.__collections__ = {};
    for (const subId of subcolIds) {
      data.__collections__[subId] = await exportCollectionTree(token, `${docPath}/${subId}`);
    }
  }
  return data;
}

async function exportCollectionTree(token, collectionPath) {
  const tree = {};
  const documents = await listDocuments(token, collectionPath);
  for (const doc of documents) {
    const docPath = documentPathFromName(doc.name);
    const docId = docPath.split('/').pop();
    tree[docId] = await exportDocumentTree(token, docPath);
  }
  return tree;
}

async function exportAllCollectionsRest(token) {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  const rootIds = await listCollectionIds(token);
  const summary = {
    exportedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    format: 'Firefoo-compatible nested JSON',
    exportPath: 'System Database/database/',
    collections: {},
  };

  for (const colId of rootIds) {
    const tree = await exportCollectionTree(token, colId);
    const outPath = path.join(DATABASE_DIR, `${colId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(tree, null, 2), 'utf8');
    const docCount = Object.keys(tree).length;
    summary.collections[colId] = { file: `${colId}.json`, rootDocumentCount: docCount };
    console.log(`  database/${colId}.json (${docCount} root documents)`);
  }

  fs.writeFileSync(
    path.join(DATABASE_DIR, '_export-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );
  return summary;
}

async function exportAuthUsersAdmin() {
  if (!admin.apps.length) return 0;
  try {
    const auth = admin.auth();
    const users = [];
    let nextPageToken;
    do {
      const result = await auth.listUsers(1000, nextPageToken);
      for (const user of result.users) {
        users.push({
          uid: user.uid,
          email: user.email || null,
          emailVerified: user.emailVerified,
          displayName: user.displayName || null,
          phoneNumber: user.phoneNumber || null,
          disabled: user.disabled,
          metadata: {
            creationTime: user.metadata.creationTime,
            lastSignInTime: user.metadata.lastSignInTime,
          },
        });
      }
      nextPageToken = result.pageToken;
    } while (nextPageToken);

    fs.writeFileSync(
      path.join(DATABASE_DIR, '_firebase-auth-users.json'),
      JSON.stringify(
        {
          __note__: 'Firebase Authentication users (passwords are not exportable)',
          exportedAt: new Date().toISOString(),
          projectId: PROJECT_ID,
          users,
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`  database/_firebase-auth-users.json (${users.length} users)`);
    return users.length;
  } catch (e) {
    console.warn(`  Skipped Auth export: ${e.message}`);
    return 0;
  }
}

async function main() {
  console.log('CaneMap — Export to System Database/database/ (JSON)\n');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Output:  ${DATABASE_DIR}\n`);

  fs.mkdirSync(SYSTEM_DB_DIR, { recursive: true });
  fs.mkdirSync(DATABASE_DIR, { recursive: true });

  const token = await getAccessToken();

  console.log('Exporting Firestore collections (JSON)...');
  const summary = await exportAllCollectionsRest(token);

  console.log('Exporting Firebase Auth users (if permitted)...');
  summary.authUserCount = await exportAuthUsersAdmin();

  console.log('\nDone. JSON files are in System Database/database/');
  console.log('Commit that folder to GitHub for turnover.\n');
}

main().catch((err) => {
  console.error('\nExport failed:', err.message || err);
  console.error(`
Try:
  1. firebase login --reauth
  2. export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
  3. Firefoo → export collections as JSON → System Database/database/
`);
  process.exit(1);
});

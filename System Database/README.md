# System Database (CaneMap Turnover)

Per instructor requirements: export the full Firebase Firestore database as **JSON** and place files in the **`database`** folder below.

## Required folder layout

```
System Database/
├── README.md                 ← this file
├── database/                 ← JSON exports go HERE (commit to GitHub)
│   ├── users.json
│   ├── fields.json
│   ├── records.json
│   └── ... (one file per collection)
├── database-schema.json      ← optional: structure/schema reference
└── A-System-Database-Schema.txt
```

---

## Method 1 — Firefoo (instructor steps)

1. **Download Firefoo**  
   https://firefoo.com/

2. **Connect Firebase**  
   Open Firefoo → sign in with Google → select project **`canemap-system`**.

3. **Export all collections**  
   - In the left sidebar, right-click the project or each root collection.  
   - Choose **Export Collection** (or backup/export all collections if your Firefoo version offers it).  
   - Enable **Include Subcollections** (needed for `records/bought_items`, `fields/remarks`, etc.).

4. **Choose JSON**  
   - Format: **JSON** (nested format, not CSV).  
   - Save each export into this folder:  
     `CaneMap2/System Database/database/`

5. **Naming**  
   Use collection names as filenames, e.g. `users.json`, `fields.json`, `records.json`.

6. **GitHub**  
   Commit the `System Database/database/` folder to your repository.

7. **Email**  
   Email **prototype** and **user manual** to Sir Bertz (separate from this folder).

---

## Method 2 — Project script (alternative to Firefoo)

Same JSON layout as Firefoo (nested `__collections__`). Requires a Firebase service account key.

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
npm run export:system-database
```

Output is written to `System Database/database/*.json`.

---

## API provider

| Item | Value |
|------|--------|
| Provider | Google Firebase |
| Database | Cloud Firestore |
| Project | `canemap-system` |
| Region | `asia-southeast1` |

---

## Notes

- **Firebase Storage** (photos, PDFs) is not included in Firestore JSON exports.  
- **Passwords** are never exported (Firebase Auth security).  
- Do not commit service account `.json` keys to GitHub.

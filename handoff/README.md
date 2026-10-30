# Developer data handoff

[Download the encrypted handoff](local-database.aes256.zip). The repository is public; every file inside this ZIP is encrypted with AES-256. Obtain the archive password privately from the project owner. The password is not stored in this repository.

## Restore

1. Check the download against [the SHA-256 checksum](local-database.aes256.zip.sha256). In PowerShell, use `Get-FileHash .\local-database.aes256.zip -Algorithm SHA256`.
2. Extract it into a private folder using an AES-compatible ZIP application such as 7-Zip or WinRAR. Some built-in ZIP extractors do not support this encryption format.
3. Read `RESTORE.md` and run `php verify.php` from the extracted folder. It checks file hashes, SQLite integrity, foreign keys, and table counts without changing the data.
4. Follow the restore instructions using the matching application code, commit `53cd41b36c62c683bf2c81ebd44b3783908335c4`, or a later compatible revision.

The payload contains the SQLite database, associated private uploads, a reconciliation manifest, and `PRIVATE-KEYS.env` with the original restore keys. It excludes unrelated SMTP, provider, and hosting credentials. Its snapshot was exported on 30 October 2026 and matches the source database at export time; it is not a continuously synchronized database.

Keep the extracted files and password private. The database includes account and financial records, and the uploads include KYC documents. The restore keys are required to decrypt existing KYC and account-security records. This directory ignores extracted files to prevent accidental plaintext commits.

For an empty installation, restore this database instead of running seeders. For an existing deployment, preserve and reconcile any newer hosted records instead of overwriting them. SQLite-to-MySQL deployment requires a deliberate conversion; this SQLite file cannot be imported directly through phpMyAdmin. The complete instructions are inside the encrypted archive.

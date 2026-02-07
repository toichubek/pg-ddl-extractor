# OIDC Trusted Publishing Setup

This package uses OIDC (OpenID Connect) trusted publishing for secure, token-free npm publishing from GitHub Actions.

## Benefits

✅ **No Token Management** - No NPM_TOKEN secret needed
✅ **Enhanced Security** - Short-lived credentials that can't be exfiltrated
✅ **Automatic Provenance** - Package provenance attestations by default
✅ **No Expiration** - Unlike tokens which expire every 90 days

## Setup Instructions

### 1. Configure Trusted Publisher on npm

1. Go to your package settings:
   ```
   https://www.npmjs.com/package/@toichubek/pg-ddl-extractor/access
   ```

2. Scroll to **"Trusted Publishers"** section

3. Click **"Add Trusted Publisher"** → Select **"GitHub Actions"**

4. Fill in these EXACT values:
   ```
   Organization/User: toichubek
   Repository: pg-ddl-extractor
   Workflow filename: publish.yml
   Environment name: (leave blank)
   ```

5. Click **"Add"**

⚠️ **IMPORTANT**: All fields are case-sensitive and must match EXACTLY!

### 2. GitHub Actions Workflow (Already Configured)

The workflow at `.github/workflows/publish.yml` is already configured with:

```yaml
permissions:
  contents: read
  id-token: write  # Required for OIDC

steps:
  - name: Publish to npm with OIDC
    run: npm publish --access public --provenance
    # No NODE_AUTH_TOKEN needed!
```

### 3. How to Publish

Once configured on npmjs.com, publishing is automatic:

```bash
# Create a new version
npm version patch  # or minor, major

# Push with tags
git push && git push --tags

# Create a GitHub release
gh release create v1.0.1 --generate-notes

# GitHub Actions will automatically publish to npm!
```

## Verification

After your first OIDC publish:

1. Check your package on npm: https://www.npmjs.com/package/@toichubek/pg-ddl-extractor
2. Look for the **provenance badge** ✅
3. Click it to see the cryptographic attestation linking the package to the GitHub Action run

## Troubleshooting

### Error: "Unable to authenticate"

**Cause**: Workflow filename mismatch

**Solution**: Verify the workflow filename on npmjs.com matches EXACTLY:
- ✅ Correct: `publish.yml`
- ❌ Wrong: `Publish.yml` (wrong case)
- ❌ Wrong: `publish` (missing .yml)

### Error: "Permission denied"

**Cause**: Missing `id-token: write` permission

**Solution**: Verify `.github/workflows/publish.yml` has:
```yaml
permissions:
  id-token: write
  contents: read
```

### Still using NPM_TOKEN?

You can safely **delete** the `NPM_TOKEN` secret from GitHub repo settings once OIDC is working.

## References

- [npm Trusted Publishing Docs](https://docs.npmjs.com/trusted-publishers/)
- [GitHub Changelog](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)
- [Setup Guide](https://remarkablemark.org/blog/2025/12/19/npm-trusted-publishing/)

## Migration from NPM_TOKEN

If you were previously using NPM_TOKEN:

1. ✅ Configure OIDC on npmjs.com (steps above)
2. ✅ Workflow already updated (no changes needed)
3. ✅ Test with a GitHub release
4. ✅ Once working, delete NPM_TOKEN secret from repo
5. ✅ Celebrate! 🎉 No more token rotation

---

**Status**: ⚠️ Awaiting configuration on npmjs.com
**Last Updated**: 2026-02-07

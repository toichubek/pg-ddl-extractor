# ⚠️ OIDC Configuration Needed

## Quick Setup (2 minutes)

Your package is ready for OIDC trusted publishing, but you need to configure it on npmjs.com:

### Steps:

1. **Open this link**: https://www.npmjs.com/package/@toichubek/pg-ddl-extractor/access

2. **Scroll to**: "Trusted Publishers" section

3. **Click**: "Add Trusted Publisher" button

4. **Select**: "GitHub Actions"

5. **Fill EXACTLY** (case-sensitive!):
   ```
   Organization/User: toichubek
   Repository: pg-ddl-extractor
   Workflow filename: publish.yml
   Environment: (leave blank)
   ```

6. **Click**: "Add"

7. **Delete this file** once configured!

### Test It:

```bash
npm version patch
git push && git push --tags
gh release create v1.0.1 --generate-notes
```

GitHub Actions will auto-publish! 🚀

---

**Full docs**: See `.github/OIDC_SETUP.md`

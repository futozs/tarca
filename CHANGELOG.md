# Változásnapló

## 0.1.0 (2026-11-16)

### Újdonságok

- wire the add-on subpaths into the package (ed37f57)
- tarca CLI (doctor, verify, document get, mcp) and the tarca/mcp server (2ac1eda)
- tarca/node, tarca/batch and tarca/observe (bebcddf)
- tarca/storage, tarca/storage/fs, tarca/stores and tarca/journal (e63892e)
- implement all 57 Billingo API v3 operations (97e17c1)
- **testing:** tarca/testing alcsomag fake Billingóval és createMockTarca-val (7de96a7)
- OpenAPI validáció a kassza XSD-ellenőrzésének szintjén, nav_unavailable hibakategória (aa390bb)
- a tárca alapjai, Billingo API v3 kliens a kassza mintájára (571fd24)

### Javítások

- **release:** restore the changelog exactly after a failed publish [skip release] (742d643)
- **payments:** issue the Barion sale before applying a refund (6d7de7e)
- close 22 issues in the payments, journal and MCP add-ons (f126071)
- **release:** skip publishing while package.json is private (6f385c7)
- close 26 issues found by the adversarial review (8fc24d1)

